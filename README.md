# 文件快递柜

一个部署在 Cloudflare Workers 上的匿名文件中转柜。前端使用 Next.js，运行时由 OpenNext 适配到 Cloudflare；文件正文存放在 R2，取件记录、取件码哈希、管理码哈希和下载次数存放在 D1。

适合临时交付文件：上传方放入文件后得到取件码、取件链接和管理码；下载方使用取件码领取文件；上传方可以使用管理码撤回文件。

## 功能

- 上传单个文件，最大 100 MB。
- 保存期限可选 1 小时、24 小时或 7 天。
- 下载次数可设置为 1 到 10 次。
- 取件码和管理码只保存 SHA-256 哈希，不明文入库。
- 文件下载到期、次数用尽或主动撤回后，会标记记录并删除 R2 对象。
- 大文件上传和下载走流式处理，避免把整份文件读入 Worker 内存。

## 技术栈

- Next.js 16 App Router
- React 19
- Tailwind CSS 4
- OpenNext for Cloudflare
- Cloudflare Workers
- Cloudflare R2
- Cloudflare D1
- Bun

## 项目结构

```text
src/app/page.tsx                                  前端寄件、取件、管理界面
src/app/api/deliveries/route.ts                  创建文件投递
src/app/api/deliveries/[pickupCode]/route.ts     查询投递状态
src/app/api/deliveries/[pickupCode]/download/route.ts  下载文件
src/app/api/deliveries/manage/[manageCode]/route.ts    撤回文件
src/lib/locker.ts                                通用校验、序列化、哈希和 Cloudflare 绑定
migrations/0001_file_deliveries.sql              D1 表结构
wrangler.example.jsonc                           Cloudflare 配置模板
```

## 准备工作

需要先安装 Bun，并准备一个 Cloudflare 账号。初次进入项目后安装依赖：

```bash
bun install
```

登录 Cloudflare：

```bash
bunx wrangler login
```

复制配置模板：

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

然后编辑 `wrangler.jsonc`：

- `name`：你的 Worker 名称。
- `services[0].service`：和 `name` 保持一致。
- `r2_buckets[0].binding`：保持为 `FILE_BUCKET`，不要改成 bucket 名称。
- `d1_databases[0].binding`：保持为 `DB`，不要改成数据库名称。
- `vars.SITE_PASSWORD`：站点访问密码。留空时关闭密码门禁。

创建 R2 bucket 和 D1 数据库：

```bash
bunx wrangler r2 bucket create file-delivery-locker
bunx wrangler d1 create file-delivery-locker
```

然后编辑 `wrangler.jsonc`：

- `r2_buckets[0].bucket_name`：刚创建的 R2 bucket 名称。
- `d1_databases[0].database_name`：刚创建的 D1 数据库名称。
- `d1_databases[0].database_id`：`wrangler d1 create` 输出的数据库 ID。

注意：`binding` 是代码里的变量名，必须唯一。这个项目的代码通过 `env.FILE_BUCKET` 访问 R2，通过 `env.DB` 访问 D1；资源真实名称应该写在 `bucket_name`、`database_name` 和 `database_id` 里。

站点密码使用普通 Worker variable，方便在 Cloudflare 仪表盘操作。可以在 `wrangler.jsonc` 里设置：

```jsonc
"vars": {
  "SITE_PASSWORD": "your-password"
}
```

也可以部署后在 Cloudflare 仪表盘的 Worker Variables 中编辑 `SITE_PASSWORD`。变量不存在或为空字符串时，首页和 API 都不需要密码；有值时，需要先在首页输入密码。

## 初始化数据库

本地开发用本地 D1：

```bash
bunx wrangler d1 migrations apply file-delivery-locker --local
```

线上环境执行远程迁移：

```bash
bunx wrangler d1 migrations apply file-delivery-locker --remote
```

如果你的 D1 数据库不是 `file-delivery-locker`，把命令里的名称替换成自己的 `database_name`。

## 本地开发

启动 Next.js 开发服务器：

```bash
bun run dev
```

打开 http://localhost:3000。

`next.config.ts` 已调用 `initOpenNextCloudflareForDev()`，用于在 `next dev` 中访问 Cloudflare 绑定。开发前请确保已经创建 `wrangler.jsonc` 并执行过本地 D1 迁移，否则上传接口会提示 Cloudflare bindings 或数据表不可用。

## Cloudflare 运行时预览

用 OpenNext 构建并在本地预览 Cloudflare 运行时：

```bash
bun run preview
```

这个命令更接近线上 Worker 行为，适合部署前检查 R2、D1、静态资源和 API 路由。

## 部署

先确认 `wrangler.jsonc` 里的资源名称和 ID 正确，并已经执行远程 D1 迁移：

```bash
bun run deploy
```

如果只想构建并上传 Worker，而不立即切换流量，可以使用：

```bash
bun run upload
```

## 页面使用

如果设置了 `SITE_PASSWORD`，打开首页后先输入站点访问密码。验证通过后浏览器会保存一个 7 天有效的登录 Cookie；修改 `SITE_PASSWORD` 后需要重新输入新密码。

寄件：

1. 打开首页。
2. 选择文件。
3. 选择保存期限和最大下载次数。
4. 点击“放入快递柜”。
5. 保存返回的取件码、取件链接和管理码。管理码创建后只在页面结果中显示一次。

取件：

1. 在“取件”区域输入取件码。
2. 查询文件状态。
3. 文件状态为“可取件”时点击下载。

撤回：

1. 在“管理”区域输入管理码。
2. 点击“撤回文件”。
3. 系统会标记记录为已撤回，并删除对应 R2 对象。

## API 使用

创建投递：

```bash
curl -X POST http://localhost:3000/api/deliveries \
  -H "content-type: application/octet-stream" \
  -H "x-content-type: application/octet-stream" \
  -H "x-file-name: example.txt" \
  -H "x-expires-in-hours: 24" \
  -H "x-max-downloads: 1" \
  --data-binary @example.txt
```

响应示例：

```json
{
  "id": "投递 ID",
  "pickupCode": "取件码",
  "manageCode": "管理码",
  "fileName": "example.txt",
  "size": 1234,
  "maxDownloads": 1,
  "expiresAt": "2026-05-10T00:00:00.000Z",
  "pickupUrl": "http://localhost:3000/api/deliveries/<pickupCode>/download",
  "downloadUrl": "http://localhost:3000/api/deliveries/<pickupCode>/download"
}
```

查询投递：

```bash
curl http://localhost:3000/api/deliveries/<pickupCode>
```

下载文件：

```bash
curl -OJ http://localhost:3000/api/deliveries/<pickupCode>/download
```

撤回文件：

```bash
curl -X DELETE http://localhost:3000/api/deliveries/manage/<manageCode>
```

## 请求约束

创建投递接口需要以下请求头：

| 请求头 | 说明 |
| --- | --- |
| `content-length` | 必须存在，且必须是 1 到 100 MB 之间的整数。浏览器和 `curl --data-binary` 通常会自动设置。 |
| `x-file-name` | 原始文件名。前端会使用 `encodeURIComponent(file.name)` 传入。 |
| `x-content-type` | 文件 MIME 类型；缺省时使用 `content-type`，再缺省则为 `application/octet-stream`。 |
| `x-expires-in-hours` | 只能是 `1`、`24` 或 `168`。缺省为 `24`。 |
| `x-max-downloads` | 只能是 `1` 到 `10`。缺省为 `1`。 |

常见状态码：

| 状态码 | 含义 |
| --- | --- |
| `201` | 创建成功。 |
| `400` | 请求头或请求体不合法。 |
| `401` | 已设置 `SITE_PASSWORD`，但当前请求没有通过站点密码验证。 |
| `404` | 找不到投递或 R2 对象缺失。 |
| `410` | 文件已过期、已撤回或下载次数已用尽。 |
| `411` | 缺少合法的 `content-length`。 |
| `413` | 文件超过 100 MB。 |
| `409` | 并发下载时投递状态已变化。 |
| `500` | Cloudflare 绑定不可用或存储失败。 |

## 运维和安全注意事项

- `wrangler.example.jsonc` 已包含 `compatibility_date`、`nodejs_compat`、静态资源绑定、R2、D1 和 observability 配置；新建环境时优先从它复制。
- `SITE_PASSWORD` 按普通 Worker variable 管理，方便在 Cloudflare 仪表盘修改；留空即关闭站点密码门禁。
- 保持 R2、D1 通过 Worker 绑定访问，不要在 Worker 内部绕到 Cloudflare REST API。
- 大文件处理保持流式读取和流式响应，不要改成 `arrayBuffer()` 或 `text()` 读取整文件。
- 后台清理、过期删除等响应后工作应继续使用 `ctx.waitUntil()`。
- 取件码、管理码需要继续使用 Web Crypto 生成和哈希，不要改用 `Math.random()`。
- 更新 Cloudflare 配置后运行类型生成：

```bash
bun run cf-typegen
```

## 可用脚本

| 命令 | 说明 |
| --- | --- |
| `bun run dev` | 启动 Next.js 开发服务器。 |
| `bun run build` | 执行 Next.js 构建。 |
| `bun run preview` | OpenNext 构建并本地预览 Cloudflare 运行时。 |
| `bun run deploy` | OpenNext 构建并部署到 Cloudflare。 |
| `bun run upload` | OpenNext 构建并上传 Worker。 |
| `bun run cf-typegen` | 根据 Wrangler 配置生成 Cloudflare 绑定类型。 |
