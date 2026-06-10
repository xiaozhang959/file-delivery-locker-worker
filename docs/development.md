# 开发文档

这份文档面向本地开发和调试。项目主体是一个运行在 Cloudflare Workers 上的 Next.js 应用，使用对象存储（默认 Cloudflare R2，也可切换到 S3 兼容 API）保存文件正文，使用 D1 保存投递记录、登录会话、PoW challenge、取件访问 token 和审计事件。

## 环境准备

需要准备：

- Bun
- Cloudflare 账号
- Wrangler CLI

项目依赖中已经包含 `wrangler`，一般直接用 `bunx wrangler` 调用即可。

首次进入项目后安装依赖：

```bash
bun install
```

如果后续需要执行远程资源准备或部署相关命令，需要先登录 Cloudflare：

```bash
bunx wrangler login
```

## 本地配置

项目使用根目录的 `wrangler.jsonc` 作为本地开发配置。开发时重点关注这些字段：

- `name`：Worker 名称。
- `services[0].service`：自引用 service binding，需要和 `name` 保持一致。
- `vars.STORAGE_BACKEND`：对象存储后端，`r2` 使用 Cloudflare R2，`s3` 使用 S3 兼容 API。
- `r2_buckets[0].binding`：使用 `STORAGE_BACKEND=r2` 时保持为 `FILE_BUCKET`，代码通过 `env.FILE_BUCKET` 访问 R2；使用 `s3` 时可移除这个 binding。
- `d1_databases[0].binding`：保持为 `DB`，代码通过 `env.DB` 访问 D1。
- `d1_databases[0].migrations_dir`：保持为 `migrations`。
- `vars.DEMO_MODE`：只读演示模式；开发写入流程时建议保持 `false`。
- `secrets.required`：生产环境必需的 Secret 名称，包括 `SITE_PASSWORD`、`ADMIN_PASSWORD`、`PICKUP_CODE_PEPPER`。

不要把本地密码写进 `wrangler.jsonc`。复制 `.dev.vars.example`：

```bash
cp .dev.vars.example .dev.vars
```

然后按需修改 `.dev.vars`：

```text
SITE_PASSWORD=change-me-site-password
ADMIN_PASSWORD=change-me-admin-password
PICKUP_CODE_PEPPER=change-me-long-random-pickup-code-pepper
STORAGE_BACKEND=r2
```

`PICKUP_CODE_PEPPER` 用于生成取件码 HMAC 哈希。本地可以使用任意长字符串；生产环境必须使用高熵随机值，并且不要在活跃投递过期前轮换。

`STORAGE_CONFIG_KEY` 可选，用于加密从 `/admin` 保存到 D1 的 S3 Secret；未配置时会回退使用 `PICKUP_CODE_PEPPER` 派生加密密钥。

如果使用 S3 兼容对象存储，将 `STORAGE_BACKEND` 改为 `s3`，并配置：

```text
S3_ENDPOINT=https://s3.example.com
S3_BUCKET=file-delivery-locker
S3_REGION=auto
S3_ACCESS_KEY_ID=change-me-access-key
S3_SECRET_ACCESS_KEY=change-me-secret-key
S3_FORCE_PATH_STYLE=true
```

`S3_REGION` 对 Cloudflare R2 S3 API 可使用 `auto`；AWS S3 请填写真实 region。生产环境建议把 `S3_ACCESS_KEY_ID` 和 `S3_SECRET_ACCESS_KEY` 配为 Worker Secret，不要写进仓库。

## 初始化本地 D1

执行本地数据库创建:

```bash
bunx wrangler d1 create file-delivery-locker
```

执行本地数据库迁移：

```bash
bunx wrangler d1 migrations apply file-delivery-locker --local
```

如果你修改了 `wrangler.jsonc` 中的 `name` 或 D1 数据库名称，请把命令里的 `file-delivery-locker` 替换成对应名称。

当前迁移会创建和维护这些核心表：

- `file_deliveries`：投递记录。
- `delivery_events`：上传、下载、后台操作事件。
- `cap_challenges`、`cap_tokens`：Cap.js Proof-of-Work 数据。
- `pickup_pow_failures`、`pickup_access_tokens`：取件防枚举和短期访问 token。
- `auth_sessions`、`auth_login_failures`：站点和后台登录会话、登录失败限制。
- `app_settings`：后台运行设置，例如存储后端和自定义取件码开关。

## 启动开发服务

启动 Next.js 开发服务器：

```bash
bun run dev
```

打开 http://localhost:3000。

`next.config.ts` 已调用 `initOpenNextCloudflareForDev()`，所以 `next dev` 中可以读取 Cloudflare 绑定。本地开发前请确认已经配置 `.dev.vars` 并执行本地 D1 迁移，否则上传、取件、登录或后台接口可能会提示绑定、Secret 或数据表不可用。

常用页面：

- `/`：文件/文本寄存、取件、撤回入口。
- `/admin`：管理后台，需要配置 `ADMIN_PASSWORD`。

## 本地运行时预览

普通开发使用 `bun run dev` 即可。需要更接近 Cloudflare Workers 的运行方式时，可以使用 OpenNext 预览：

```bash
bun run preview
```

这个命令会先构建 OpenNext 产物，再在本地预览 Worker 行为，适合检查对象存储、D1、静态资源、API 路由和 Cloudflare 运行时差异。

## 常用脚本

```bash
bun run dev        # 启动 Next.js 开发服务
bun run build      # 执行 Next.js 构建
bun run preview    # OpenNext 构建并本地预览 Cloudflare Worker
bun run cf:prepare # 检查/创建远程 R2 和 D1，并生成部署用 Wrangler 配置
bun run cf-typegen # 根据 Wrangler 配置生成 Cloudflare Env 类型
```

`bun run cf:prepare` 会读取 `wrangler.jsonc`，检查或创建远程 D1 database，然后生成 `.wrangler/deploy-wrangler.jsonc`。当 `STORAGE_BACKEND=r2` 时还会检查或创建远程 R2 bucket；当 `STORAGE_BACKEND=s3` 时会跳过 R2 并从生成配置中移除 R2 binding。这个文件用于部署流程，不需要提交。如果同名 D1 已存在但不像本项目数据库，脚本会停止，避免误用其他数据库。

修改 Cloudflare 绑定、变量或资源配置后，可以重新生成类型：

```bash
bun run cf-typegen
```

## 关键开发流程

### 站点登录

配置 `SITE_PASSWORD` 后，首页和普通 API 需要先完成站点登录。登录成功后会创建服务端会话，并通过 HttpOnly Cookie 保存登录态；站点会话有效期为 7 天。

### 后台登录

配置 `ADMIN_PASSWORD` 后可以访问 `/admin`。后台登录成功后同样创建服务端会话；后台会话有效期为 8 小时。

### 取件校验

取件查询不是直接访问投递记录，而是先完成 Cap.js Proof-of-Work：

1. 调用 `/api/pow/challenge` 创建 challenge。
2. 前端 Cap widget 计算 solutions。
3. 调用 `/api/pow/redeem` 兑换 `capToken`。
4. 查询 `/api/deliveries/<pickupCode>` 时携带 `x-cap-token`。
5. 查询成功后接口返回 `pickupAccessToken`。
6. 文本预览和文件下载需要携带 `x-pickup-access-token`。

`capToken` 和 `pickupAccessToken` 都是短期 token，默认有效期为 5 分钟。取件错误次数会在 15 分钟窗口内累计，并影响后续 PoW 难度。

### 创建投递

创建投递需要站点登录和 CSRF 校验。浏览器端已在页面逻辑中处理这些细节；如果直接调 API，需要带上对应 Cookie 和 CSRF 请求头。

投递约束：

- 文件最大 100 MB。
- 文本最大 256 KB。
- `x-delivery-kind` 可为 `file` 或 `text`，缺省为 `file`。
- `x-pickup-code` 可选；填写时必须规范化为 6 位字母或数字，且不能和历史投递重复。
- `x-expires-in-hours` 可为 `0`、`1`、`24`、`168`；`0` 表示不过期。
- `x-max-downloads` 可为 `0` 或大于等于 `1` 的整数；`0` 表示不限次数。

上传时会计算内容哈希。相同文件或文本会复用已有对象存储内容，但仍会生成新的取件码和管理码。

## 配置说明

`SITE_PASSWORD` 为空时，首页和普通 API 不需要密码；设置后，修改密码会使已有站点会话失效。

`ADMIN_PASSWORD` 为空时，`/admin` 后台不可用；设置后，修改密码会使已有后台会话失效。

`PICKUP_CODE_PEPPER` 是短取件码 HMAC 的 Secret。生产环境必须配置；如果轮换，旧 Pepper 创建的 HMAC 取件码无法继续匹配。历史 SHA-256 取件码仍兼容查询。

`DEMO_MODE` 开启后，首页无需密码，系统进入只读演示状态：不能上传文件、寄存文本、撤回文件、修改下载次数、读取文本内容或下载文件。后台仍需 `ADMIN_PASSWORD` 登录。

`STORAGE_BACKEND` 默认为 `r2`。设置为 `s3` 时，后端通过 S3 Signature V4 请求 `S3_ENDPOINT`/`S3_BUCKET`，支持常见 S3 兼容 API。默认使用 path-style URL；如后端要求 virtual-hosted-style，可设置 `S3_FORCE_PATH_STYLE=false`。

管理员登录 `/admin` 后也可以在“运行设置”中修改：

- 对象存储后端：Cloudflare R2 或 S3 兼容 API。
- S3 endpoint、bucket、region、access key、secret、session token、path-style 开关。
- 是否允许前台上传时自定义取件码。

后台保存的 S3 Secret 不会回显，输入框留空会保留现有值。运行时优先使用 `/admin` 保存的配置；未保存时回退使用环境变量配置。

## 项目结构

```text
src/app/page.tsx                                      首页入口
src/app/locker-app.tsx                                首页交互逻辑
src/app/admin/page.tsx                                管理后台入口
src/app/admin/admin-app.tsx                           管理后台交互逻辑
src/app/api/site-auth/route.ts                        站点登录
src/app/api/admin/auth/route.ts                       后台登录
src/app/api/admin/settings/route.ts                   后台运行设置
src/app/api/pow/challenge/route.ts                    创建 Cap.js PoW challenge
src/app/api/pow/redeem/route.ts                       兑换 Cap.js PoW token
src/app/api/deliveries/route.ts                       创建文件/文本投递
src/app/api/deliveries/[pickupCode]/route.ts          查询投递状态并签发取件访问 token
src/app/api/deliveries/[pickupCode]/preview/route.ts  预览文本投递
src/app/api/deliveries/[pickupCode]/download/route.ts 下载投递内容
src/app/api/deliveries/manage/[manageCode]/route.ts   通过管理码撤回
src/app/api/admin/deliveries/route.ts                 后台投递列表
src/app/api/admin/deliveries/[id]/events/route.ts     后台事件列表
src/app/api/admin/deliveries/[id]/counts/route.ts     后台调整下载次数
src/app/api/admin/deliveries/[id]/revoke/route.ts     后台撤回投递
src/lib/locker.ts                                     校验、哈希、会话、PoW、对象存储适配和通用工具
migrations/                                           D1 数据库迁移
scripts/prepare-cloudflare-deploy.mjs                 Cloudflare 远程资源准备脚本
wrangler.jsonc                                        Cloudflare 本地和部署基础配置
```

## API 调试示例

创建投递的请求形状如下。实际直接调用时还需要携带站点登录 Cookie 和 CSRF 请求头：

```bash
curl -X POST http://localhost:3000/api/deliveries \
  -H "content-type: application/octet-stream" \
  -H "x-content-type: application/octet-stream" \
  -H "x-file-name: example.txt" \
  -H "x-delivery-kind: file" \
  -H "x-pickup-code: ABC123" \
  -H "x-expires-in-hours: 24" \
  -H "x-max-downloads: 1" \
  --data-binary @example.txt
```

取件相关请求形状：

```bash
curl -X POST http://localhost:3000/api/pow/challenge

curl -X POST http://localhost:3000/api/pow/redeem \
  -H "content-type: application/json" \
  --data '{"token":"<challengeToken>","solutions":[0]}'

curl http://localhost:3000/api/deliveries/<pickupCode> \
  -H "x-cap-token: <capToken>"

curl -OJ http://localhost:3000/api/deliveries/<pickupCode>/download \
  -H "x-pickup-access-token: <pickupAccessToken>"

curl -X DELETE http://localhost:3000/api/deliveries/manage/<manageCode>
```

`/api/pow/redeem` 的 `solutions` 需要由 Cap widget 计算，上面的数组只用于展示请求结构。取件查询成功后会返回 `pickupAccessToken`，文本预览和文件下载都需要携带这个 token。

---

# Development Documentation

This document is for local development and debugging. The project is a Next.js application running on Cloudflare Workers. It uses R2 to store file bodies and D1 to store delivery records, login sessions, PoW challenges, pickup access tokens, and audit events.

## Prerequisites

You need:

- Bun
- A Cloudflare account
- Wrangler CLI

The project dependencies already include `wrangler`, so in most cases you can run it through `bunx wrangler`.

Install dependencies after entering the project for the first time:

```bash
bun install
```

If you later need to prepare remote resources or run deployment-related commands, log in to Cloudflare first:

```bash
bunx wrangler login
```

## Local Configuration

The project uses the root-level `wrangler.jsonc` as the local development configuration. These fields are the important ones during development:

- `name`: the Worker name.
- `services[0].service`: the self-referential service binding. It must match `name`.
- `r2_buckets[0].binding`: keep this as `FILE_BUCKET`; the code accesses R2 through `env.FILE_BUCKET`.
- `d1_databases[0].binding`: keep this as `DB`; the code accesses D1 through `env.DB`.
- `d1_databases[0].migrations_dir`: keep this as `migrations`.
- `vars.DEMO_MODE`: read-only demo mode. Keep it `false` when developing write flows.
- `secrets.required`: production-required secret names, including `SITE_PASSWORD`, `ADMIN_PASSWORD`, and `PICKUP_CODE_PEPPER`.

Do not write local passwords into `wrangler.jsonc`. Copy `.dev.vars.example`:

```bash
cp .dev.vars.example .dev.vars
```

Then edit `.dev.vars` as needed:

```text
SITE_PASSWORD=change-me-site-password
ADMIN_PASSWORD=change-me-admin-password
PICKUP_CODE_PEPPER=change-me-long-random-pickup-code-pepper
```

`PICKUP_CODE_PEPPER` is used to generate HMAC hashes for pickup codes. Locally, any long string is fine. In production, use a high-entropy random value and do not rotate it before active deliveries have expired.

## Initialize Local D1

Create the local database:

```bash
bunx wrangler d1 create file-delivery-locker
```

Apply local database migrations:

```bash
bunx wrangler d1 migrations apply file-delivery-locker --local
```

If you changed the `name` field or the D1 database name in `wrangler.jsonc`, replace `file-delivery-locker` in the commands above with the matching name.

The current migrations create and maintain these core tables:

- `file_deliveries`: delivery records.
- `delivery_events`: upload, download, and admin-operation events.
- `cap_challenges`, `cap_tokens`: Cap.js Proof-of-Work data.
- `pickup_pow_failures`, `pickup_access_tokens`: pickup enumeration protection and short-lived access tokens.
- `auth_sessions`, `auth_login_failures`: site/admin login sessions and login-failure throttling.

## Start the Development Server

Start the Next.js development server:

```bash
bun run dev
```

Open http://localhost:3000.

`next.config.ts` calls `initOpenNextCloudflareForDev()`, so Cloudflare bindings are available inside `next dev`. Before local development, make sure `.dev.vars` is configured and local D1 migrations have been applied. Otherwise uploads, pickup, login, or admin APIs may report missing bindings, secrets, or tables.

Common pages:

- `/`: file/text storage, pickup, and revocation entry points.
- `/admin`: admin console. Requires `ADMIN_PASSWORD`.

## Local Runtime Preview

For normal development, `bun run dev` is enough. If you need a runtime closer to Cloudflare Workers, use the OpenNext preview:

```bash
bun run preview
```

This command builds the OpenNext output first, then previews Worker behavior locally. It is useful for checking R2, D1, static assets, API routes, and Cloudflare runtime differences.

## Common Scripts

```bash
bun run dev        # Start the Next.js development server
bun run build      # Run the Next.js build
bun run preview    # Build with OpenNext and preview the Cloudflare Worker locally
bun run cf:prepare # Check/create remote R2 and D1 resources, then generate deployment Wrangler config
bun run cf-typegen # Generate Cloudflare Env types from the Wrangler config
```

`bun run cf:prepare` reads `wrangler.jsonc`, checks or creates the remote R2 bucket and D1 database, then generates `.wrangler/deploy-wrangler.jsonc`. This file is used by deployment and does not need to be committed. If a D1 database with the same name already exists but does not look like this project's database, the script stops to avoid accidentally using the wrong database.

After changing Cloudflare bindings, variables, or resource configuration, regenerate types:

```bash
bun run cf-typegen
```

## Key Development Flows

### Site Login

After `SITE_PASSWORD` is configured, the homepage and normal APIs require site login first. A successful login creates a server-side session and stores the login state in an HttpOnly cookie. Site sessions are valid for 7 days.

### Admin Login

After `ADMIN_PASSWORD` is configured, you can access `/admin`. Admin login also creates a server-side session. Admin sessions are valid for 8 hours.

### Pickup Verification

Pickup lookup does not directly read delivery records. It first completes a Cap.js Proof-of-Work flow:

1. Call `/api/pow/challenge` to create a challenge.
2. The frontend Cap widget computes solutions.
3. Call `/api/pow/redeem` to exchange the result for a `capToken`.
4. Include `x-cap-token` when querying `/api/deliveries/<pickupCode>`.
5. After a successful lookup, the API returns a `pickupAccessToken`.
6. Text preview and file download require `x-pickup-access-token`.

Both `capToken` and `pickupAccessToken` are short-lived tokens. By default they are valid for 5 minutes. Failed pickup attempts are accumulated within a 15-minute window and affect later PoW difficulty.

### Create a Delivery

Creating a delivery requires site login and CSRF verification. The browser UI already handles these details. If you call the API directly, include the matching Cookie and CSRF request header.

Delivery constraints:

- Maximum file size: 100 MB.
- Maximum text size: 256 KB.
- `x-delivery-kind` can be `file` or `text`; it defaults to `file`.
- `x-expires-in-hours` can be `0`, `1`, `24`, or `168`; `0` means no expiration.
- `x-max-downloads` can be `0` or an integer greater than or equal to `1`; `0` means unlimited downloads/views.

The upload flow computes a content hash. Identical files or text reuse an existing R2 object, but each delivery still receives a new pickup code and manage code.

## Configuration Notes

When `SITE_PASSWORD` is empty, the homepage and normal APIs do not require a password. After it is set, changing the password invalidates existing site sessions.

When `ADMIN_PASSWORD` is empty, `/admin` is disabled. After it is set, changing the password invalidates existing admin sessions.

`PICKUP_CODE_PEPPER` is the secret used by short pickup-code HMACs. It must be configured in production. If it is rotated, HMAC pickup codes created with the old pepper will no longer match. Historical SHA-256 pickup codes remain compatible with lookup.

When `DEMO_MODE` is enabled, the homepage does not require a password and the system enters a read-only demo state: users cannot upload files, store text, revoke files, modify download counts, read text content, or download files. The admin console still requires `ADMIN_PASSWORD`.

## Project Structure

```text
src/app/page.tsx                                      Homepage entry
src/app/locker-app.tsx                                Homepage interaction logic
src/app/admin/page.tsx                                Admin console entry
src/app/admin/admin-app.tsx                           Admin console interaction logic
src/app/api/site-auth/route.ts                        Site login
src/app/api/admin/auth/route.ts                       Admin login
src/app/api/pow/challenge/route.ts                    Create Cap.js PoW challenge
src/app/api/pow/redeem/route.ts                       Redeem Cap.js PoW token
src/app/api/deliveries/route.ts                       Create file/text delivery
src/app/api/deliveries/[pickupCode]/route.ts          Query delivery status and issue pickup access token
src/app/api/deliveries/[pickupCode]/preview/route.ts  Preview text delivery
src/app/api/deliveries/[pickupCode]/download/route.ts Download delivery content
src/app/api/deliveries/manage/[manageCode]/route.ts   Revoke through manage code
src/app/api/admin/deliveries/route.ts                 Admin delivery list
src/app/api/admin/deliveries/[id]/events/route.ts     Admin event list
src/app/api/admin/deliveries/[id]/counts/route.ts     Admin download-count adjustment
src/app/api/admin/deliveries/[id]/revoke/route.ts     Admin delivery revocation
src/lib/locker.ts                                     Validation, hashing, sessions, PoW, Cloudflare bindings, and shared utilities
migrations/                                           D1 database migrations
scripts/prepare-cloudflare-deploy.mjs                 Cloudflare remote-resource preparation script
wrangler.jsonc                                        Cloudflare local/deployment base configuration
```

## API Debugging Examples

The request shape for creating a delivery is shown below. Direct API calls also need the site login Cookie and CSRF request header:

```bash
curl -X POST http://localhost:3000/api/deliveries \
  -H "content-type: application/octet-stream" \
  -H "x-content-type: application/octet-stream" \
  -H "x-file-name: example.txt" \
  -H "x-delivery-kind: file" \
  -H "x-expires-in-hours: 24" \
  -H "x-max-downloads: 1" \
  --data-binary @example.txt
```

Pickup-related request shapes:

```bash
curl -X POST http://localhost:3000/api/pow/challenge

curl -X POST http://localhost:3000/api/pow/redeem \
  -H "content-type: application/json" \
  --data '{"token":"<challengeToken>","solutions":[0]}'

curl http://localhost:3000/api/deliveries/<pickupCode> \
  -H "x-cap-token: <capToken>"

curl -OJ http://localhost:3000/api/deliveries/<pickupCode>/download \
  -H "x-pickup-access-token: <pickupAccessToken>"

curl -X DELETE http://localhost:3000/api/deliveries/manage/<manageCode>
```

The `solutions` field for `/api/pow/redeem` must be computed by the Cap widget. The array above is only used to demonstrate the request shape. A successful pickup lookup returns `pickupAccessToken`, which is required for both text preview and file download.
