import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { nodeUri, parseNodes, renderMihomo, renderShadowrocket } from "../src/core";
import type { RuleManifest } from "../src/types";

const manifest: RuleManifest = {
  schemaVersion: 1,
  source: { repository: "fengsx/Shadowrocket-Rules", path: "Shadowrocket.conf", sha256: "rule-sha" },
  policyGroups: [
    { name: "🚀 节点选择", type: "select", options: ["🇺🇸 美国节点", "DIRECT"], attributes: {} },
    { name: "🇺🇸 美国节点", type: "url-test", options: [], attributes: { "policy-regex-filter": "美国|US", url: "https://www.gstatic.com/generate_204", interval: "600", tolerance: "80" } },
  ],
  rules: [
    { id: "rule-0001", position: 10, kind: "domain_suffix", value: "example.com", target: "🇺🇸 美国节点", noResolve: false },
    { id: "rule-0002", position: 20, kind: "rule_set", value: "https://example.com/direct.list", target: "DIRECT", noResolve: false },
  ],
  finalTarget: "🚀 节点选择",
};

const clashSource = `
proxies:
  - name: 美国 Reality
    type: vless
    server: us.example.net
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    network: tcp
    tls: true
    client-fingerprint: chrome
    servername: www.microsoft.com
    reality-opts:
      public-key: public-key
      short-id: abcd
  - name: 东京 Hysteria2
    type: hysteria2
    server: jp.example.net
    port: 8443
    password: secret
    sni: jp.example.net
  - name: 重复节点
    type: hysteria2
    server: jp.example.net
    port: 8443
    password: secret
    sni: jp.example.net
`;

describe("节点解析与输出", () => {
  it("解析 Clash YAML、识别区域并按连接参数去重", async () => {
    const nodes = await parseNodes(clashSource, "source-a");
    expect(nodes).toHaveLength(2);
    expect(nodes.map((node) => node.protocol)).toEqual(["vless", "hysteria2"]);
    expect(nodes.map((node) => node.region)).toEqual(["美国", "日本"]);
  });

  it("解析 URI 列表中的 Trojan", async () => {
    const nodes = await parseNodes("trojan://password@uk.example.net:443?sni=uk.example.net#英国%20Trojan", "source-b");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].protocol).toBe("trojan");
    expect(nodes[0].region).toBe("英国");
  });

  it("生成 Clash 与 MerlinClash，并保持相同规则顺序", async () => {
    const nodes = (await parseNodes(clashSource, "source-a")).map((node) => node.proxy);
    const clash = parse(renderMihomo(nodes, manifest, false)) as any;
    const merlin = parse(renderMihomo(nodes, manifest, true)) as any;
    expect(clash.rules).toEqual(merlin.rules);
    expect(clash.rules.slice(-3)).toEqual([
      "DOMAIN-SUFFIX,example.com,🇺🇸 美国节点",
      "RULE-SET,rules_01,DIRECT",
      "MATCH,PROXY",
    ]);
    expect(clash.ipv6).toBe(false);
    expect(merlin["allow-lan"]).toBe(true);
    expect(merlin["tproxy-port"]).toBe(7893);
  });

  it("生成 Shadowrocket 可解码的 Base64 节点订阅", async () => {
    const nodes = (await parseNodes(clashSource, "source-a")).map((node) => node.proxy);
    const decoded = Buffer.from(renderShadowrocket(nodes), "base64").toString("utf8");
    expect(decoded.split("\n")).toHaveLength(2);
    expect(decoded).toContain("vless://");
    expect(decoded).toContain("hysteria2://");
    expect(nodeUri(nodes[0])).toContain("security=reality");
  });
});
