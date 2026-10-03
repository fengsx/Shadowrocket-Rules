# Shadowrocket 配置文件

一份开箱即用的 Shadowrocket 规则配置，导入后添加自己的节点或订阅即可使用。

## 默认策略

| 服务 | 默认策略 | 可选策略 |
|------|----------|----------|
| 📧 邮件服务 | PROXY | DIRECT、节点选择、日本节点、香港节点 |
| 🔍 谷歌服务 | 🇯🇵 日本节点 | 🇭🇰 香港节点、节点选择、PROXY、DIRECT |
| 🤖 AI 服务 | 🇺🇸 美国节点 | 节点选择、PROXY、DIRECT |
| 🧱 DNS 防泄露 | REJECT | 节点选择、DIRECT |
| 🍎 苹果推送 | 🚀 节点选择 | PROXY、DIRECT |
| 🍏 苹果服务 | DIRECT | 节点选择、PROXY |
| 🏦 汇丰香港 | DIRECT | 🇭🇰 香港节点、节点选择、PROXY |
| 🏦 香港银行 | DIRECT | 香港节点、节点选择、PROXY |
| 📈 券商服务 | 🇭🇰 香港节点 | DIRECT、节点选择、PROXY |
| 💷 英国金融 | 🇬🇧 英国节点 | 节点选择、PROXY、DIRECT |
| 🌍 非中国 | PROXY | 节点选择、DIRECT、日本节点 |
| 🐟 漏网之鱼 | PROXY | 节点选择、DIRECT、日本节点 |

## 快速开始

Shadowrocket 配置唯一稳定来源为本 fork 的 GitHub Raw；东京服务器只负责组装节点订阅。

1. 复制配置文件的 Raw 链接：
   `https://raw.githubusercontent.com/fengsx/Shadowrocket-Rules/refs/heads/main/Shadowrocket.conf`
2. 打开 Shadowrocket → 配置 → 右上角 `+` → 粘贴链接 → 下载
3. 点击已下载的配置，设为使用中（✔️）
4. 首页添加你自己的节点或订阅
5. 连通性测试，选择可用节点连接

或者扫描下面的 fork 专属二维码（导入的是配置规则，节点订阅仍由 Shadowrocket 单独维护）：

<img width="260" height="260" alt="fengsx Shadowrocket 配置二维码" src="./Shadowrocket-fengsx.png">

## 分流规则

| 序号 | 服务 | 默认策略 |
|--------|------|----------|
| 1 | 📧 邮件服务（IMAP / POP3 / SMTP） | PROXY，可切换 DIRECT 或地区节点 |
| 2 | 🔍 谷歌服务（含 Gemini） | 日本节点，可手动切香港节点 |
| 3 | 🤖 AI 服务（ChatGPT、Claude 等） | 美国节点 |
| 4 | 📹 油管视频（含 YouTube 翻译 API） | 节点选择 |
| 5 | 🔒 哔哩哔哩 | 国内服务（默认 DIRECT） |
| 6 | 🏠 私有网络 / 局域网 | DIRECT |
| 7 | 📲 电报消息 | 节点选择 |
| 8 | 🐱 代码托管（GitHub、GitLab、Atlassian） | 节点选择 |
| 9 | Ⓜ️ 微软服务 | 节点选择 |
| 10 | 🏦 汇丰香港（含 Reward+） | DIRECT |
| 11 | 🏦 其他香港银行 | DIRECT |
| 12 | 📈 券商服务（富途 / moomoo / 长桥 / 老虎 / 雪盈 / 盈透） | 香港节点 |
| 13 | 🍎 苹果推送 | 节点选择 |
| 14 | 🍏 苹果服务 | DIRECT |
| 15 | 🔒 国内服务 | DIRECT |
| 16 | 🌍 非中国（境外流量） | PROXY |
| 17 | GEOIP CN | DIRECT |
| 18 | 🐟 漏网之鱼（兜底） | PROXY |

## 规则集来源

- [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) — 主要规则集
- [iab0x00/ProxyRules](https://github.com/iab0x00/ProxyRules) — AI 服务补充规则
- `Mail.list` 收录 Apple、Gmail、Outlook、Yahoo、Yandex 的邮件协议端点
- `Apple.list` 基于 blackmatrix7 Apple 规则，并配套加载 `Apple_Domain.list`，补充 iCloud Photos / Apple CDN 直连域名
- `HK_Broker.list` 补充富途 / moomoo / 长桥 / 老虎 / 雪盈 / 盈透 / TradeUP / Schwab 证券域名及交易 IP 段
- `HSBC_HK.list` 与 `HK_Banks_Direct.list` 收录香港银行网站及 App 服务域名

## 当前重点

- 优化 DNS 防泄露
   - 代理域名默认通过代理访问 Cloudflare DoH，备用使用 Google DoH
   - 代理 DNS 不回退系统 DNS，避免代理域名查询从本地网络泄露
   - 直连域名使用系统 DNS，改善国内服务和 CDN 调度
   - 扩展常见硬编码 DNS 劫持范围
- 新增 `Mail.list`
   - 精确收录常见 IMAP、POP3 与 SMTP 服务端点
   - 默认使用 PROXY，可手动切换 DIRECT 或地区节点
- 新增 `HK_Broker.list`
   - 补充富途 / moomoo / 长桥券商域名
   - 合并老虎证券域名，不再依赖外部券商规则
   - 补充富途交易相关域名：`futuapi.com`、`futuin.com`、`futuhk1.com`、`futuhongkong.com`、`qtlcdn.com`
   - 补充长桥交易相关域名：`lbkrs.com`、`longbridge.app`、`longportapp.com`
   - 合并 Arthur-vx Broker 规则中的精确 API / 交易域名、IP 段、TradeUP 和 Schwab 域名
   - 补充雪盈证券 / Snowball X 官方及 OpenAPI 域名
   - 补充盈透证券 / Interactive Brokers 官方域名
- 新增香港银行分流
   - 汇丰香港及 Reward+ 默认直连，避免代理出口触发风控或导致 App 反复重试
   - 其他香港银行默认直连，减少代理 IP 变化带来的风控风险
   - 美国运通因不同地区共用主域名，不纳入自动分流
- Google AI 相关规则已并入 `Google.list`
- `🔍 谷歌服务` 默认走日本节点，同时提供香港节点作为手动可选分区，便于在不同网络环境下切换。
- 同步上游 `ApplePush.list`
   - Apple Push Notification service 域名与 TCP 5223 归入 `🍎 苹果推送` 策略组
   - 默认跟随节点选择，可手动切换 PROXY 或 DIRECT。
- 本仓库维护 `Apple.list`
   - 基于 blackmatrix7 的 Apple 规则
   - 配套加载 `Apple_Domain.list`，补齐完整 Apple 域名集
   - 补充 iCloud Photos、CloudKit、Apple CDN 相关域名，优化 iCloud 照片同步。

## 其他特性

- DNS：Cloudflare / Google DoH 经代理并行查询；代理 DNS 失败时回退直连的加密 Cloudflare DoH，国内直连域名使用系统 DNS
- 国内服务：采用上游 China / China_Domain / GEOIP CN 规则并归入 `🔒 国内服务`，该组默认 DIRECT。
- DNS 劫持：拦截常见硬编码 53 端口 DNS，防止应用绕过规则
- 节点域名启动解析：使用直连的 Cloudflare / AliDNS DoH 获取节点真实 IP，避免连接 MerlinClash Fake-IP 网络时节点域名落入 198.18.0.0/15
- HTTPDNS：采用上游 `BlockHttpDNS.list`，默认由 `🧱 DNS 防泄露` 策略组 REJECT
- 邮件分流：常见邮件协议端点默认使用 PROXY，可按网络情况切换直连或地区节点
- QUIC 屏蔽：对代理连接屏蔽 UDP/443，强制回退 HTTP/2
- 本地服务保护：`localhost.weixin.qq.com` 固定解析到 `127.0.0.1` 并强制直连，避免 fake-IP 影响微信本地回调
- Apple 分流：采用上游 Apple / ApplePush 规则和策略组；WLOC 定位域名保留 DIRECT 例外
- 豆包服务：`doubao.com` 明确直连，避免语音及输入法接口因解析 IP 不同而改变出口
- DNS 上游：Cloudflare / Google DoH 经代理并行查询；失败时仅回退直连的加密 Cloudflare DoH，不回退明文系统 DNS
- 局域网解析保护：`*.in-addr.arpa`、`*.ip6.arpa`、`*.local` 前置直连并交给系统解析，补充常见 DNS-SD 反查模式，避免 Bonjour / PTR 反查打到公共 DoH
- TUN 边界：保留 `198.18.0.0/15` 给 fake-IP / TUN 内部使用，不加入排除路由，私网桥接网段仍通过 `10.0.0.0/8`、`192.168.0.0/16` 等排除
- Apple 推送：采用上游策略组，默认跟随节点选择
   - `push.apple.com`
   - `gateway.push.apple.com`
   - `api.push.apple.com`
   - `sandbox.push.apple.com` 
- Google 防跳转：`google.cn` / `g.cn` 自动 302 到 `google.com`
- MITM：解密通配域名 *.google.cn 及 WLOC 所需的 Apple / 高德定位域名（包含 gsp-ssl.ls.apple.com）

## 注意事项

- 地区分组通过节点名称关键词自动匹配；`其他节点` 已排除香港、台湾、日本、美国、英国和韩国关键词
- 银行服务对出口 IP 和 VPN 环境较敏感，默认直连；如手动切换香港代理，建议尽量保持同一节点
- Google、AI、非中国和漏网之鱼的默认出口可在 App 内手动切换
- 如需 HTTPS 解密功能，请在 Shadowrocket 中生成并安装 CA 证书

## License

MIT

<!-- CODEX-BEGIN CUSTOMIZATION -->
## fengsx 定制内容

本 fork 在上游完整规则基础上增加：

- 美国策略：Amazon、eBay、Oracle、Equifax、Google.com、Majority、Talkatone、Capital One、Red Pocket、Revolut。
- 英国金融策略：Krak、Kraken、Lloyds、Zopa、Monzo、Freetrade、Tide、Trading 212、Plum、iFAST GB，默认使用英国节点。
- 英国、韩国节点策略组，便于不同设备独立选择默认出口。
- WLOC Shadowrocket 脚本、Apple 网络定位域名、MITM 主机列表及私有控制入口。
- DNS 覆写使用 Cloudflare / Google DoH 经代理并行查询；代理 DNS 失败时回退直连的加密 Cloudflare DoH；国内直连域名继续使用系统 DNS。
- 所有仓库内规则引用和 update-url 均指向本 fork。

WLOC 需要在 Shadowrocket 中启用 HTTPS 解密，并完全信任 Shadowrocket 生成的 CA。iOS 27 正式版存在系统级 MITM 限制，详见 [WLOC 使用说明](https://github.com/fengsx/wloc#使用方法)。
<!-- CODEX-END CUSTOMIZATION -->
