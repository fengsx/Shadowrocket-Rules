# 小火箭 Shadowrocket Config

一份开箱即用的 小火箭 Shadowrocket 规则配置
- 支持前沿的苹果智能（Apple Intelligence）
- 在新规下的香港券商访问
- 导入后添加自己的节点或订阅即可使用

## 快速开始

GitHub Raw 是本 fork 的权威发布源；JSDMirror 仅作为国内访问镜像。规则发布与上游同步均不依赖东京服务器或 sub.qor.com.cn。

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
| 1 | 🧱 DNS 防泄露（HTTPDNS） | REJECT |
| 2 | 📧 邮件服务（含 Gmail 网页、IMAP / POP3 / SMTP） | 每 300 秒自动选择低延迟地区节点 |
| 3 | 🔍 谷歌服务（含 Gemini） | 每 300 秒自动选择低延迟地区节点 |
| 4 | 🤖 AI 服务（ChatGPT、Claude、苹果智能等） | 美国节点 |
| 5 | 📹 油管视频（含 YouTube 翻译 API） | 节点选择 |
| 6 | 🔒 哔哩哔哩 | DIRECT |
| 7 | 🏠 私有网络 / 局域网 | DIRECT |
| 8 | 📲 电报消息 | 节点选择 |
| 9 | 🐱 代码托管（GitHub、GitLab、Atlassian） | 节点选择 |
| 10 | Ⓜ️ 微软服务 | 节点选择 |
| 11 | 🏦 汇丰香港（含 Reward+） | DIRECT |
| 12 | 🏦 其他香港银行 | DIRECT |
| 13 | 📈 券商服务（富途 / moomoo / 长桥 / 老虎 / 雪盈 / 盈透） | 香港节点 |
| 14 | 🍎 苹果推送 | 节点选择 |
| 15 | 🍏 苹果服务 | DIRECT |
| 16 | 🔒 国内服务 | DIRECT |
| 17 | 🌍 非中国（境外流量） | PROXY |
| 18 | GEOIP CN | DIRECT |
| 19 | 🐟 漏网之鱼（兜底） | PROXY |


## 默认策略

| 服务 | 默认策略 | 可选策略 |
|------|----------|----------|
| 🧱 DNS 防泄露 | REJECT | 节点选择、DIRECT |
| 📧 邮件服务 | 自动选择低延迟地区节点 | 日本、香港、美国、英国、韩国及其他节点 |
| 🔍 谷歌服务 | 自动选择低延迟地区节点 | 日本、香港、美国、英国、韩国及其他节点 |
| 🤖 AI 服务 | 🇺🇸 美国节点 | 节点选择、PROXY、DIRECT |
| 🍎 苹果推送 | 🚀 节点选择 | PROXY、DIRECT |
| 🍏 苹果服务 | DIRECT | 节点选择、PROXY |
| 🏦 汇丰香港 | DIRECT | 🇭🇰 香港节点、节点选择、PROXY |
| 🏦 香港银行 | DIRECT | 香港节点、节点选择、PROXY |
| 📈 券商服务 | 🇭🇰 香港节点 | DIRECT、节点选择、PROXY |
| 🌍 非中国 | PROXY | 节点选择、DIRECT、日本节点 |
| 🐟 漏网之鱼 | PROXY | 节点选择、DIRECT、日本节点 |







## 规则集来源

- [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) — 主要规则集
- [iab0x00/ProxyRules](https://github.com/iab0x00/ProxyRules) — AI 服务补充规则
- `Mail.list` 收录 Apple、Gmail、Outlook、Yahoo、Yandex 的邮件协议端点
- `Apple.list` 基于 blackmatrix7 Apple 规则，并配套加载 `Apple_Domain.list`，补充 iCloud Photos / Apple CDN 直连域名
- `Apple-HK.list` 维护需经香港节点访问的 Apple 支持页面；`Twitter-US.list` 维护 Twitter / X 的美国分流
- `HK_Broker.list` 补充富途 / moomoo / 长桥 / 老虎 / 雪盈 / TradeUP / Schwab 证券域名及交易 IP 段
- `HSBC_HK.list` 与 `HK_Banks_Direct.list` 收录香港银行网站及 App 服务域名

## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=lingjingmaster/shadowrocket-rules&type=date&legend=top-left)](https://www.star-history.com/?repos=lingjingmaster%2Fshadowrocket-rules&type=date&legend=top-left)

## License

MIT

<!-- CODEX-BEGIN CUSTOMIZATION -->
## fengsx 定制内容

本 fork 在上游完整规则基础上增加：

- 美国策略：Amazon、eBay、Oracle、Equifax、Google.com、Majority、Talkatone、Capital One、Red Pocket、Revolut。
- 英国金融策略：Krak、Kraken、Lloyds、Zopa、Monzo、Freetrade、Tide、Trading 212、Plum、iFAST GB，默认使用英国节点。
- 英国、韩国节点策略组，便于不同设备独立选择默认出口。
- WLOC 分流策略组及私有控制入口；WLOC 脚本和 MITM 主机列表由 `fengsx/wloc` 独立模块维护。
- DNS 覆写使用 Cloudflare / Google DoH 经代理并行查询；代理 DNS 失败时回退直连的加密 Cloudflare DoH；国内直连域名继续使用系统 DNS。
- 所有仓库内规则引用和 update-url 均指向本 fork。

WLOC 模块地址：`https://raw.githubusercontent.com/fengsx/wloc/refs/heads/main/modules/wloc.module`。安装并启用模块后，在 Shadowrocket 中生成、安装并完全信任本机 CA 一次。日常域名调整通过远程 `.list` 自动更新，不需要重新更新完整 `Shadowrocket.conf`，因此不会替换 WLOC 模块或 CA。只有策略组或 DNS 结构变化时才重新导入主配置。iOS 27 正式版存在系统级 MITM 限制，详见 [WLOC 使用说明](https://github.com/fengsx/wloc#使用方法)。
<!-- CODEX-END CUSTOMIZATION -->
