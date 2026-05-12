# 文件快递柜

文件快递柜是一个部署在 Cloudflare Workers 上的轻量文件/文本临时中转工具。上传方把文件或文本放入柜中后，会得到取件码、取件链接和管理码；取件方凭取件码领取内容；上传方可用管理码主动撤回。

项目使用 Next.js App Router 构建界面和 API，通过 OpenNext 运行在 Cloudflare Workers。文件正文存储在 Cloudflare R2，投递记录、取件码哈希、管理码哈希、下载次数和审计事件存储在 Cloudflare D1。

## 功能

- 支持寄存单个文件，最大 100 MB。
- 支持寄存文本，最大 256 KB，并可在取件页直接预览和复制。
- 保存期限可选 1 小时、24 小时或 7 天。
- 最大下载/查看次数可设置为 1 到 10 次。
- 取件码和管理码只保存 SHA-256 哈希，不以明文入库。
- 文件到期、下载次数用尽或主动撤回后，会标记记录并删除 R2 对象。
- 上传和下载使用流式处理，减少 Worker 内存压力。
- 可配置站点访问密码、管理后台密码和只读演示模式。
- 提供 `/admin` 管理后台，可查看投递记录、上传/下载来源事件，手动撤回或调整下载次数。
- 提供站点统计接口和首页上传/下载计数展示。

## 技术栈

- Next.js 16 App Router
- React 19
- Tailwind CSS 4
- OpenNext for Cloudflare
- Cloudflare Workers、R2、D1
- Bun

## 开发方式

### 环境准备

本项目使用 Bun 作为包管理器和脚本运行器。首次进入项目后先安装依赖：

```bash
bun install
```

如果需要使用 Cloudflare 绑定、本地 D1、R2 或 Worker 运行时预览，请确保已安装并可使用 Wrangler。项目依赖里已经包含 `wrangler`，可以直接通过 `bunx wrangler` 调用。

### 本地配置

复制 Wrangler 配置模板：

```bash
cp wrangler.example.jsonc wrangler.jsonc
```

开发时重点检查这些配置：

- `name`：本地 Worker 名称，可使用默认项目名或自定义名称。
- `services[0].service`：和 `name` 保持一致。
- `r2_buckets[0].binding`：保持为 `FILE_BUCKET`，这是代码访问 R2 的变量名。
- `d1_databases[0].binding`：保持为 `DB`，这是代码访问 D1 的变量名。
- `d1_databases[0].database_name`：本地迁移命令中使用的数据库名称。
- `vars.SITE_PASSWORD`：站点访问密码；留空时本地首页不需要密码。
- `vars.ADMIN_PASSWORD`：管理后台密码；留空时 `/admin` 会提示未配置。
- `vars.DEMO_MODE`：只读演示模式；本地调试写入逻辑时建议保持 `false`。

`binding` 是代码里的变量名，不要改成资源真实名称。项目通过 `env.FILE_BUCKET` 访问 R2，通过 `env.DB` 访问 D1。

### 初始化本地 D1

复制配置后，执行本地数据库迁移：

```bash
bunx wrangler d1 migrations apply file-delivery-locker --local
```

如果你修改了 `wrangler.jsonc` 里的 `database_name`，把命令中的 `file-delivery-locker` 替换成对应名称。

### 启动开发服务

```bash
bun run dev
```

打开 http://localhost:3000。

`next.config.ts` 已调用 `initOpenNextCloudflareForDev()`，因此 `next dev` 中可以通过 OpenNext 读取 Cloudflare 绑定。开发前请先完成 `wrangler.jsonc` 配置和本地 D1 迁移，否则上传、取件或后台接口可能会提示绑定或数据表不可用。

常用页面：

- `/`：文件/文本寄存、取件、撤回入口。
- `/admin`：管理后台，需要配置 `ADMIN_PASSWORD`；演示模式下可只读进入。

### 本地运行时预览

普通开发使用 `bun run dev` 即可。如果需要更接近 Cloudflare Workers 的运行方式，可以使用 OpenNext 预览：

```bash
bun run preview
```

这个命令会先构建 OpenNext 产物，再在本地预览 Worker 行为，适合检查 R2、D1、静态资源和 API 路由在 Cloudflare 运行时中的表现。

### 常用脚本

```bash
bun run dev        # 启动 Next.js 开发服务
bun run build      # Next.js 构建
bun run preview    # OpenNext 构建并本地预览 Cloudflare Worker
bun run cf-typegen # 生成 Cloudflare Env 类型
```

修改 `wrangler.jsonc` 中的绑定、变量或资源配置后，可以重新生成 Cloudflare 环境类型：

```bash
bun run cf-typegen
```

## 配置说明

`SITE_PASSWORD` 为空时，首页和普通 API 不需要密码；设置后，浏览器会保存一个 7 天有效的登录 Cookie。修改密码后需要重新登录。

`ADMIN_PASSWORD` 为空时，`/admin` 后台不可用；设置后，后台登录 Cookie 有效期为 8 小时。

`DEMO_MODE` 开启后，首页和后台无需密码，且系统进入只读演示状态：不能上传文件、寄存文本、撤回文件或修改下载次数；取件、文本预览、下载、统计和后台列表仍可使用。演示模式下的下载和预览不会消耗下载次数，也不会写入事件或删除 R2 对象。

## 项目结构

```text
src/app/page.tsx                                  首页入口
src/app/locker-app.tsx                            首页交互逻辑
src/app/admin/page.tsx                            管理后台入口
src/app/admin/admin-app.tsx                       管理后台交互逻辑
src/app/api/deliveries/route.ts                   创建文件/文本投递
src/app/api/deliveries/[pickupCode]/route.ts      查询投递状态
src/app/api/deliveries/[pickupCode]/preview/route.ts   预览文本投递
src/app/api/deliveries/[pickupCode]/download/route.ts  下载投递内容
src/app/api/deliveries/manage/[manageCode]/route.ts    通过管理码撤回
src/app/api/admin/deliveries/route.ts             后台投递列表
src/app/api/admin/deliveries/[id]/events/route.ts 后台事件列表
src/lib/locker.ts                                 校验、哈希、Cookie、Cloudflare 绑定和通用工具
migrations/                                       D1 数据库迁移
wrangler.example.jsonc                            Cloudflare 配置模板
```

## API 简要说明

创建投递：

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

查询、下载和撤回：

```bash
curl http://localhost:3000/api/deliveries/<pickupCode>
curl -OJ http://localhost:3000/api/deliveries/<pickupCode>/download
curl -X DELETE http://localhost:3000/api/deliveries/manage/<manageCode>
```
