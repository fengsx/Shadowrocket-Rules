import { parse, stringify } from "yaml";
import type { ManifestGroup, ManifestRule, ProxyNode, RuleManifest, StoredNode } from "./types";

const SUPPORTED = new Set(["vless", "vmess", "trojan", "hysteria2", "ss", "tuic"]);
const REGION_RULES: Array<[RegExp, string]> = [
  [/(?:香港|\bhk\b|hong\s*kong)/i, "香港"],
  [/(?:台湾|台北|\btw\b|taiwan|taipei)/i, "台湾"],
  [/(?:日本|东京|大阪|\bjp\b|japan|tokyo)/i, "日本"],
  [/(?:美国|\bus\b|usa|united\s*states|los\s*angeles|纽约)/i, "美国"],
  [/(?:韩国|首尔|\bkr\b|korea|seoul|icn|sel)/i, "韩国"],
  [/(?:英国|伦敦|\buk\b|britain|london|lhr)/i, "英国"],
  [/(?:新加坡|狮城|\bsg\b|singapore)/i, "新加坡"],
];

const str = (value: unknown) => typeof value === "string" ? value : "";
const bool = (value: unknown) => value === true || value === 1 || value === "true";
const region = (name: string) => REGION_RULES.find(([rule]) => rule.test(name))?.[1] ?? "";
export function normalizeProxyNode(proxy: ProxyNode): ProxyNode {
  const name = str(proxy.name);
  const rules: Array<[RegExp, string]> = [
    [/^Aliyun-Tokyo-Reality$/i, "🇯🇵 日本01·东京 Reality"],
    [/^Aliyun-Tokyo-(?:HY2|Hysteria2)$/i, "🇯🇵 日本02·东京 Hysteria2"],
    [/^Oracle-(?:Korea-)?REALITY$/i, "🇰🇷 韩国01·Oracle Reality"],
    [/^Oracle-(?:Korea-)?(?:HY2|Hysteria2)$/i, "🇰🇷 韩国02·Oracle Hysteria2"],
  ];
  const renamed = rules.find(([pattern]) => pattern.test(name))?.[1];
  return renamed ? { ...proxy, name: renamed } : proxy;
}
const normalizedType = (value: unknown) => {
  const type = str(value).toLowerCase();
  return type === "hy2" ? "hysteria2" : type;
};

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stable(item)]),
    );
  }
  return value;
}

export function proxyKey(proxy: ProxyNode): string {
  return JSON.stringify(stable(proxy));
}

function decode64(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/").replace(/\s+/g, "");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function encode64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function vmessUri(uri: string): ProxyNode | null {
  try {
    const value = JSON.parse(decode64(uri.trim().slice(8))) as Record<string, unknown>;
    const server = str(value.add);
    const port = Number(value.port);
    if (!server || !Number.isInteger(port)) return null;
    const network = str(value.net) || "tcp";
    const proxy: ProxyNode = {
      name: str(value.ps) || `vmess ${server}`,
      type: "vmess",
      server,
      port,
      uuid: str(value.id),
      alterId: Number(value.aid || 0),
      cipher: str(value.scy) || "auto",
      network,
      udp: true,
      tls: str(value.tls) === "tls",
      servername: str(value.sni) || str(value.host) || server,
    };
    if (network === "ws") {
      proxy["ws-opts"] = {
        path: str(value.path) || "/",
        headers: str(value.host) ? { Host: str(value.host) } : {},
      };
    }
    return proxy;
  } catch {
    return null;
  }
}

function ssUri(uri: string): ProxyNode | null {
  try {
    const raw = uri.trim().slice(5);
    const hashAt = raw.indexOf("#");
    const fragment = hashAt >= 0 ? raw.slice(hashAt + 1) : "";
    const withoutHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
    const queryAt = withoutHash.indexOf("?");
    const main = queryAt >= 0 ? withoutHash.slice(0, queryAt) : withoutHash;
    const query = new URLSearchParams(queryAt >= 0 ? withoutHash.slice(queryAt + 1) : "");
    let credentials = "";
    let endpoint = "";
    if (main.includes("@")) {
      const at = main.lastIndexOf("@");
      credentials = main.slice(0, at);
      endpoint = main.slice(at + 1);
      if (!decodeURIComponent(credentials).includes(":")) credentials = decode64(credentials);
      else credentials = decodeURIComponent(credentials);
    } else {
      const decoded = decode64(main);
      const at = decoded.lastIndexOf("@");
      if (at < 0) return null;
      credentials = decoded.slice(0, at);
      endpoint = decoded.slice(at + 1);
    }
    const colon = credentials.indexOf(":");
    if (colon < 1) return null;
    const parsed = new URL(`ss://x@${endpoint}`);
    const port = Number(parsed.port);
    if (!parsed.hostname || !Number.isInteger(port)) return null;
    const proxy: ProxyNode = {
      name: decodeURIComponent(fragment) || `ss ${parsed.hostname}`,
      type: "ss",
      server: parsed.hostname,
      port,
      cipher: credentials.slice(0, colon),
      password: credentials.slice(colon + 1),
      udp: true,
    };
    if (query.get("plugin")) proxy.plugin = query.get("plugin") || "";
    return proxy;
  } catch {
    return null;
  }
}

function uriProxy(uri: string): ProxyNode | null {
  const trimmed = uri.trim();
  if (trimmed.toLowerCase().startsWith("vmess://")) return vmessUri(trimmed);
  if (trimmed.toLowerCase().startsWith("ss://")) return ssUri(trimmed);
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  const type = normalizedType(parsed.protocol.slice(0, -1));
  if (!SUPPORTED.has(type)) return null;
  const name = decodeURIComponent(parsed.hash.slice(1)) || `${type} ${parsed.hostname}`;
  const common: ProxyNode = {
    name,
    type,
    server: parsed.hostname,
    port: Number(parsed.port),
    udp: true,
  };
  if (!common.port) return null;
  if (type === "vless") {
    common.uuid = decodeURIComponent(parsed.username);
    common.network = parsed.searchParams.get("type") || "tcp";
    const security = parsed.searchParams.get("security");
    common.tls = security === "tls" || security === "reality";
    common.servername = parsed.searchParams.get("sni") || parsed.hostname;
    common["client-fingerprint"] = parsed.searchParams.get("fp") || "chrome";
    if (security === "reality") {
      common["reality-opts"] = {
        "public-key": parsed.searchParams.get("pbk") || "",
        "short-id": parsed.searchParams.get("sid") || "",
      };
    }
    if (common.network === "ws") {
      common["ws-opts"] = {
        path: parsed.searchParams.get("path") || "/",
        headers: parsed.searchParams.get("host") ? { Host: parsed.searchParams.get("host") } : {},
      };
    }
  } else if (type === "trojan") {
    common.password = decodeURIComponent(parsed.username);
    common.sni = parsed.searchParams.get("sni") || parsed.hostname;
    common["skip-cert-verify"] = parsed.searchParams.get("allowInsecure") === "1";
  } else if (type === "hysteria2") {
    common.password = decodeURIComponent(parsed.username);
    common.sni = parsed.searchParams.get("sni") || parsed.hostname;
    common["skip-cert-verify"] = ["1", "true"].includes(parsed.searchParams.get("insecure") || "");
  } else if (type === "tuic") {
    common.uuid = decodeURIComponent(parsed.username);
    common.password = decodeURIComponent(parsed.password);
    common.sni = parsed.searchParams.get("sni") || parsed.hostname;
    common["congestion-controller"] = parsed.searchParams.get("congestion_control") || "bbr";
    common["skip-cert-verify"] = ["1", "true"].includes(parsed.searchParams.get("allow_insecure") || "");
  }
  return common;
}

function singBoxProxy(value: Record<string, unknown>): ProxyNode | null {
  const type = normalizedType(value.type);
  if (!SUPPORTED.has(type)) return null;
  const server = str(value.server);
  const port = Number(value.server_port);
  if (!server || !Number.isInteger(port)) return null;
  const tls = value.tls as Record<string, unknown> | undefined;
  const transport = value.transport as Record<string, unknown> | undefined;
  const proxy: ProxyNode = {
    name: str(value.tag) || `${type} ${server}`,
    type,
    server,
    port,
    udp: true,
  };
  for (const key of ["uuid", "password", "method"] as const) {
    if (value[key] !== undefined) {
      const target = key === "method" ? "cipher" : key;
      proxy[target] = value[key];
    }
  }
  if (value.alter_id !== undefined) proxy.alterId = Number(value.alter_id);
  if (type === "vmess") proxy.cipher = proxy.cipher || "auto";
  if (tls?.enabled) {
    proxy.tls = true;
    proxy.servername = str(tls.server_name) || server;
    proxy.sni = str(tls.server_name) || server;
    proxy["skip-cert-verify"] = bool(tls.insecure);
  }
  if (transport?.type) {
    proxy.network = str(transport.type);
    if (transport.type === "ws") {
      proxy["ws-opts"] = {
        path: str(transport.path) || "/",
        headers: transport.headers || {},
      };
    }
  }
  return proxy;
}

function structuredProxies(raw: string): ProxyNode[] {
  try {
    const document = parse(raw) as Record<string, unknown>;
    if (Array.isArray(document?.proxies)) return document.proxies as ProxyNode[];
    if (Array.isArray(document?.servers)) {
      return (document.servers as Array<Record<string, unknown>>).map((server) => ({
        name: str(server.remarks) || str(server.id) || `ss ${str(server.server)}`,
        type: "ss",
        server: str(server.server),
        port: Number(server.server_port),
        cipher: str(server.method),
        password: str(server.password),
        plugin: str(server.plugin),
        "plugin-opts": str(server.plugin_opts),
        udp: true,
      }));
    }
    if (Array.isArray(document?.outbounds)) {
      return (document.outbounds as Array<Record<string, unknown>>)
        .map(singBoxProxy)
        .filter(Boolean) as ProxyNode[];
    }
  } catch {
    return [];
  }
  return [];
}

export async function parseNodes(raw: string, sourceId: string): Promise<StoredNode[]> {
  let values = structuredProxies(raw);
  if (!values.length) {
    let text = raw.trim();
    try {
      const decoded = decode64(text);
      if (/^(?:vless|vmess|trojan|hysteria2|hy2|ss|tuic):\/\//im.test(decoded)) text = decoded;
    } catch {
      // 输入本身可能已经是 URI 列表。
    }
    values = text.split(/\r?\n/)
      .map((line) => uriProxy(line))
      .filter(Boolean) as ProxyNode[];
  }
  const output: StoredNode[] = [];
  const seen = new Set<string>();
  let order = 0;
  for (const value of values) {
    const type = normalizedType(value.type);
    const server = str(value.server);
    const port = Number(value.port);
    const name = str(value.name) || `${type} ${server}`;
    const informational = /^(?:剩余流量|距离下次重置剩余|套餐到期|🗓 节点版本|如果节点很少)[：:]?/.test(name);
    if (informational || !SUPPORTED.has(type) || !server || !Number.isInteger(port)) continue;
    const proxy = { ...value, name, type, server, port } as ProxyNode;
    const fingerprint = await digest(proxyKey(proxy));
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    output.push({
      id: `${sourceId}-${order++}`,
      sourceId,
      fingerprint,
      name,
      region: region(name),
      protocol: type,
      proxy,
    });
  }
  return output;
}

function hostPort(node: ProxyNode) {
  return `${node.server.includes(":") ? `[${node.server}]` : node.server}:${node.port}`;
}

export function nodeUri(node: ProxyNode): string {
  if (node.type === "vmess") {
    const ws = node["ws-opts"] as Record<string, unknown> | undefined;
    const headers = ws?.headers as Record<string, unknown> | undefined;
    return `vmess://${encode64(JSON.stringify({
      v: "2",
      ps: node.name,
      add: node.server,
      port: String(node.port),
      id: str(node.uuid),
      aid: String(node.alterId || 0),
      scy: str(node.cipher) || "auto",
      net: str(node.network) || "tcp",
      type: "none",
      host: str(headers?.Host),
      path: str(ws?.path),
      tls: bool(node.tls) ? "tls" : "",
      sni: str(node.servername),
    }))}`;
  }
  const query = new URLSearchParams();
  let authentication = "";
  if (node.type === "vless") {
    authentication = encodeURIComponent(str(node.uuid));
    const network = str(node.network) || "tcp";
    query.set("type", network);
    query.set("encryption", str(node.encryption) || "none");
    if (str(node.flow)) query.set("flow", str(node.flow));
    query.set("security", bool(node.tls) ? (node["reality-opts"] ? "reality" : "tls") : "none");
    query.set("sni", str(node.servername) || node.server);
    query.set("fp", str(node["client-fingerprint"]) || "chrome");
    query.set("insecure", bool(node["skip-cert-verify"]) ? "1" : "0");
    const reality = node["reality-opts"] as Record<string, unknown> | undefined;
    if (reality) {
      query.set("pbk", str(reality["public-key"]));
      query.set("sid", str(reality["short-id"]));
    }
    if (network === "ws") {
      const ws = node["ws-opts"] as Record<string, unknown> | undefined;
      const headers = ws?.headers as Record<string, unknown> | undefined;
      query.set("path", str(ws?.path) || "/");
      if (str(headers?.Host)) query.set("host", str(headers?.Host));
    }
    if (network === "grpc") {
      const grpc = node["grpc-opts"] as Record<string, unknown> | undefined;
      const serviceName = str(grpc?.["grpc-service-name"] ?? grpc?.serviceName);
      if (serviceName) query.set("serviceName", serviceName);
    }
  } else if (node.type === "trojan") {
    authentication = encodeURIComponent(str(node.password));
    query.set("sni", str(node.sni) || node.server);
    if (bool(node["skip-cert-verify"])) query.set("allowInsecure", "1");
  } else if (node.type === "hysteria2") {
    authentication = encodeURIComponent(str(node.password));
    query.set("sni", str(node.sni) || node.server);
    if (bool(node["skip-cert-verify"])) query.set("insecure", "1");
  } else if (node.type === "tuic") {
    authentication = `${encodeURIComponent(str(node.uuid))}:${encodeURIComponent(str(node.password))}`;
    query.set("sni", str(node.sni) || node.server);
    query.set("congestion_control", str(node["congestion-controller"]) || "bbr");
    if (bool(node["skip-cert-verify"])) query.set("allow_insecure", "1");
  } else {
    authentication = encode64(`${str(node.cipher)}:${str(node.password)}`);
    if (str(node.plugin)) query.set("plugin", str(node.plugin));
  }
  return `${node.type}://${authentication}@${hostPort(node)}${query.size ? `?${query}` : ""}#${encodeURIComponent(node.name)}`;
}

const mapped = (name: string) => name === "🚀 节点选择" ? "PROXY" : name;

function groups(nodes: ProxyNode[], manifest: RuleManifest) {
  const names = nodes.map((node) => node.name);
  const result: Array<Record<string, unknown>> = [
    { name: "PROXY", type: "select", proxies: ["AUTO", ...names, "DIRECT"] },
    {
      name: "AUTO",
      type: "url-test",
      proxies: names,
      url: "https://www.gstatic.com/generate_204",
      interval: 300,
      tolerance: 80,
      lazy: true,
    },
  ];
  for (const group of manifest.policyGroups) {
    if (group.name === "🚀 节点选择") continue;
    if (group.type === "url-test") {
      let selected: string[] = [];
      try {
        const rule = new RegExp(group.attributes["policy-regex-filter"] || ".+", "i");
        selected = nodes.filter((node) => rule.test(node.name)).map((node) => node.name);
      } catch {
        selected = [];
      }
      result.push({
        name: group.name,
        type: "url-test",
        proxies: selected.length ? selected : ["REJECT"],
        url: group.attributes.url || "https://www.gstatic.com/generate_204",
        interval: Number(group.attributes.interval || 600),
        tolerance: Number(group.attributes.tolerance || 80),
        lazy: true,
      });
    } else {
      const options = [...new Set(group.options.map(mapped).filter((option) => option !== group.name))];
      const entry: Record<string, unknown> = {
        name: group.name,
        type: group.type,
        proxies: options.length ? options : ["PROXY", "DIRECT"],
      };
      if (group.type === "fallback") {
        entry.url = group.attributes.url || "https://www.gstatic.com/generate_204";
        entry.interval = Number(group.attributes.interval || 300);
        entry.lazy = true;
      }
      result.push(entry);
    }
  }
  return result;
}

function providerBaseName(url: string) {
  const filename = new URL(url).pathname.split("/").pop() || "";
  const stem = filename
    .replace(/\.[^.]+$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  if (!stem) throw new Error(`无法从规则地址生成可读名称：${url}`);
  return `fengsx_${stem}`;
}

function providers(rules: ManifestRule[]) {
  const data: Record<string, unknown> = {};
  const ids = new Map<string, string>();
  const used = new Set<string>();
  for (const rule of rules) {
    if (!["rule_set", "domain_set"].includes(rule.kind)) continue;
    const base = providerBaseName(rule.value);
    let name = base;
    if (used.has(name)) {
      const behavior = rule.kind === "domain_set" ? "domain" : "classical";
      name = `${base}_${behavior}`;
    }
    let suffix = 2;
    while (used.has(name)) {
      name = `${base}_${String(suffix).padStart(2, "0")}`;
      suffix += 1;
    }
    used.add(name);
    data[name] = {
      type: "http",
      behavior: rule.kind === "domain_set" ? "domain" : "classical",
      format: "text",
      url: rule.value,
      path: `./ruleset/${name}.list`,
      interval: 21600,
    };
    ids.set(rule.id, name);
  }
  return { data, ids };
}

function ruleLine(rule: ManifestRule, ids: Map<string, string>) {
  const target = mapped(rule.target);
  if (rule.kind === "raw") return `${rule.value.replace("PROTOCOL,", "NETWORK,")},${target}`;
  if (rule.kind === "rule_set" || rule.kind === "domain_set") {
    return `RULE-SET,${ids.get(rule.id)},${target}`;
  }
  const tokens: Record<string, string> = {
    domain: "DOMAIN",
    domain_suffix: "DOMAIN-SUFFIX",
    domain_keyword: "DOMAIN-KEYWORD",
    cidr: "IP-CIDR",
    cidr6: "IP-CIDR6",
    geoip: "GEOIP",
  };
  return `${tokens[rule.kind]},${rule.value},${target}${rule.noResolve ? ",no-resolve" : ""}`;
}

export function renderMihomo(nodes: ProxyNode[], manifest: RuleManifest, merlin: boolean) {
  const provider = providers(manifest.rules);
  const config: Record<string, unknown> = {
    "mixed-port": 7890,
    "allow-lan": merlin,
    mode: "rule",
    "log-level": "warning",
    ipv6: false,
    dns: {
      enable: true,
      ipv6: false,
      listen: merlin ? "0.0.0.0:1053" : "127.0.0.1:1053",
      "enhanced-mode": "fake-ip",
      "fake-ip-range": "198.18.0.1/16",
      "respect-rules": true,
      "default-nameserver": ["223.5.5.5", "119.29.29.29"],
      nameserver: ["https://cloudflare-dns.com/dns-query", "https://dns.google/dns-query"],
      "direct-nameserver": ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"],
      "proxy-server-nameserver": ["https://dns.alidns.com/dns-query", "https://doh.pub/dns-query"],
    },
    proxies: nodes,
    "proxy-groups": groups(nodes, manifest),
    "rule-providers": provider.data,
    rules: [
      ...nodes.map((node) => `DOMAIN,${node.server},DIRECT`),
      ...manifest.rules.map((rule) => ruleLine(rule, provider.ids)),
      `MATCH,${mapped(manifest.finalTarget)}`,
    ],
  };
  if (merlin) {
    config["redir-port"] = 7892;
    config["tproxy-port"] = 7893;
    config["bind-address"] = "*";
  }
  return stringify(config);
}

export function renderShadowrocket(nodes: ProxyNode[]) {
  return encode64(nodes.map(nodeUri).join("\n"));
}
