import { describe, expect, it } from "vitest";
import { nodeUri, parseNodes, renderMihomoNodes } from "../src/core";
import { parse } from "yaml";

const encoded = (value: string) => Buffer.from(value, "utf8").toString("base64");

describe("仅节点订阅", () => {
  it("只输出 proxies，不混入规则和策略组", () => {
    const content = renderMihomoNodes([{
      name: "日本测试节点",
      type: "ss",
      server: "jp.example.com",
      port: 8388,
      cipher: "aes-128-gcm",
      password: "secret",
    }]);
    const value = parse(content);
    expect(value.proxies).toHaveLength(1);
    expect(value["proxy-groups"]).toBeUndefined();
    expect(value.rules).toBeUndefined();
    expect(value["rule-providers"]).toBeUndefined();
  });
});

describe("常见订阅格式", () => {
  it("解析 Base64 URI 列表以及 VMess、SS、hy2、TUIC", async () => {
    const vmess = "vmess://" + encoded(JSON.stringify({
      v: "2",
      ps: "美国 VMess",
      add: "vmess.example.com",
      port: "443",
      id: "11111111-1111-1111-1111-111111111111",
      aid: "0",
      scy: "auto",
      net: "ws",
      host: "cdn.example.com",
      path: "/ws",
      tls: "tls",
      sni: "cdn.example.com",
    }));
    const ss = "ss://" + encoded("aes-128-gcm:password") + "@ss.example.com:8388#日本%20SS";
    const hy2 = "hy2://password@hy2.example.com:8443?sni=hy2.example.com#美国%20HY2";
    const tuic = "tuic://22222222-2222-2222-2222-222222222222:password@tuic.example.com:443?sni=tuic.example.com#新加坡%20TUIC";
    const nodes = await parseNodes(encoded([vmess, ss, hy2, tuic].join("\n")), "encoded");

    expect(nodes.map((node) => node.protocol)).toEqual(["vmess", "ss", "hysteria2", "tuic"]);
    expect(nodeUri(nodes[0].proxy)).toMatch(/^vmess:\/\//);
    expect(nodeUri(nodes[1].proxy)).toMatch(/^ss:\/\//);
  });

  it("解析 SIP008 JSON", async () => {
    const source = JSON.stringify({
      version: 1,
      servers: [{
        id: "sip008",
        remarks: "英国 SIP008",
        server: "ss.example.net",
        server_port: 8388,
        method: "aes-256-gcm",
        password: "secret",
      }],
    });
    const nodes = await parseNodes(source, "sip008");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ protocol: "ss", region: "英国" });
  });

  it("解析 sing-box JSON", async () => {
    const source = JSON.stringify({
      outbounds: [
        { type: "direct", tag: "direct" },
        {
          type: "vless",
          tag: "韩国 sing-box",
          server: "kr.example.net",
          server_port: 443,
          uuid: "33333333-3333-3333-3333-333333333333",
          tls: { enabled: true, server_name: "www.microsoft.com" },
          transport: { type: "ws", path: "/ws", headers: { Host: "cdn.example.net" } },
        },
      ],
    });
    const nodes = await parseNodes(source, "sing-box");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ protocol: "vless", region: "韩国" });
    expect(nodes[0].proxy.network).toBe("ws");
  });
});
