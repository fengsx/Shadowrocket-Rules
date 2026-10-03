import { Hono } from "hono";
import { decrypt, encrypt, sha, token } from "./crypto";
import { parseNodes, renderMihomo, renderShadowrocket } from "./core";
import type { Env, ProxyNode, RuleManifest } from "./types";

const app = new Hono<{ Bindings: Env }>();
const now = () => Math.floor(Date.now() / 1000);

function cookieValue(header: string, name: string): string {
  for (const item of header.split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

async function sessionToken(env: Env): Promise<string> {
  return sha(`session:${env.ADMIN_TOKEN}`);
}

async function authorized(c: any): Promise<boolean> {
  const authorization = c.req.header("authorization") || "";
  if (authorization.startsWith("Bearer ")) {
    return (await sha(authorization.slice(7))) === (await sha(c.env.ADMIN_TOKEN));
  }
  const session = cookieValue(c.req.header("cookie") || "", "sub_session");
  return Boolean(session) && session === await sessionToken(c.env);
}

async function manifest(env: Env): Promise<RuleManifest> {
  const response = await fetch(env.RULE_MANIFEST_URL, {
    headers: { "User-Agent": "fengsx-sub" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`规则清单 HTTP ${response.status}`);
  const value = await response.json() as RuleManifest;
  if (value.schemaVersion !== 1 || !Array.isArray(value.rules)) {
    throw new Error("规则清单格式无效");
  }
  return value;
}

async function allNodes(env: Env): Promise<ProxyNode[]> {
  const rows = await env.DB.prepare(
    "SELECT encrypted_payload FROM nodes n JOIN sources s ON s.id=n.source_id WHERE s.enabled=1 ORDER BY s.priority,n.sort_order",
  ).all<{ encrypted_payload: string }>();
  const seen = new Set<string>();
  const output: ProxyNode[] = [];
  for (const row of rows.results) {
    const proxy = JSON.parse(await decrypt(env.MASTER_KEY, row.encrypted_payload)) as ProxyNode;
    const key = JSON.stringify([proxy.type, proxy.server, proxy.port, proxy.uuid ?? proxy.password ?? ""]);
    if (!seen.has(key)) {
      seen.add(key);
      output.push(proxy);
    }
  }
  return output;
}

async function build(env: Env) {
  const id = crypto.randomUUID();
  const started = now();
  await env.DB.prepare("INSERT INTO builds(id,status,started_at) VALUES(?,?,?)")
    .bind(id, "running", started).run();
  try {
    const [rules, nodes, subscriptions] = await Promise.all([
      manifest(env),
      allNodes(env),
      env.DB.prepare("SELECT token_hash FROM subscriptions WHERE enabled=1")
        .all<{ token_hash: string }>(),
    ]);
    if (!nodes.length) throw new Error("没有可用节点");
    const outputs = {
      clash: renderMihomo(nodes, rules, false),
      merlinclash: renderMihomo(nodes, rules, true),
      shadowrocket: renderShadowrocket(nodes),
    };
    for (const subscription of subscriptions.results) {
      for (const [format, content] of Object.entries(outputs)) {
        await env.ARTIFACTS.put(
          `sub:${subscription.token_hash}:${format}`,
          content,
          { metadata: { ruleSha: rules.source.sha256, nodeCount: nodes.length, builtAt: started } },
        );
      }
    }
    await env.DB.prepare(
      "UPDATE builds SET status=?,rule_sha=?,node_count=?,finished_at=? WHERE id=?",
    ).bind("success", rules.source.sha256, nodes.length, now(), id).run();
    return { nodes: nodes.length, ruleSha: rules.source.sha256 };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(
      "UPDATE builds SET status=?,error=?,finished_at=? WHERE id=?",
    ).bind("failed", message.slice(0, 300), now(), id).run();
    throw error;
  }
}

async function refresh(env: Env) {
  const sources = await env.DB.prepare(
    "SELECT id,name,encrypted_url FROM sources WHERE enabled=1 ORDER BY priority",
  ).all<{ id: string; name: string; encrypted_url: string }>();
  let total = 0;
  for (const source of sources.results) {
    try {
      const url = await decrypt(env.MASTER_KEY, source.encrypted_url);
      const response = await fetch(url, {
        headers: { "User-Agent": "Clash.Meta", Accept: "*/*" },
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const nodes = await parseNodes(await response.text(), source.id);
      if (!nodes.length) throw new Error("未解析出支持的节点");
      const timestamp = now();
      const encrypted = await Promise.all(
        nodes.map((node) => encrypt(env.MASTER_KEY, JSON.stringify(node.proxy))),
      );
      const statements = [
        env.DB.prepare("DELETE FROM nodes WHERE source_id=?").bind(source.id),
        ...nodes.map((node, index) => env.DB.prepare(
          "INSERT INTO nodes(id,source_id,fingerprint,name,region,protocol,encrypted_payload,sort_order,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
        ).bind(
          node.id,
          source.id,
          node.fingerprint,
          node.name,
          node.region,
          node.protocol,
          encrypted[index],
          index,
          timestamp,
        )),
        env.DB.prepare(
          "UPDATE sources SET last_success_at=?,last_error=NULL,updated_at=? WHERE id=?",
        ).bind(timestamp, timestamp, source.id),
      ];
      await env.DB.batch(statements);
      total += nodes.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await env.DB.prepare("UPDATE sources SET last_error=?,updated_at=? WHERE id=?")
        .bind(message.slice(0, 300), now(), source.id).run();
    }
  }
  return { ...await build(env), rawNodes: total };
}

const loginPage = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>登录 · sub</title>
<style>
body{font:15px system-ui;background:#f4f6fb;color:#18202a;display:grid;place-items:center;min-height:100vh;margin:0}
main{width:min(380px,calc(100% - 40px));background:#fff;padding:28px;border-radius:16px;box-shadow:0 8px 36px #0002}
input,button{box-sizing:border-box;width:100%;padding:12px;margin-top:12px;border:1px solid #ccd;border-radius:9px}
button{background:#1769e0;color:#fff;cursor:pointer}#error{color:#b42318;min-height:20px}
</style>
<main><h1>sub 节点管理</h1><p>请输入管理密码</p>
<form id="login"><input id="password" type="password" autocomplete="current-password" autofocus required>
<button type="submit">登录</button></form><p id="error"></p></main>
<script>
document.querySelector("#login").addEventListener("submit",async(event)=>{
  event.preventDefault();
  const response=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({password:document.querySelector("#password").value})});
  if(response.ok){location.href="/admin";return}
  document.querySelector("#error").textContent="密码错误";
});
</script></html>`;

const adminPage = `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>sub 节点管理</title>
<style>
body{font:15px system-ui;max-width:980px;margin:32px auto;padding:0 16px;background:#f6f7fb;color:#18202a}
header{display:flex;align-items:center;justify-content:space-between}section{background:#fff;padding:20px;margin:16px 0;border-radius:14px;box-shadow:0 4px 20px #0001}
input,button{box-sizing:border-box;padding:10px;margin:5px;border:1px solid #ccd;border-radius:8px}
input[type=url]{width:min(680px,95%)}button{background:#1769e0;color:#fff;cursor:pointer}button.secondary{background:#fff;color:#18202a}
pre{white-space:pre-wrap;word-break:break-word;background:#f8fafc;padding:12px;border-radius:8px;min-height:80px}
</style>
<header><h1>sub 节点管理</h1><button class="secondary" id="logout">退出登录</button></header>
<section><h2>新增节点来源</h2><input id="sourceName" placeholder="名称">
<input id="sourceUrl" type="url" placeholder="HTTPS 订阅地址">
<button id="addSource">添加并分析</button></section>
<section><h2>组装与订阅</h2><button id="refresh">刷新全部并重新组装</button>
<button id="createSubscription">创建客户端订阅</button><pre id="output">正在加载…</pre></section>
<script>
const output=document.querySelector("#output");
async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
  if(response.status===401){location.href="/login";throw new Error("登录已失效")}
  const text=await response.text();
  if(!response.ok)throw new Error(text||("HTTP "+response.status));
  return text?JSON.parse(text):{};
}
async function load(){try{output.textContent=JSON.stringify(await api("/api/state"),null,2)}catch(error){output.textContent=String(error)}}
document.querySelector("#addSource").addEventListener("click",async()=>{
  try{
    const name=document.querySelector("#sourceName").value.trim();
    const url=document.querySelector("#sourceUrl").value.trim();
    if(!name||!url)throw new Error("名称和 HTTPS 订阅地址不能为空");
    await api("/api/sources",{method:"POST",body:JSON.stringify({name,url})});
    output.textContent=JSON.stringify(await api("/api/refresh",{method:"POST",body:"{}"}),null,2);
    await load();
  }catch(error){output.textContent=String(error)}
});
document.querySelector("#refresh").addEventListener("click",async()=>{
  try{output.textContent=JSON.stringify(await api("/api/refresh",{method:"POST",body:"{}"}),null,2);await load()}
  catch(error){output.textContent=String(error)}
});
document.querySelector("#createSubscription").addEventListener("click",async()=>{
  try{output.textContent=JSON.stringify(await api("/api/subscriptions",{method:"POST",body:JSON.stringify({label:"MIKI"})}),null,2)}
  catch(error){output.textContent=String(error)}
});
document.querySelector("#logout").addEventListener("click",async()=>{await api("/api/logout",{method:"POST",body:"{}"});location.href="/login"});
load();
</script></html>`;

app.get("/", (c) => c.redirect("/admin"));
app.get("/health", (c) => c.json({ ok: true, rules: c.env.RULE_MANIFEST_URL }));
app.get("/login", async (c) => await authorized(c) ? c.redirect("/admin") : c.html(loginPage));
app.get("/admin", async (c) => await authorized(c) ? c.html(adminPage) : c.redirect("/login"));

app.post("/api/login", async (c) => {
  const body = await c.req.json<{ password?: string }>();
  if ((await sha(body.password || "")) !== (await sha(c.env.ADMIN_TOKEN))) {
    return c.json({ error: "密码错误" }, 401);
  }
  c.header(
    "Set-Cookie",
    `sub_session=${await sessionToken(c.env)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`,
  );
  return c.json({ ok: true });
});

app.use("/api/*", async (c, next) => {
  if (!await authorized(c)) return c.json({ error: "未授权" }, 401);
  await next();
});

app.post("/api/logout", (c) => {
  c.header("Set-Cookie", "sub_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
  return c.json({ ok: true });
});

app.get("/api/state", async (c) => {
  const [sources, nodes, builds, subscriptions] = await Promise.all([
    c.env.DB.prepare(
      "SELECT id,name,enabled,priority,last_success_at,last_error FROM sources ORDER BY priority",
    ).all(),
    c.env.DB.prepare(
      "SELECT source_id,protocol,region,COUNT(*) count FROM nodes GROUP BY source_id,protocol,region",
    ).all(),
    c.env.DB.prepare(
      "SELECT status,rule_sha,node_count,error,started_at,finished_at FROM builds ORDER BY started_at DESC LIMIT 10",
    ).all(),
    c.env.DB.prepare(
      "SELECT label,enabled,created_at,last_access_at FROM subscriptions ORDER BY created_at DESC",
    ).all(),
  ]);
  return c.json({
    sources: sources.results,
    nodeSummary: nodes.results,
    builds: builds.results,
    subscriptions: subscriptions.results,
  });
});

app.post("/api/sources", async (c) => {
  const body = await c.req.json<{ name: string; url: string }>();
  const name = body.name?.trim();
  if (!name) return c.json({ error: "名称不能为空" }, 400);
  let url: URL;
  try {
    url = new URL(body.url);
  } catch {
    return c.json({ error: "订阅地址无效" }, 400);
  }
  if (url.protocol !== "https:") return c.json({ error: "只允许 HTTPS" }, 400);
  const id = crypto.randomUUID();
  const timestamp = now();
  await c.env.DB.prepare(
    "INSERT INTO sources(id,name,encrypted_url,created_at,updated_at) VALUES(?,?,?,?,?)",
  ).bind(
    id,
    name,
    await encrypt(c.env.MASTER_KEY, url.toString()),
    timestamp,
    timestamp,
  ).run();
  return c.json({ id }, 201);
});

app.post("/api/refresh", async (c) => c.json(await refresh(c.env)));

app.post("/api/subscriptions", async (c) => {
  const body = await c.req.json<{ label?: string }>();
  const value = token();
  const hash = await sha(value);
  const timestamp = now();
  await c.env.DB.prepare(
    "INSERT INTO subscriptions(token_hash,encrypted_token,label,created_at) VALUES(?,?,?,?)",
  ).bind(
    hash,
    await encrypt(c.env.MASTER_KEY, value),
    body.label || "订阅",
    timestamp,
  ).run();
  await build(c.env);
  const base = new URL(c.req.url).origin;
  return c.json({
    token: value,
    clash: `${base}/s/${value}/clash`,
    merlinclash: `${base}/s/${value}/merlinclash`,
    shadowrocket: `${base}/s/${value}/shadowrocket`,
  }, 201);
});

app.get("/s/:token/:format", async (c) => {
  const format = c.req.param("format");
  if (!["clash", "merlinclash", "shadowrocket"].includes(format)) return c.notFound();
  const hash = await sha(c.req.param("token"));
  const valid = await c.env.DB.prepare(
    "SELECT 1 ok FROM subscriptions WHERE token_hash=? AND enabled=1",
  ).bind(hash).first();
  if (!valid) return c.notFound();
  let value = await c.env.ARTIFACTS.getWithMetadata(`sub:${hash}:${format}`);
  if (!value.value) {
    await build(c.env);
    value = await c.env.ARTIFACTS.getWithMetadata(`sub:${hash}:${format}`);
  }
  if (!value.value) return c.notFound();
  c.executionCtx.waitUntil(
    c.env.DB.prepare("UPDATE subscriptions SET last_access_at=? WHERE token_hash=?")
      .bind(now(), hash).run(),
  );
  c.header("Cache-Control", "no-store");
  c.header(
    "Content-Type",
    format === "shadowrocket"
      ? "text/plain; charset=utf-8"
      : "application/yaml; charset=utf-8",
  );
  return c.body(value.value);
});

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil(refresh(env));
  },
};
