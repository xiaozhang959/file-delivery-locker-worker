# 快速部署

首先你需要点击库页面右上角的 "Use this template", 创建一个私密的库

![new repo](./image/new_repo.png)

打开 `./wrangler.jsonc` 文件, 修改 `name`, `services.service` 的值为你库的名字

![change jsonc](./image/change_jsonc.png)

划到下面确认普通环境变量

- `DEMO_MODE`: 演示模式-布尔类型: 默认 false, 开启后前台无需站点密码且保持只读；后台仍需 `ADMIN_PASSWORD` 登录，且不能读取文本内容或下载文件

密码不要写入 `wrangler.jsonc`。部署前使用 Cloudflare Secrets 保存：

```bash
bunx wrangler secret put SITE_PASSWORD
bunx wrangler secret put ADMIN_PASSWORD
```

`SITE_PASSWORD` 是站点访问密码，`ADMIN_PASSWORD` 是后台密码。`wrangler.jsonc` 已把这两个名称声明为必需 Secret，缺少时部署会失败。

在侧边栏 -> 计算 -> workers 和 Pages 下创建一个应用程序

选择 Continue with GitHub, 如果你没有绑定你的 GitHub 可能需要先绑定一下

![clone repo](./image/clone_repo.png)

选择你一开始创建的库, 然后修改部署命令为 `bun run deploy`

![change command](./image/change_command.png)

然后点击部署, 坐和放宽...

等待 `✨ Success! Build completed.` 之后就可以点击访问! 你就可以开始使用了

![bind](./image/bind.png)

> 不要在意截图里面的错误

如果你有自己的域名可以绑定到自己的域名上
