# 文件快递柜

一个基于 Cloudflare Workers、R2 和 D1 的轻量文件/文本临时中转柜, 支持取件码领取、下载次数限制、自动过期和后台管理.

拥抱 serverless, 拒绝繁重的部署方式.

## 功能

- 支持寄存单个文件, 最大 100 MB.
- 支持寄存文本, 最大 256 KB, 并可在取件页直接预览和复制.
- 保存期限可选 1 小时、24 小时或 7 天.
- 最大下载/查看次数可设置为 1 到 10 次.
- 取件码和管理码只保存 SHA-256 哈希, 不以明文入库.
- 取件查询使用 Cap.js Proof-of-Work 防枚举, 且挑战难度会随错误次数递增.
- 文件到期、下载次数用尽或主动撤回后, 会标记记录并删除 R2 对象.
- 上传和下载使用流式处理, 减少 Worker 内存压力.
- 可配置站点访问密码、管理后台密码和只读演示模式.
- 提供 `/admin` 管理后台, 可查看投递记录、上传/下载来源事件, 手动撤回或调整下载次数.
- 提供站点统计接口和首页上传/下载计数展示.

## 技术栈

- Next.js 16 App Router
- React 19
- Tailwind CSS 4
- OpenNext for Cloudflare
- Cloudflare Workers、R2、D1
- Bun

# 文档

开发文档见 [development.md](./docs/development.md)
部署文档见 [deploy.md](./docs/deploy.md)
