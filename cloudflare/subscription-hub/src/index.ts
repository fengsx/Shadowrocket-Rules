import { Hono } from "hono";
import QRCode from "qrcode-svg";
import { decrypt, encrypt, sha, token } from "./crypto";
import { normalizeProxyNode, parseNodes, renderMihomo, renderShadowrocket } from "./core";
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
    const proxy = normalizeProxyNode(
      JSON.parse(await decrypt(env.MASTER_KEY, row.encrypted_payload)) as ProxyNode,
    );
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
      if (url === "manual:") continue;
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
*{box-sizing:border-box}body{font:15px system-ui;margin:0;background:#f6f7fb;color:#18202a}
.shell{width:min(1180px,100%);margin:auto;padding:24px clamp(12px,3vw,28px)}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
section{background:#fff;padding:clamp(16px,3vw,24px);margin:16px 0;border-radius:16px;box-shadow:0 4px 20px #0001}
h1,h2,h3{margin-top:0}button,a.action{display:inline-flex;align-items:center;justify-content:center;padding:10px 14px;margin:4px;border:1px solid #ccd;border-radius:9px;text-decoration:none}
button{background:#1769e0;color:#fff;cursor:pointer}button.secondary,a.action{background:#fff;color:#18202a}.danger{color:#b42318!important;border-color:#f0b4ae!important}
textarea{width:100%;min-height:116px;padding:12px;border:1px solid #ccd;border-radius:10px;resize:vertical;font:inherit}
.hint{color:#667085;line-height:1.55}.toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
pre{white-space:pre-wrap;word-break:break-word;background:#f8fafc;padding:12px;border-radius:8px;min-height:80px}
.cards,.source-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));gap:16px;margin-top:18px}
.card{border:1px solid #e2e7f0;border-radius:12px;padding:16px;text-align:center;background:#fbfcff}
.card img{width:210px;height:210px;max-width:100%;background:#fff;border-radius:8px}
.card code{display:block;text-align:left;word-break:break-all;background:#eef2f8;padding:9px;border-radius:7px;margin:10px 0}
.source-card{border:1px solid #e2e7f0;border-radius:12px;padding:16px;background:#fbfcff}.source-card.off{opacity:.62}
.source-card .meta{color:#667085;font-size:13px;word-break:break-word}.bad{color:#b42318}.good{color:#067647}
@media(max-width:600px){.shell{padding:12px}section{border-radius:12px;margin:12px 0}.toolbar>*{width:100%;margin:0}.card img{width:min(240px,100%);height:auto}header h1{font-size:24px}}
</style>
<div class="shell"><header><h1>sub 节点管理</h1><button class="secondary" id="logout">退出登录</button></header>
<section><h2>节点来源</h2><p class="hint">支持一次添加多条 HTTPS 订阅。每行填写“名称 | 地址”，也可以只填地址自动命名。输入支持 Clash/Mihomo YAML、URI/Base64、SIP008 和 sing-box JSON。</p>
<textarea id="sourceBatch" placeholder="MIKI | https://example.com/subscribe&#10;备用订阅 | https://example.net/nodes"></textarea>
<div class="toolbar"><button id="addSources">批量添加并分析</button><button class="secondary" id="refresh">刷新全部来源</button></div>
<div id="sources" class="source-list"></div></section>
<section><h2>客户端订阅</h2><div class="toolbar"><button id="createSubscription">创建一组客户端订阅</button></div>
<div id="cards" class="cards"></div>
<details><summary>运行状态</summary><pre id="output">正在加载…</pre></details></section></div>
<script>
const output=document.querySelector("#output");
const cards=document.querySelector("#cards");
const sourcesBox=document.querySelector("#sources");
async function api(path,options={}){
  const response=await fetch(path,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});
  if(response.status===401){location.href="/login";throw new Error("登录已失效")}
  const text=await response.text();
  if(!response.ok)throw new Error(text||("HTTP "+response.status));
  return text?JSON.parse(text):{};
}
function addCard(title,url){
  const card=document.createElement("article");card.className="card";
  const heading=document.createElement("h3");heading.textContent=title;
  const image=document.createElement("img");image.alt=title+" 二维码";image.src="/api/qr?value="+encodeURIComponent(url);
  const code=document.createElement("code");code.textContent=url;
  const open=document.createElement("a");open.href=url;open.target="_blank";open.rel="noreferrer";open.textContent="打开链接";
  const copy=document.createElement("button");copy.className="secondary";copy.textContent="复制链接";
  copy.addEventListener("click",async()=>{await navigator.clipboard.writeText(url);copy.textContent="已复制";setTimeout(()=>copy.textContent="复制链接",1200)});
  card.append(heading,image,code,open,copy);cards.append(card);
}
function renderSubscriptions(items){
  cards.replaceChildren();
  if(!items.length){const empty=document.createElement("p");empty.textContent="尚未创建客户端订阅";cards.append(empty);return}
  for(const item of items){
    addCard("Clash · "+item.label,item.clash);
    addCard("MerlinClash · "+item.label,item.merlinclash);
    addCard("Shadowrocket · "+item.label,item.shadowrocket);
  }
}
function renderSources(state){
  sourcesBox.replaceChildren();
  const summaries=new Map();
  for(const item of state.nodeSummary){
    const current=summaries.get(item.source_id)||{count:0,protocols:new Set()};
    current.count+=Number(item.count);current.protocols.add(item.protocol);summaries.set(item.source_id,current);
  }
  for(const source of state.sources){
    const info=summaries.get(source.id)||{count:0,protocols:new Set()};
    const card=document.createElement("article");card.className="source-card"+(source.enabled?"":" off");
    const heading=document.createElement("h3");heading.textContent=source.name;
    const status=document.createElement("p");status.className=source.last_error?"bad":"good";
    status.textContent=source.last_error?("错误："+source.last_error):(source.enabled?"已启用":"已停用");
    const meta=document.createElement("p");meta.className="meta";
    meta.textContent="节点 "+info.count+" · "+(Array.from(info.protocols).join(" / ")||"等待刷新");
    const actions=document.createElement("div");actions.className="toolbar";
    const toggle=document.createElement("button");toggle.className="secondary";toggle.textContent=source.enabled?"停用":"启用";
    toggle.addEventListener("click",async()=>{await api("/api/sources/"+source.id,{method:"PATCH",body:JSON.stringify({enabled:!source.enabled})});await api("/api/refresh",{method:"POST",body:"{}"});await load()});
    const remove=document.createElement("button");remove.className="secondary danger";remove.textContent="删除";
    remove.addEventListener("click",async()=>{if(!confirm("确定删除节点来源“"+source.name+"”吗？"))return;await api("/api/sources/"+source.id,{method:"DELETE"});await api("/api/refresh",{method:"POST",body:"{}"});await load()});
    actions.append(toggle,remove);card.append(heading,status,meta,actions);sourcesBox.append(card);
  }
}
async function load(){
  try{
    const [state,subscriptions]=await Promise.all([api("/api/state"),api("/api/subscriptions")]);
    output.textContent=JSON.stringify(state,null,2);
    renderSources(state);
    renderSubscriptions(subscriptions);
  }catch(error){output.textContent=String(error)}
}
document.querySelector("#addSources").addEventListener("click",async()=>{
  try{
    const lines=document.querySelector("#sourceBatch").value.split(/\\r?\\n/).map(item=>item.trim()).filter(Boolean);
    if(!lines.length)throw new Error("请至少填写一条订阅地址");
    const entries=lines.map((line,index)=>{
      const separator=line.indexOf("|");
      if(separator<0)return{name:"订阅 "+(index+1),url:line};
      return{name:line.slice(0,separator).trim()||("订阅 "+(index+1)),url:line.slice(separator+1).trim()};
    });
    await api("/api/sources/batch",{method:"POST",body:JSON.stringify({entries})});
    document.querySelector("#sourceBatch").value="";
    output.textContent=JSON.stringify(await api("/api/refresh",{method:"POST",body:"{}"}),null,2);
    await load();
  }catch(error){output.textContent=String(error)}
});
document.querySelector("#refresh").addEventListener("click",async()=>{
  try{output.textContent=JSON.stringify(await api("/api/refresh",{method:"POST",body:"{}"}),null,2);await load()}
  catch(error){output.textContent=String(error)}
});
document.querySelector("#createSubscription").addEventListener("click",async()=>{
  try{await api("/api/subscriptions",{method:"POST",body:JSON.stringify({label:"MIKI"})});await load()}
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

app.post("/api/sources/manual", async (c) => {
  const body = await c.req.json<{ name?: string; raw?: string; priority?: number }>();
  const name = body.name?.trim();
  const raw = body.raw?.trim();
  if (!name || !raw) return c.json({ error: "名称和节点内容不能为空" }, 400);
  const id = crypto.randomUUID();
  const nodes = await parseNodes(raw, id);
  if (!nodes.length) return c.json({ error: "未解析出支持的节点" }, 400);
  const priority = Math.max(0, Math.min(1000, Number(body.priority ?? 50)));
  const timestamp = now();
  const payloads = await Promise.all(
    nodes.map((node) => encrypt(c.env.MASTER_KEY, JSON.stringify(node.proxy))),
  );
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO sources(id,name,encrypted_url,priority,last_success_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    ).bind(
      id,
      name,
      await encrypt(c.env.MASTER_KEY, "manual:"),
      priority,
      timestamp,
      timestamp,
      timestamp,
    ),
    ...nodes.map((node, index) => c.env.DB.prepare(
      "INSERT INTO nodes(id,source_id,fingerprint,name,region,protocol,encrypted_payload,sort_order,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).bind(
      node.id,
      id,
      node.fingerprint,
      node.name,
      node.region,
      node.protocol,
      payloads[index],
      index,
      timestamp,
    )),
  ]);
  return c.json({ id, sourceNodes: nodes.length, ...await build(c.env) }, 201);
});

app.post("/api/sources/batch", async (c) => {
  const body = await c.req.json<{ entries?: Array<{ name?: string; url?: string }> }>();
  if (!Array.isArray(body.entries) || !body.entries.length || body.entries.length > 20) {
    return c.json({ error: "每次需要提交 1 到 20 条订阅" }, 400);
  }
  const entries: Array<{ id: string; name: string; url: string }> = [];
  for (const [index, entry] of body.entries.entries()) {
    const name = entry.name?.trim() || `订阅 ${index + 1}`;
    let url: URL;
    try {
      url = new URL(entry.url || "");
    } catch {
      return c.json({ error: `第 ${index + 1} 条订阅地址无效` }, 400);
    }
    if (url.protocol !== "https:") {
      return c.json({ error: `第 ${index + 1} 条只允许 HTTPS` }, 400);
    }
    entries.push({ id: crypto.randomUUID(), name, url: url.toString() });
  }
  const timestamp = now();
  const encrypted = await Promise.all(
    entries.map((entry) => encrypt(c.env.MASTER_KEY, entry.url)),
  );
  await c.env.DB.batch(entries.map((entry, index) => c.env.DB.prepare(
    "INSERT INTO sources(id,name,encrypted_url,created_at,updated_at) VALUES(?,?,?,?,?)",
  ).bind(entry.id, entry.name, encrypted[index], timestamp, timestamp)));
  return c.json({ added: entries.length }, 201);
});

app.patch("/api/sources/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ enabled?: boolean; name?: string }>();
  const source = await c.env.DB.prepare("SELECT 1 ok FROM sources WHERE id=?").bind(id).first();
  if (!source) return c.json({ error: "节点来源不存在" }, 404);
  if (typeof body.enabled === "boolean") {
    await c.env.DB.prepare("UPDATE sources SET enabled=?,updated_at=? WHERE id=?")
      .bind(body.enabled ? 1 : 0, now(), id).run();
  }
  if (typeof body.name === "string" && body.name.trim()) {
    await c.env.DB.prepare("UPDATE sources SET name=?,updated_at=? WHERE id=?")
      .bind(body.name.trim(), now(), id).run();
  }
  return c.json({ ok: true });
});

app.delete("/api/sources/:id", async (c) => {
  const result = await c.env.DB.prepare("DELETE FROM sources WHERE id=?")
    .bind(c.req.param("id")).run();
  if (!result.meta.changes) return c.json({ error: "节点来源不存在" }, 404);
  return c.json({ ok: true });
});

app.post("/api/refresh", async (c) => c.json(await refresh(c.env)));

app.get("/api/subscriptions", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT encrypted_token,label FROM subscriptions WHERE enabled=1 ORDER BY created_at DESC",
  ).all<{ encrypted_token: string; label: string }>();
  const base = new URL(c.req.url).origin;
  const output = [];
  for (const row of rows.results) {
    const value = await decrypt(c.env.MASTER_KEY, row.encrypted_token);
    output.push({
      label: row.label,
      clash: `${base}/s/${value}/clash`,
      merlinclash: `${base}/s/${value}/merlinclash`,
      shadowrocket: `${base}/s/${value}/shadowrocket`,
    });
  }
  return c.json(output);
});

app.get("/api/qr", (c) => {
  const value = c.req.query("value") || "";
  const base = new URL(c.req.url).origin;
  if (!value.startsWith(`${base}/s/`)) {
    return c.json({ error: "二维码地址无效" }, 400);
  }
  const svg = new QRCode({
    content: value,
    padding: 2,
    width: 240,
    height: 240,
    ecl: "M",
    join: true,
  }).svg();
  c.header("Content-Type", "image/svg+xml; charset=utf-8");
  c.header("Cache-Control", "no-store");
  return c.body(svg);
});
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
