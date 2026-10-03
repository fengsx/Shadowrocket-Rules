import { describe, expect, it } from "vitest";
import { parseNodes } from "../src/core";

const mikiUrl = process.env.MIKI_SOURCE_URL;
const tokyoUrl = process.env.TOKYO_SOURCE_URL;

describe.runIf(Boolean(mikiUrl && tokyoUrl))("真实订阅来源", () => {
  it("分析 MIKI 与东京 VPN，不输出订阅凭据", async () => {
    const response = await fetch(mikiUrl!, {
      headers: { "User-Agent": "Clash.Meta", Accept: "*/*" },
    });
    expect(response.ok).toBe(true);
    const miki = await parseNodes(await response.text(), "miki");
    const tokyoResponse = await fetch(tokyoUrl!, { headers: { "User-Agent": "Clash.Meta" } });
    expect(tokyoResponse.ok).toBe(true);
    const tokyo = await parseNodes(await tokyoResponse.text(), "tokyo");

    const summary = (nodes: Awaited<ReturnType<typeof parseNodes>>) => ({
      count: nodes.length,
      protocols: [...new Set(nodes.map((node) => node.protocol))].sort(),
      regions: [...new Set(nodes.map((node) => node.region).filter(Boolean))].sort(),
    });

    console.log(JSON.stringify({ miki: summary(miki), tokyo: summary(tokyo) }));

    expect(miki.length).toBeGreaterThan(0);
    expect(tokyo.length).toBe(2);
    expect(new Set(miki.map((node) => node.protocol))).toEqual(new Set(["trojan", "vless"]));
    expect(new Set(tokyo.map((node) => node.protocol))).toEqual(new Set(["hysteria2", "vless"]));
  });
});
