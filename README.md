<img src="https://github.com/meorionel/file-delivery-locker-worker/blob/main/public/logo.webp?raw=true" width=64 height=64 />

一个基于 Cloudflare Workers、D1 和对象存储（Cloudflare R2 或 S3 兼容 API）的文件快递柜, 支持取件码领取、下载次数限制、自动过期和后台管理.

> 拥抱 serverless, 拒绝繁重的部署方式.

![](https://img.shields.io/badge/Next.js%2016-0?label=&logo=next.js&logoColor=fff&color=000000)
![](https://img.shields.io/badge/React%2019-0?label=&logo=react&logoColor=fff&color=077ea5)
![](https://img.shields.io/badge/Tailwind%20CSS-0?label=&logo=tailwindcss&logoColor=fff&color=00bcff)
![](https://img.shields.io/badge/Cloudflare-0?label=&logo=cloudflare&logoColor=fff&color=f78220)
![](https://img.shields.io/badge/Bun.js-f3e8d8?label=&logo=bun&logoColor=f3e8d8&color=0b0a08)

[部署文档](./docs/deploy.md) | [开发文档](./docs/development.md) | [在线示例](https://fdlw-demo.meorion.moe/)

## 功能

- 支持寄存单个文件, 最大 100 MB.
- 支持寄存文本, 最大 256 KB, 并可在取件页直接预览和复制.
- 保存期限可选 1 小时、24 小时、 7 天或者无期限.
- 最大下载/查看次数可设置为 1 到 10 次或者无限.
- 上传时可自定义 6 位取件码；留空则自动生成.
- 上传时计算内容哈希, 相同文件或文本会复用已有对象存储内容并生成新的取件码.
- 取件码使用 Secret Pepper 做 HMAC-SHA-256 哈希, 管理码只保存 SHA-256 哈希, 不以明文入库.
- 取件查询使用 Cap.js Proof-of-Work 防枚举, 且挑战难度会随错误次数递增.
- 文件到期、下载次数用尽或主动撤回后, 会标记记录并删除对象存储内容.
- 默认使用 Cloudflare R2，也可通过 `STORAGE_BACKEND=s3` 接入 S3 兼容 API.
- 上传和下载使用流式处理, 减少 Worker 内存压力.
- 可配置站点访问密码、管理后台密码和只读演示模式.
- 提供 `/admin` 管理后台, 可查看投递记录、上传/下载来源事件, 手动撤回或调整下载次数.
- 提供站点统计接口和首页上传/下载计数展示.
- 支持游客模式, 游客模式不需要密码, 可以一键下载文件

## 上传取件码

上传文件或寄存文本时，可以填写自定义取件码。取件码规则：

- 必须是 6 位字母或数字。
- 字母会自动转为大写。
- 不能和已有投递记录重复。
- 留空时后端会自动生成随机取件码。

管理员可以在 `/admin` 的“运行设置”中关闭自定义取件码。关闭后前台不再显示自定义取件码输入框，直接调用上传 API 传入 `x-pickup-code` 也会被拒绝。

## 对象内容缓存

`/admin` 的“运行设置”可以配置对象缓存秒数。默认 `0` 表示关闭；设置为正整数后，下载文件或预览文本时会优先读取 Worker 内部 Cache API 中的对象正文。

缓存只减少 R2 / S3 读取次数，不会绕过取件校验或下载次数限制：每次取件仍会检查 D1 状态并扣减下载/查看次数，最终返回给浏览器的响应仍是 `no-store`。

## 对象存储配置

默认使用 Cloudflare R2，保持 `STORAGE_BACKEND=r2` 并绑定 `FILE_BUCKET` 即可。

如果要使用 S3 兼容 API，将 Worker 环境变量改为：

```text
STORAGE_BACKEND=s3
S3_ENDPOINT=https://s3.example.com
S3_BUCKET=file-delivery-locker
S3_REGION=auto
S3_FORCE_PATH_STYLE=true
```

同时将 `S3_ACCESS_KEY_ID` 和 `S3_SECRET_ACCESS_KEY` 配置为 Worker Secret。AWS S3 请把 `S3_REGION` 改成真实 region；如果对象存储要求 virtual-hosted-style URL，可设置 `S3_FORCE_PATH_STYLE=false`。

部署后也可以在 `/admin` 的“运行设置”里切换 R2 / S3 兼容 API 并修改 S3 配置。后台保存的 S3 Secret 会加密写入 D1；建议额外配置 `STORAGE_CONFIG_KEY` 作为加密密钥，未配置时会回退使用 `PICKUP_CODE_PEPPER`。

![Screenshot](./public/_____zh.jpeg)

---

<img src="https://github.com/meorionel/file-delivery-locker-worker/blob/main/public/logo.webp?raw=true" width=64 height=64 />

A lightweight temporary file/text delivery locker built on Cloudflare Workers, D1, and object storage (Cloudflare R2 or an S3-compatible API). It supports pickup-code retrieval, download/view limits, automatic expiration, and an admin console.

> Serverless-friendly, without a heavy deployment footprint.

![](https://img.shields.io/badge/Next.js%2016-0?label=&logo=next.js&logoColor=fff&color=000000)
![](https://img.shields.io/badge/React%2019-0?label=&logo=react&logoColor=fff&color=077ea5)
![](https://img.shields.io/badge/Tailwind%20CSS-0?label=&logo=tailwindcss&logoColor=fff&color=00bcff)
![](https://img.shields.io/badge/Cloudflare-0?label=&logo=cloudflare&logoColor=fff&color=f78220)
![](https://img.shields.io/badge/Bun.js-f3e8d8?label=&logo=bun&logoColor=f3e8d8&color=0b0a08)

[Development documentation](./docs/deploy.md) | [Deployment documentation](./docs/development.md) | [Demo](https://fdlw-demo.meorion.moe/)

## Features

- Store a single file up to 100 MB.
- Store text up to 256 KB, with direct preview and copy support on the pickup page.
- Choose a retention period of 1 hour, 24 hours, 7 days or unlimited.
- Configure a maximum download/view count from 1 to 10 or unlimited.
- Optionally choose a custom 6-character pickup code on upload; leave it blank to auto-generate one.
- Compute a content hash on upload, so identical files or text reuse the existing stored object while still receiving a new pickup code.
- Hash pickup codes with HMAC-SHA-256 using a secret pepper; store manage codes only as SHA-256 hashes, never in plaintext.
- Protect pickup lookups from enumeration with Cap.js Proof-of-Work, with challenge difficulty increasing after repeated failures.
- Mark records and delete stored objects when deliveries expire, reach their download limit, or are manually revoked.
- Use Cloudflare R2 by default, or set `STORAGE_BACKEND=s3` to use an S3-compatible API.
- Stream uploads and downloads to reduce Worker memory pressure.
- Configure a site access password, admin password, and read-only demo mode.
- Provide an `/admin` console for viewing delivery records, upload/download source events, manual revocation, and download-count adjustments.
- Provide a site stats API and homepage upload/download counters.
- Supports guest mode. In guest mode, no password is required and files can be downloaded with one click

## Upload pickup code

When uploading a file or storing text, you can enter a custom pickup code. Rules:

- It must be exactly 6 letters or digits.
- Letters are normalized to uppercase.
- It cannot duplicate an existing delivery.
- Leave it blank to let the backend generate a random pickup code.

Admins can disable custom pickup codes in `/admin` under **Runtime Settings**. When disabled, the upload form hides the custom-code input and direct upload API calls with `x-pickup-code` are rejected.

## Object content cache

`/admin` **Runtime Settings** can configure the object cache TTL in seconds. The default `0` disables it. When set to a positive integer, file downloads and text previews first try the Worker internal Cache API for the stored object body.

The cache only reduces R2 / S3 reads. It does not bypass pickup checks or download/view limits: every request still checks D1 and increments the download count, and the browser-facing response remains `no-store`.

## Object storage configuration

Cloudflare R2 is the default. Keep `STORAGE_BACKEND=r2` and bind `FILE_BUCKET`.

To use an S3-compatible API, set these Worker variables:

```text
STORAGE_BACKEND=s3
S3_ENDPOINT=https://s3.example.com
S3_BUCKET=file-delivery-locker
S3_REGION=auto
S3_FORCE_PATH_STYLE=true
```

Add `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` as Worker Secrets. For AWS S3, set `S3_REGION` to the real region. If your provider requires virtual-hosted-style URLs, set `S3_FORCE_PATH_STYLE=false`.

After deployment, `/admin` **Runtime Settings** can also switch between R2 and S3-compatible storage and update S3 configuration. S3 secrets saved from the admin page are encrypted in D1. Configure `STORAGE_CONFIG_KEY` as the encryption key; if omitted, `PICKUP_CODE_PEPPER` is used as the fallback.

![Screenshot](./public/_____en.jpeg)
