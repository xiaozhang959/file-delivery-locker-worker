# 文件快递柜项目安全审查报告

审查日期：2026-05-12  
审查方式：按 `.skills/code-review-skill/SKILL.md` 的 Code Review Excellence 流程，重点覆盖认证授权、输入校验、敏感数据、API 滥用、配置安全、依赖审计和日志/监控。

## 总览

本项目整体使用了 D1 参数化查询、R2 对象隔离、随机管理码、文件名清洗、下载次数的原子更新等较好的基础做法，未发现明显 SQL 注入、路径穿越或 React XSS 的直接漏洞。

但当前安全边界仍有几处高风险缺口：公开 API 缺少速率限制，站点/后台登录缺少暴力破解防护，Cookie token 为密码派生的静态长期凭据，演示模式会绕过认证并暴露后台/下载数据。这些问题在公网部署后会显著增加取件码枚举、密码爆破、数据泄露和滥用存储资源的风险。

## 高风险发现

### 1. 公开取件码接口缺少速率限制，6 位取件码存在在线枚举风险

严重性：高  
位置：
- `src/lib/locker.ts:559` 生成 6 位取件码。
- `src/app/api/deliveries/[pickupCode]/route.ts:14` 到 `:43` 通过取件码查询文件元信息。
- `src/app/api/deliveries/[pickupCode]/download/route.ts:26` 到 `:83` 通过取件码下载文件。
- `src/app/api/deliveries/[pickupCode]/preview/route.ts:26` 到 `:87` 通过取件码预览文本。

影响：取件码空间约为 36^6，但代码强制同时包含字母和数字，实际空间略小。公网接口没有每 IP、每 Cookie、每取件码前缀的限流或失败计数，攻击者可以持续请求查询/下载/预览接口，命中后可获得文件名、大小、状态，甚至直接下载文件或读取文本。

建议：
- 对 `/api/deliveries/:pickupCode`、`/download`、`/preview` 增加 Cloudflare WAF/Rate Limiting 或 Durable Object/KV 计数限流。
- 将取件码提升到更高熵，例如 10 到 12 位，或使用更长的不可枚举 slug。
- 对不存在、过期、删除、次数用尽等状态返回更统一的错误，减少可枚举信号。

### 2. 登录接口缺少限流、锁定和审计，站点/后台密码可被暴力破解

严重性：高  
位置：
- `src/app/api/site-auth/route.ts:13` 到 `:24`
- `src/app/api/admin/auth/route.ts:13` 到 `:24`

影响：登录接口直接比较用户提交密码和环境变量密码，失败时立即返回 401。当前没有失败次数限制、IP 限流、指数退避、账号锁定或安全事件记录。若站点密码或后台密码强度不足，攻击者可长期在线爆破，后台登录尤其敏感。

建议：
- 对 `/api/site-auth` 和 `/api/admin/auth` 增加严格限流，后台登录应更严格。
- 记录失败登录事件，但避免记录明文密码。
- 增加最小密码强度要求，并在部署文档中要求高熵随机密码。
- 后台建议增加二次因素或至少单独的 Cloudflare Access 保护。

### 3. 认证 Cookie 是密码派生的静态 token，缺少服务端会话失效能力

严重性：高  
位置：
- `src/lib/locker.ts:370` 到 `:375` 使用 `SHA-256(prefix + password)` 生成站点/后台 token。
- `src/lib/locker.ts:299` 到 `:317` 通过重新计算同一 token 验证 Cookie。
- `src/lib/locker.ts:378` 到 `:409` 设置 7 天站点 Cookie 和 8 小时后台 Cookie。

影响：同一个密码永远产生同一个 Cookie token。若 Cookie 泄露，服务端无法单独撤销某次会话；若攻击者拿到 token，不需要知道密码即可在有效期内访问。SHA-256 对低熵密码也不适合作为认证凭据派生方案。

建议：
- 使用随机会话 ID，服务端存储会话哈希、过期时间和撤销状态。
- Cookie 中只保存随机 session id，不保存密码派生 token。
- 若继续使用无状态 token，应加入独立 `SESSION_SECRET`、签名、过期时间、版本号，并支持轮换。
- Cookie 建议补充 `Priority=High`，后台 Cookie 可考虑更短有效期。

### 4. 演示模式绕过鉴权并允许读取后台列表、事件和文件内容

严重性：高  
位置：
- `src/lib/locker.ts:319` 到 `:330` 演示模式下站点和后台请求直接授权。
- `src/lib/locker.ts:345` 到 `:347` 演示模式下后台接口无需管理员密码。
- `src/app/api/admin/deliveries/route.ts:33` 到 `:127` 返回上传记录、IP、User-Agent、地理信息。
- `src/app/api/admin/deliveries/[id]/events/route.ts:24` 到 `:67` 返回事件明细。
- `src/app/api/deliveries/[pickupCode]/download/route.ts:74` 到 `:83` 演示模式仍可下载对象。
- `src/app/api/deliveries/[pickupCode]/preview/route.ts:83` 到 `:87` 演示模式仍可读取文本。

影响：只要生产环境误开 `DEMO_MODE`，任何访问者都可进入管理后台读取上传记录、来源 IP、User-Agent、地区和事件，并且可以在知道取件码时下载/预览内容。`docs/deploy.md:15` 写着演示模式“无法进行任何上传下载等操作”，但代码实际只禁止写操作，下载和预览仍可用，部署者容易误判风险。

建议：
- 生产环境禁止 `DEMO_MODE=true`，可在启动/请求时对生产环境直接拒绝演示模式。
- 演示模式后台使用脱敏假数据，或仍要求管理员认证。
- 演示模式下禁止真实 R2 对象下载/预览，改为固定示例内容。
- 更新部署文档，明确演示模式会公开读取能力。

## 中风险发现

### 5. 缺少 CSRF 防护，已登录用户可能被跨站触发状态变更

严重性：中  
位置：
- `src/lib/locker.ts:382` 到 `:385`、`:399` 到 `:402` Cookie 使用 `SameSite=Lax`，但没有 CSRF token。
- `src/app/api/deliveries/route.ts:27` 到 `:213` 上传接口依赖 Cookie 鉴权。
- `src/app/api/deliveries/manage/[manageCode]/route.ts:3` 到 `:58` 管理码撤回接口依赖 Cookie 鉴权。
- `src/app/api/admin/deliveries/[id]/counts/route.ts:16` 到 `:131` 修改次数。
- `src/app/api/admin/deliveries/[id]/revoke/route.ts:11` 到 `:87` 后台撤回。

影响：`SameSite=Lax` 能降低大多数跨站 POST 风险，但不是完整 CSRF 防护。后台和撤回类接口属于状态变更操作，一旦浏览器或未来集成场景放宽 SameSite/CORS，风险会升高。

建议：
- 对所有写接口加入 CSRF token，使用双提交 Cookie 或服务端会话 token。
- 校验 `Origin`/`Referer` 必须匹配站点 origin。
- 后台写接口可要求自定义请求头并在服务端校验。

### 6. 上传接口缺少频率/配额控制，可能被滥用消耗 R2 和 D1 资源

严重性：中  
位置：
- `src/app/api/deliveries/route.ts:58` 到 `:65` 单文件最大 100 MB。
- `src/app/api/deliveries/route.ts:110` 到 `:177` 直接写入 R2、D1 和事件表。

影响：只要站点未设置 `SITE_PASSWORD`，或密码泄露，攻击者可以重复上传大量 100 MB 对象，占用 R2 存储、请求数和 D1 写入额度。即使设置了密码，也缺少用户/IP 级配额和每日总量限制。

建议：
- 设置全站上传限流和每日总量配额。
- 站点密码应默认建议开启。
- 对上传请求按 IP、Cookie、User-Agent 维度做异常检测。
- 考虑上传前先检查配额，再写 R2；写入失败时保证补偿删除。

### 7. 管理后台暴露较多个人/设备信息，缺少脱敏和保留策略

严重性：中  
位置：
- `src/lib/locker.ts:424` 到 `:438` 采集 IP、User-Agent、浏览器、系统、设备、地区。
- `src/lib/locker.ts:441` 到 `:486` 写入事件表。
- `src/app/api/admin/deliveries/route.ts:139` 到 `:164` 返回上传来源信息。
- `src/app/api/admin/deliveries/[id]/events/route.ts:70` 到 `:92` 返回事件来源信息。

影响：IP、User-Agent 和地理信息属于敏感日志/个人数据。当前没有脱敏、最小化采集、保留期限或删除策略。一旦后台 Cookie 泄露、演示模式误开或管理员账号被爆破，历史访问来源会被完整暴露。

建议：
- 只保留必要字段，例如 IP 哈希或截断后的 IP 段。
- 增加日志保留期限，过期清理 `delivery_events` 和上传来源字段。
- 后台 UI 默认隐藏完整 IP/User-Agent，按需展开。
- 在隐私说明和部署文档中说明采集范围。

### 8. 缺少统一安全响应头

严重性：中  
位置：
- `next.config.ts:4` 到 `:6` 没有配置安全 headers。
- `public/_headers:3` 到 `:4` 仅为静态资源配置缓存头。

影响：动态页面和 API 未显式设置 CSP、`X-Frame-Options`/`frame-ancestors`、`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy` 等安全头。虽然 React 默认转义文本，但缺少 CSP 会降低 XSS 防御纵深；缺少 frame 限制会增加点击劫持风险。

建议：
- 在 Next `headers()` 或 Cloudflare `_headers` 中添加统一安全头。
- 推荐至少设置：`Content-Security-Policy`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy`、`frame-ancestors 'none'`。
- HSTS 可在确认全站 HTTPS 后开启。

### 9. 上传的 `content-type` 完全信任客户端

严重性：中  
位置：
- `src/lib/locker.ts:548` 到 `:550`
- `src/app/api/deliveries/route.ts:87`、`:110` 到 `:119`
- `src/app/api/deliveries/[pickupCode]/download/route.ts:129` 到 `:136`

影响：攻击者可以上传任意内容并声明任意 MIME 类型。当前下载响应使用 `attachment`，风险比 inline 展示低，但错误 MIME 仍可能影响客户端处理、审计判断或后续功能扩展。

建议：
- 对常见文件类型进行 MIME 嗅探或白名单校验。
- 对未知类型统一使用 `application/octet-stream`。
- 保持 `Content-Disposition: attachment`，避免未来改成 inline。

## 低风险/改进项

### 10. 后台修改下载次数没有设置上限

严重性：低  
位置：`src/app/api/admin/deliveries/[id]/counts/route.ts:32` 到 `:46`

影响：上传时普通用户最大下载次数被限制为 10，但后台可设置任意大的 `maxDownloads`。这不一定是漏洞，但若后台账号被滥用，会放大文件长期分发能力。

建议：后台也设置合理上限，或要求二次确认/审计高风险数值。

### 11. 数据库迁移缺少 CHECK 约束

严重性：低  
位置：
- `migrations/0001_file_deliveries.sql:1` 到 `:15`
- `migrations/0003_admin_audit.sql:25` 到 `:44`

影响：应用层有校验，但数据库层没有对 `max_downloads`、`download_count`、`delivery_kind`、`expires_at` 等字段设置约束。未来脚本、后台或迁移误写时可能产生异常状态。

建议：在 D1 表结构中补充可行的 `CHECK` 约束，至少约束下载次数非负、类型枚举和值域。

### 12. 源码映射上传需确认访问控制

严重性：低  
位置：`wrangler.jsonc:31`

影响：`upload_source_maps` 有利于线上排障，但需要确认源码映射不会被公开下载。若平台配置或部署流程不当，可能泄露源码结构。

建议：确认 Cloudflare source maps 权限和可见性，生产环境只向受控观测平台开放。

## 已验证的正向安全点

- D1 查询基本使用 `.bind()` 参数化，未发现用户输入直接拼接进 SQL 的典型注入点。
- R2 对象 key 使用服务端生成的 `crypto.randomUUID()` 和时间戳，未使用用户文件名作为路径。
- 文件名经过 `/`、反斜杠、控制字符替换，并限制长度。
- 管理码使用 16 字节随机数，熵明显高于取件码。
- 下载次数更新使用条件 `UPDATE`，能降低并发超限下载的竞态风险。
- 文本预览通过 JSON 返回，React 页面未发现 `dangerouslySetInnerHTML` 直接渲染用户文本。

## 依赖审计结果

- `bun audit --json` 已运行，但返回 `audit request failed (status 404)`，未得到有效漏洞清单。
- `npm audit --json` 已运行，但项目没有 npm lockfile，返回 `ENOLOCK`。项目当前使用 `bun.lock`，因此 npm audit 不适用。

建议在 CI 中固定一个可用的依赖审计工具，例如 Bun 官方可用审计命令、Snyk、OSV Scanner 或 GitHub Dependabot，并确保它能读取当前 lockfile。

## 推荐修复优先级

1. 立即为登录、取件查询、下载、预览、上传接口加限流。
2. 将站点/后台认证改为随机服务端会话，淘汰密码派生静态 Cookie。
3. 生产环境禁止演示模式读取真实数据，修正文档说明。
4. 为所有写接口补 CSRF token 与 Origin 校验。
5. 补充安全响应头和后台敏感信息脱敏。
6. 建立可运行的依赖审计流程。
