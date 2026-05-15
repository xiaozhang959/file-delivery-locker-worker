# 快速部署

首先你需要点击库页面右上角的 "Use this template", 创建一个库

![new repo](./image/new_repo.png)

打开 `./wrangler.jsonc` 文件, 修改 `name`, `services.service` 的值为你库的名字

![change jsonc](./image/change_jsonc.png)

切换到 CloudFlare 在侧边栏 -> 计算 -> workers 和 Pages 下创建一个应用程序

选择 Continue with GitHub, 如果你没有绑定你的 GitHub 可能需要先绑定一下

![clone repo](./image/clone_repo.png)

选择你一开始创建的库, 然后修改部署命令为 `bun run deploy`

![change command](./image/change_command.png)

然后点击部署, 坐和放宽...

然后你大概率会看到这个报错

![secret error](./image/secret_error.png)

这是因为 secret 这个东西没法在部署的准备阶段设置

> 天杀的, 你既然不能设置就不要报错啊, 你这混蛋

我们只需要点击上面的设置, 然后添加一下 `ADMIN_PASSWORD` `PICKUP_CODE_PEPPER` `SITE_PASSWORD`

主要! 添加时需要修改类型为密钥

这仨分别是:

- ADMIN_PASSWORD      后台管理员密码
- SITE_PASSWORD       用户访问网站用的密码
- PICKUP_CODE_PEPPER  生成取件码时的pepper, 你不需要知道这是什么, 你只需要把你的脸放到键盘上然后滚动, 滚出一堆随机长字符串

![add secret](./image/add_secret.png)

添加完成点击部署

然后切换到 R2 和 D1 的页面, 将上次自动创建的数据库和对象存储删了

回到 workers 页面, 点击`最近的部署失败`, 再点击重试构建, 坐和放宽...

等待 `✨ Success! Build completed.` 之后就可以点击访问! 你就可以开始使用了

![bind](./image/bind.png)

> 不要在意截图里面的错误

如果你有自己的域名可以绑定到自己的域名上
