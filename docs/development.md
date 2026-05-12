# 开发方式

## 环境准备

本项目使用 Bun 作为包管理器和脚本运行器。首次进入项目后先安装依赖：

```bash
bun install
```

如果需要使用 Cloudflare 绑定、本地 D1、R2 或 Worker 运行时预览，请确保已安装并可使用 Wrangler。项目依赖里已经包含 `wrangler`，可以直接通过 `bunx wrangler` 调用。

## 本地配置

开发时重点检查 `wrangler.jsonc` 这些配置：

- `name`：本地 Worker 名称，可使用默认项目名或自定义名称。
- `services[0].service`：和 `name` 保持一致。
- `r2_buckets[0].binding`：保持为 `FILE_BUCKET`，这是代码访问 R2 的变量名。
- `d1_databases[0].binding`：保持为 `DB`，这是代码访问 D1 的变量名。
- `d1_databases[0].database_name`：本地迁移命令中使用的数据库名称。
- `vars.SITE_PASSWORD`：站点访问密码；留空时本地首页不需要密码。
- `vars.ADMIN_PASSWORD`：管理后台密码；留空时 `/admin` 会提示未配置。
- `vars.DEMO_MODE`：只读演示模式；本地调试写入逻辑时建议保持 `false`。

`binding` 是代码里的变量名，不要改成资源真实名称。项目通过 `env.FILE_BUCKET` 访问 R2，通过 `env.DB` 访问 D1。

## 初始化本地 D1

复制配置后，执行本地数据库迁移：

```bash
bunx wrangler d1 migrations apply file-delivery-locker-worker --local
```

如果你修改了 `wrangler.jsonc` 里的 `database_name`，把命令中的 `file-delivery-locker` 替换成对应名称。

## 启动开发服务

```bash
bun run dev
```

打开 http://localhost:3000。

`next.config.ts` 已调用 `initOpenNextCloudflareForDev()`，因此 `next dev` 中可以通过 OpenNext 读取 Cloudflare 绑定。开发前请先完成 `wrangler.jsonc` 配置和本地 D1 迁移，否则上传、取件或后台接口可能会提示绑定或数据表不可用。

常用页面：

- `/`：文件/文本寄存、取件、撤回入口。
- `/admin`：管理后台，需要配置 `ADMIN_PASSWORD`；演示模式下可只读进入。

## 本地运行时预览

普通开发使用 `bun run dev` 即可。如果需要更接近 Cloudflare Workers 的运行方式，可以使用 OpenNext 预览：

```bash
bun run preview
```

这个命令会先构建 OpenNext 产物，再在本地预览 Worker 行为，适合检查 R2、D1、静态资源和 API 路由在 Cloudflare 运行时中的表现。

## 常用脚本

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

# 配置说明

`SITE_PASSWORD` 为空时，首页和普通 API 不需要密码；设置后，浏览器会保存一个 7 天有效的服务端会话 Cookie。修改密码后已有会话会失效。

`ADMIN_PASSWORD` 为空时，`/admin` 后台不可用；设置后，后台服务端会话 Cookie 有效期为 8 小时。

`DEMO_MODE` 开启后，首页无需密码，且系统进入只读演示状态：不能上传文件、寄存文本、撤回文件、修改下载次数、读取文本内容或下载文件。后台仍需 `ADMIN_PASSWORD` 登录。

# 项目结构

```text
src/app/page.tsx                                  首页入口
src/app/locker-app.tsx                            首页交互逻辑
src/app/admin/page.tsx                            管理后台入口
src/app/admin/admin-app.tsx                       管理后台交互逻辑
src/app/api/deliveries/route.ts                   创建文件/文本投递
src/app/api/deliveries/[pickupCode]/route.ts      查询投递状态
src/app/api/deliveries/[pickupCode]/preview/route.ts   预览文本投递
src/app/api/deliveries/[pickupCode]/download/route.ts  下载投递内容
src/app/api/pow/challenge/route.ts                创建 Cap.js PoW challenge
src/app/api/pow/redeem/route.ts                   兑换 Cap.js PoW token
src/app/api/deliveries/manage/[manageCode]/route.ts    通过管理码撤回
src/app/api/admin/deliveries/route.ts             后台投递列表
src/app/api/admin/deliveries/[id]/events/route.ts 后台事件列表
src/lib/locker.ts                                 校验、哈希、Cookie、Cloudflare 绑定和通用工具
migrations/                                       D1 数据库迁移
wrangler.example.jsonc                            Cloudflare 配置模板
```

# API 简要说明

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

`/api/pow/redeem` 的 `solutions` 需由 Cap widget 计算；上面的数组仅用于展示请求形状。取件查询成功后会返回 `pickupAccessToken`，有效期 5 分钟，文本预览和文件下载都需要携带该 token。
