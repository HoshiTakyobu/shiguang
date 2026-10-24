# 拾光手机查看服务

电脑主动向自己的 HTTPS 服务同步当前工时；手机登录网页后只读查看。电脑与手机可以使用不同网络，电脑无需开放入站端口。单人使用，一个服务对应一份最新快照。

## 数据与登录

服务保存今日工时、当前工作模式、月累计和月度目标，不收集完整每日明细或本地文件路径。电脑约每 5 秒上传，网页通过服务端事件获取变化并每秒显示计时；约 20 秒没有收到更新会标为离线并停止推算。电脑重新连接后以本机的新快照为准。

手机查看密码与电脑写入密钥互相独立。密码使用 scrypt 散列，浏览器会话采用 HttpOnly、Secure、SameSite=Strict Cookie，七天后重新登录。接口不开放跨站访问，登录有尝试次数限制；查看会话无法写入记录。电脑写入密钥由 Windows 凭据加密保存。

## 准备配置

在 Node.js 22+ 环境中，从仓库根目录生成服务配置：

```sh
node cloud/setup.cjs https://shiguang.example.com /secure/path/private.env
```

脚本生成随机的查看密码和电脑连接密钥，保存在相邻的 `private.env.credentials.txt`，不会在控制台打印。把 `private.env` 放到服务器的应用目录，权限设为 `600`。将查看密码和电脑密钥分别填入手机登录页与桌面「设置 → 手机查看」。这些文件不进入 Git 或源码发布包。

## Docker 部署

从仓库根目录构建，在反向代理后运行，示例使用本机端口 18768：

```sh
docker build -t shiguang-live:1.6.0 -f cloud/Dockerfile .
mkdir -p data
chown 1000:1000 data
chmod 700 data
docker run -d --name shiguang-live --label app=shiguang-live \
  --restart unless-stopped --read-only --cap-drop ALL \
  --security-opt no-new-privileges:true --memory 160m --pids-limit 128 \
  --tmpfs /tmp:size=16m --env-file ./private.env \
  --env NODE_OPTIONS=--max-old-space-size=64 \
  -p 127.0.0.1:18768:8787 -v "$PWD/data:/app/data" \
  shiguang-live:1.6.0
curl http://127.0.0.1:18768/api/health
```

已有 Docker Compose 时也可使用 [compose.yml](compose.yml)。首次生成配置和 `data` 目录后，执行 `docker compose -f cloud/compose.yml up -d --build`。

为自己的子域名配置 DNS、有效 HTTPS 证书和独立 Nginx 虚拟主机，参考 [nginx.example.conf](nginx.example.conf)。Nginx 关闭代理缓冲，并将 `X-Forwarded-For` 设置为可信的客户端地址。服务本身绑定回环端口，已有主站无需迁移。SSH 默认使用 22 端口，手机网站使用 443；80 端口用于证书验证和 HTTPS 跳转。

## 更新、改密与备份

更新服务时先构建新镜像，再仅重建 `shiguang-live` 容器，保留 `data` 目录。修改 `private.env` 后也必须重建容器，简单重启不会重新读取容器的环境配置。新生成的查看密码和写入密钥需要分别更新手机与电脑；替换会话密钥会使所有现有网页登录失效。

云端 `data/state.json` 只是最新只读快照，本机工时文件仍是记录来源。备份应以桌面软件的工时导出为主。删除云端快照后，下一次电脑同步会重新创建；停止服务不影响本机工时。

## 验证

在 Windows 开发环境运行 `npm run test:cloud` 验证权限、凭据、同步与跨月计时，再运行 `npm run test:phone` 验证 Electron → 服务 → 手机视口的完整流程。后者使用临时数据和无界面的 Microsoft Edge，不操作正式工时。
