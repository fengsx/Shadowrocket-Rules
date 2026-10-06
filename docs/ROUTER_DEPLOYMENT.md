# BE88U / MerlinClash 复用配置说明

本文用于在另一台相同环境的华硕 BE88U 路由器上复用当前分流、DNS 防泄漏和双代理兼容方案。

## 适用环境

- 华硕 BE88U，已启用 JFFS 自定义脚本。
- 已安装支持 `MCrule_Custom` 的 MerlinClash / Magic Catling 2。
- MerlinClash 内置 `yq` 位于 `/koolshare/bin/yq`。
- 节点仍使用原订阅地址；规则模板与节点订阅相互独立。
- 当前路由器选择的订阅配置名是 `MCU_MIKI`。复制到其他路由器时名称可以不同，但必须是 `MCU_` 开头的自定义规则配置。

## 安装

登录目标路由器 SSH 后执行：

```sh
curl -fsSL 'https://cdn.jsdmirror.com/gh/fengsx/Shadowrocket-Rules@main/router/fengsx_merlin_sync.sh'   -o /jffs/scripts/fengsx-merlin-sync
chmod 0755 /jffs/scripts/fengsx-merlin-sync
/jffs/scripts/fengsx-merlin-sync install
```

若 JSDMirror 临时不可用，可从透明代理下载同一文件：

```sh
curl -fsSL 'https://githubproxy.cc/https://raw.githubusercontent.com/fengsx/Shadowrocket-Rules/main/router/fengsx_merlin_sync.sh'   -o /jffs/scripts/fengsx-merlin-sync
chmod 0755 /jffs/scripts/fengsx-merlin-sync
/jffs/scripts/fengsx-merlin-sync install
```

不要将订阅令牌、节点链接或私钥写入本仓库或公共镜像。

## 脚本实施的修改

### 1. 统一规则模板

- 安装模板到 `/koolshare/merlinclash/rule_configs/rule_mc_custom.yaml`。
- 在 MerlinClash 页面恢复 `FENGSX规则` 选项。
- 继续使用目标路由器已有的原始节点订阅，不把节点订阅交给公共镜像。
- 模板由 `Shadowrocket.conf` 编译生成，Shadowrocket、Clash 和 MerlinClash 保持相同规则顺序。

### 2. 国内直连和地区分流

- 国内域名、Apple 常规服务、国内 HTTPDNS 使用 DIRECT。
- 蜜雪冰城 `mxbc.net` 使用显式国内直连和国内 DNS，避免仅依赖 GEOIP 兜底。
- WLOC 规则保持在通用 Apple 规则之前，不受 Apple 直连规则覆盖。
- 美国金融优先美国住宅/家宽，无可用住宅节点时回退美国普通节点。
- 英国金融使用英国节点；仅在订阅中存在英国住宅节点时加入住宅候选。
- 香港银行、汇丰香港和券商服务使用香港节点。
- 日本、韩国、美国、英国、香港等地区组按节点名称匹配；普通区域组选择低延迟节点。
- 订阅中的“剩余流量、套餐到期、官网、版本”等说明条目不会进入节点策略组。

### 3. 双代理兼容

- 从当前配置及 provider 缓存读取所有节点服务器域名和 IP。
- 生成 `/koolshare/merlinclash/rule_custom/fengsx_node_endpoints.yaml`。
- 将节点端点放在最高优先级并设为 DIRECT，避免手机开启 Shadowrocket 后再次经过路由器代理。
- 手机关闭 Shadowrocket 后，其他流量仍按路由器规则处理，不要求按手机设置绕过。
- 对 MIKI provider 使用本地缓存文件，降低订阅提供器域名解析受 Fake-IP 影响的概率。

### 4. DNS 防泄漏与兼容性

- MerlinClash 保留 UDP 53 劫持。
- 本脚本额外添加局域网 `br0` 的 TCP 53 重定向，避免应用通过 TCP DNS 绕过。
- `firewall-start` 在 NAT/防火墙重建后立即恢复 TCP 53 规则。
- 删除旧 DNS 模板里不存在的 `AI`、`Crypto`、`Proxy` rule-set 引用。
- 为 `jsdmirror.com`、`githubproxy.cc`、`jsdelivr.net` 和 `githubusercontent.com` 设置阿里/腾讯公共 DNS 引导，保证启动阶段能下载规则。
- IPv6 必须在路由器中关闭；同步脚本不会擅自更改 WAN IPv6 设置。

### 5. 自动恢复与定时更新

脚本自动维护：

```text
17 */6 * * * /jffs/scripts/fengsx-merlin-sync cron
```

同时写入：

- `/jffs/scripts/services-start`：路由器启动 90 秒后恢复规则。
- `/jffs/scripts/firewall-start`：防火墙重建后恢复 TCP 53 劫持。

下载顺序：

1. `cdn.jsdmirror.com` 公益镜像；
2. `githubproxy.cc` GitHub Raw 透明代理；
3. 两者均失败则保留本地已验证版本，不用错误或空文件覆盖现有配置。

JSDMirror 当前响应为 `max-age=300, stale-while-revalidate=86400`：边缘正常缓存 5 分钟；源站异常时可能继续提供最多 24 小时的旧内容。其上游分支缓存仍可能导致更长的更新延迟。

## 目标路由器需要手工确认的设置

1. MerlinClash 已正常运行，并已选择需要使用的原始订阅。
2. 规则模式选择 `FENGSX规则`。
3. WAN IPv6 设置为关闭；命令行检查 `nvram get ipv6_service` 应返回 `disabled`。
4. 不要为手机单独配置路由器绕过；手机是否开启 Shadowrocket 均应正常工作。
5. 首次安装完成后执行一次订阅更新，让模板生成活动配置。

## 验证

```sh
# 同步日志
tail -n 100 /tmp/fengsx_merlin_sync.log

# 定时任务
cru l | grep FENGSX_MERLIN_SYNC

# IPv6
nvram get ipv6_service

# TCP/UDP 53 劫持
iptables -t nat -S PREROUTING | grep -- '--dport 53'

# 安装文件
ls -l /jffs/scripts/fengsx-merlin-sync
ls -l /koolshare/merlinclash/rule_configs/rule_mc_custom.yaml
ls -l /koolshare/merlinclash/rule_custom/fengsx_node_endpoints.yaml

# 配置语法
/koolshare/bin/yq eval '.' /koolshare/merlinclash/rule_configs/rule_mc_custom.yaml >/dev/null
```

正确结果应包括：

- 一条 `br0` TCP 53 重定向和一条 UDP 53 重定向；
- `FENGSX_MERLIN_SYNC` 每 6 小时运行；
- `ipv6_service=disabled`；
- 三个安装文件存在且非空；
- 日志最后出现“同步完成”。

随后实际验证：

- 国内网站与微信图片/视频命中 DIRECT；
- 美国金融、英国金融、香港银行分别命中对应地区策略；
- 手机仅连 Wi-Fi、Wi-Fi + Shadowrocket、移动网络 + Shadowrocket 三种场景都能访问；
- DNS 检测不出现本地运营商明文 DNS。

## 当前路由器的已验证状态

- 活动订阅配置：`MCU_MIKI`。
- IPv6：`disabled`。
- TCP 与 UDP 53 劫持：已启用。
- 每 6 小时同步：已启用。
- 启动恢复和防火墙恢复钩子：已安装。
- 规则模板、同步脚本和节点端点直连表：均已安装。

## 故障处理

- 下载失败：现有配置会被保留，先检查 `/tmp/fengsx_merlin_sync.log`。
- `FENGSX规则` 消失：重新运行同步脚本，脚本会修复页面入口。
- 路由器重启后 TCP DNS 劫持消失：检查 `/jffs/scripts/firewall-start` 是否可执行。
- 手机开启 Shadowrocket 后完全断网：检查端点直连表是否包含当前节点的域名/IP，并重新运行同步脚本。
- 国内网站变慢：先检查是否命中 `国内服务/DIRECT`，不要通过扩大手机绕过范围解决。
- 规则更新不是即时生效：JSDMirror 存在缓存，应以文件内容和哈希验证，不能只看 HTTP 200。
