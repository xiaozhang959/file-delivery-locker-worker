# 文件快递柜安全审查报告

审查日期：2026-05-12  
审查方式：按 `.skills/code-review-skill/SKILL.md` 的流程进行静态代码审查，重点覆盖认证授权、输入校验、敏感配置、D1/R2 数据访问、下载/预览流程、CSP 和依赖审计。

## 结论概览

本项目已经具备不少基础安全措施：D1 查询基本使用参数绑定；上传大小、过期时间、下载次数有服务端校验；管理后台有会话 Cookie 和 CSRF 校验；取件查询有 Proof-of-Work；下载计数使用带条件的原子 `UPDATE`，能降低并发绕过下载次数的风险。

但仍存在几类需要优先处理的风险：

| 严重度 | 问题 | 影响 |
| --- | --- | --- |
| 高 | `wrangler.jsonc` 提交了默认弱口令 `1234`，且使用普通 `vars` 保存密码 | 默认部署可被直接登录，管理后台和站点访问保护形同虚设 |
| 高 | 站点密码可为空时，上传接口会变成公开写入 R2/D1 的入口 | 被滥用上传大文件、消耗存储和请求成本 |
| 中 | 登录失败锁定按 `IP + User-Agent` 统计，攻击者可改 User-Agent 绕过 | 管理密码和站点密码可被低成本持续爆破 |
| 中 | CSP 允许 `unsafe-inline`、`unsafe-eval`、`wasm-unsafe-eval` | 一旦出现 XSS 注入点，CSP 难以提供有效缓冲 |
| 中 | 6 位取件码只做无盐 SHA-256 哈希 | D1 泄露后可离线枚举活跃取件码 |
| 低 | 上传/下载审计中的 IP、User-Agent、地理信息缺少保留期限 | 隐私和合规风险，数据泄露影响扩大 |

## 详细发现

### 1. 高危：默认弱口令和明文配置进入仓库

证据：

- `wrangler.jsonc:32-35` 将 `SITE_PASSWORD` 和 `ADMIN_PASSWORD` 默认设为 `"1234"`。
- `docs/deploy.md:11-15` 引导用户“添加环境变量”，但没有明确要求使用 Cloudflare Secrets，也没有警告必须替换默认值。
- `src/app/api/admin/auth/route.ts:20-23` 只要 `ADMIN_PASSWORD` 存在就启用后台登录；若部署时沿用默认值，攻击者可直接登录 `/admin`。

影响：

- 管理后台可查看投递记录、来源 IP/User-Agent/地区，并可撤回或修改下载次数。
- 站点密码默认公开后，上传、撤回和查询接口都可被外部访问。
- Cloudflare `vars` 不是 Secret 管理能力，密码会作为配置明文存在；同时仓库中已有默认值，容易被模板使用者忽略。

建议：

- 从 `wrangler.jsonc` 删除真实或默认密码值，仅保留注释或示例占位符。
- 使用 `wrangler secret put SITE_PASSWORD` 和 `wrangler secret put ADMIN_PASSWORD` 配置生产密码。
- 在启动或登录路径增加弱口令拒绝逻辑，例如拒绝 `1234`、`password`、长度过短的密码。
- 在部署文档中明确：生产环境必须替换默认密码，并使用 Cloudflare Secrets。

### 2. 高危：站点密码为空时公开上传接口可被滥用

证据：

- `src/lib/locker.ts:538-540`：当站点密码未配置时，`getSiteAuthSession()` 直接返回有效。
- `src/lib/locker.ts:612-614`：站点密码未配置时，写操作 CSRF 校验直接跳过。
- `src/app/api/deliveries/route.ts:34-41`：上传接口只依赖 `requireSiteAuth()` 和 `requireCsrf()`。
- `src/app/api/deliveries/route.ts:64-70`：单文件最大可达 100 MB。
- `docs/development.md:80` 说明 `SITE_PASSWORD` 为空时首页和普通 API 不需要密码。

影响：

- 若部署者不设置 `SITE_PASSWORD`，任何人都能向 R2 写入最多 100 MB 的对象，并向 D1 写入投递记录和审计事件。
- 这会带来存储成本、请求成本和内容滥用风险。

建议：

- 生产环境默认强制要求 `SITE_PASSWORD`，只允许本地开发或显式 `PUBLIC_UPLOADS=true` 时开放。
- 对上传接口增加服务端限流和配额，例如按 IP、ASN、国家/地区或账号维度限制每日次数和总字节数。
- 对公开上传场景增加验证码/PoW，并为上传失败和成功都记录限流指标。

### 3. 中危：认证锁定可通过更换 User-Agent 绕过

证据：

- `src/lib/locker.ts:869-872` 使用 `auth-failure:${kind}:${ip}\n${userAgent}` 生成登录失败主体。
- `src/app/api/admin/auth/route.ts:25-42` 和 `src/app/api/site-auth/route.ts:30-47` 都依赖该主体做失败锁定。

影响：

- 攻击者可以保持同一 IP 不变，只轮换 `User-Agent`，让每个组合拥有独立失败计数。
- 这会削弱后台和站点密码的爆破防护，尤其在默认弱口令或短密码存在时风险更高。

建议：

- 失败计数主体优先按 `auth_kind + IP` 统计，User-Agent 只作为审计字段。
- 增加全局维度限制，例如同一 `auth_kind` 每分钟总失败数、同一 ASN/国家地区失败数。
- 对 `/api/admin/auth` 增加更严格的冷却策略，必要时加入二次校验。

### 4. 中危：CSP 过宽，弱化 XSS 防护

证据：

- `next.config.ts:11-13` 的 `script-src` 包含 `'unsafe-inline'`、`'unsafe-eval'`、`'wasm-unsafe-eval'`。
- `public/_headers:4` 也配置了同样的 CSP。

影响：

- 当前 React 渲染文本默认会转义，未发现直接 `dangerouslySetInnerHTML` 或 `innerHTML` 注入点。
- 但一旦未来引入富文本、第三方组件或 DOM 写入缺陷，过宽 CSP 无法有效阻断内联脚本和 eval 类执行。

建议：

- 区分开发和生产 CSP：开发保留必要的 eval，生产移除 `'unsafe-eval'` 和 `'wasm-unsafe-eval'`。
- 用 nonce 或 hash 管理必要的内联脚本，逐步移除 `'unsafe-inline'`。
- 先以 `Content-Security-Policy-Report-Only` 灰度收集违规报告，再切到强制模式。

### 5. 中危：短取件码的无盐哈希可被离线枚举

证据：

- `src/lib/locker.ts:1201-1209` 生成 6 位 `A-Z0-9` 取件码。
- `src/lib/locker.ts:1224-1230` 对取件码直接做 SHA-256。
- `migrations/0001_file_deliveries.sql:7` 保存 `pickup_code_hash`，且 README 强调只保存 SHA-256 哈希。

影响：

- 6 位大写字母数字空间约为 36^6。若 D1 数据泄露，攻击者可以离线枚举哈希并恢复活跃取件码。
- 管理码使用 16 字节随机值，风险明显低于取件码；主要问题集中在短取件码。

建议：

- 使用服务端 Secret Pepper 做 HMAC，例如 `HMAC-SHA-256(PICKUP_CODE_PEPPER, normalizedCode)`。
- 或提高取件码长度，例如 8-10 位，并保留易读分组展示。
- 支持 Pepper 轮换时，保留 `hash_version` 字段以兼容旧记录。

### 6. 低危：审计数据缺少保留与清理策略

证据：

- `migrations/0003_admin_audit.sql:25-45` 的 `delivery_events` 保存 IP、User-Agent、地区等来源信息。
- `src/lib/locker.ts:1066-1128` 在上传、下载和后台操作中记录这些字段。
- 目前只看到 Auth/PoW 临时表清理，未看到投递记录和事件的定期清理策略。

影响：

- 过期文件对象会被删除，但投递元数据和访问事件可能长期保留。
- 如果后台账户或 D1 泄露，历史 IP/User-Agent/地理信息会扩大隐私影响。

建议：

- 明确数据保留期，例如投递过期后 7/30 天清除元数据和事件。
- 若业务不需要精确 IP，可存储截断 IP 或哈希 IP。
- 在 README/部署文档中说明会收集哪些审计字段、保留多久。

## 工具验证结果

- `bunx eslint src --max-warnings=0`：通过，无输出。
- `bun audit --json`：失败，返回 `audit request failed (status 404)`，未得到可用依赖漏洞清单。
- `npm audit --json`：失败，项目没有 `package-lock.json`，npm 返回 `ENOLOCK`。本项目使用 `bun.lock`，建议在 CI 中使用可稳定工作的 Bun 审计方案，或补充第三方依赖扫描。

## 未发现明显问题的点

- D1 查询基本使用 `.prepare(...).bind(...)`，未发现直接拼接用户输入造成 SQL 注入的路径。
- 文件名会替换路径分隔符和控制字符，下载时 `Content-Disposition` 也对文件名做了处理。
- 下载和文本预览都会校验短期 `pickupAccessToken`，并通过条件 `UPDATE` 控制下载次数，未发现简单并发绕过。
- 管理写操作有后台会话和 CSRF 校验。

## 建议修复优先级

1. 立即移除 `wrangler.jsonc` 中的默认密码，改用 Cloudflare Secrets，并补充弱口令拒绝。
2. 决定生产环境是否允许公开上传；若允许，加入上传限流、配额和反滥用校验。
3. 修改认证失败锁定主体，避免 User-Agent 轮换绕过。
4. 收紧生产 CSP，并建立 Report-Only 灰度验证。
5. 为短取件码哈希增加 Pepper/HMAC，或提高取件码长度。
6. 增加投递元数据和审计事件的保留期与清理任务。
