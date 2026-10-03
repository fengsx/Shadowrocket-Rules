# sub 节点管理

运行在 Cloudflare 的节点组装服务。规则唯一来源是本仓库生成的 `dist/rules-manifest.json`，响应式管理界面支持批量添加、启用、停用、删除和刷新多个节点来源。

## 输出

- Clash：完整 Mihomo 配置
- MerlinClash：带局域网、redir 与 TProxy 监听的完整 Mihomo 配置
- Shadowrocket：Base64 节点订阅；规则配置继续使用仓库根目录的 `Shadowrocket.conf`

三个输出在同一次构建中生成。Clash 与 MerlinClash 保持完全相同的规则顺序和规则源；Shadowrocket 配置与规则清单来自同一份 `Shadowrocket.conf`。

## 输入格式

- Clash/Mihomo YAML
- 普通 URI 列表与 Base64 URI 列表
- SIP008 JSON
- sing-box JSON

节点协议支持 VLESS、VMess、Trojan、Hysteria2（含 `hy2` 别名）、Shadowsocks 和 TUIC。

## 安全与稳定性

- 节点源 URL、节点参数、公开订阅令牌均使用 AES-GCM 加密后存入 D1。
- D1 只保存公开令牌的 SHA-256 哈希用于查询。
- 已生成订阅存入 KV，源站临时失败时继续提供上一次成功产物。
- 公开订阅返回 `Cache-Control: no-store`。
- 每 6 小时自动刷新，也可以在管理界面手动刷新。
- 仅支持 HTTPS 节点源。
- IPv6 在 Clash/MerlinClash 输出中明确关闭。

## 验证

```bash
npm ci
npm test
npm run typecheck
npx wrangler deploy --dry-run
```

真实订阅验证是可选的，只在同时设置 `MIKI_SOURCE_URL` 与 `TOKYO_SOURCE_URL` 时运行，测试不会输出订阅 URL 或节点凭据。

## Cloudflare 部署

首次部署需创建独立的 D1 和 KV，并把资源 ID 写入 `wrangler.jsonc`，随后执行数据库迁移。以下敏感值必须通过 Worker Secret 配置，禁止提交到 Git：

- `MASTER_KEY`：用于 D1 敏感字段加密
- `ADMIN_TOKEN`：登录密码

部署后在管理界面添加节点来源、刷新并创建客户端订阅。
