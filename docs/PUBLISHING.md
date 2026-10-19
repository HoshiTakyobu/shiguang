# 在另一台电脑发布拾光

目标仓库：**[HoshiTakyobu/shiguang](https://github.com/HoshiTakyobu/shiguang)**。作者与发布者署名：**Hoshi Takyobu**。当前版本 **1.3.0**，MIT 开源。

这份源码包含 GitHub 首页、截图、许可证、安装配置和自动发布工作流。生成本地文件不会自动创建远程仓库；需要在有 GitHub 登录状态的电脑上完成下面步骤。

## 一、上传项目源码

1. 将发布资料中的 `Shiguang-1.3.0-Source.zip` 复制到另一台电脑并解压，进入包含 `package.json` 的文件夹。
2. 登录 GitHub，创建 **Public** 仓库 `HoshiTakyobu/shiguang`。创建时不要勾选自动生成 README、License 或 `.gitignore`，因为源码已有这些文件。
3. 安装 Git。在源码文件夹中打开 PowerShell，运行：

```powershell
git init -b main
git add .
git status
git commit -m "Release Shiguang 1.3.0"
git remote add origin https://github.com/HoshiTakyobu/shiguang.git
git push -u origin main
```

如 Git 提示需要身份信息，用 `git config user.name "Hoshi Takyobu"` 设置名称；邮箱使用自己的 GitHub 已验证邮箱或 GitHub 设置中提供的隐私邮箱，不要照抄别人的邮箱。按 Git 的登录界面完成认证。

源码 ZIP 不包含 `node_modules`、安装包、测试输出和个人工时。`.github` 必须一起上传；它是自动发布所需的配置目录。不要将整个发布资料文件夹上传为源码仓库。

仓库 About 建议填写：

> 一颗住在桌面上的工作球：签到计时、日历圆环、工时补录与本地备份。A playful Windows desktop work-time companion.

Topics 可用：`electron`、`windows`、`desktop-pet`、`time-tracker`、`calendar`、`offline`。仓库名若修改，需要同步 `package.json` 和文档中的链接。

## 二、自动生成并发布 Release（推荐）

首次上传后，先确认仓库 Actions 页中的 **CI** 成功，然后推送版本标签：

```powershell
git tag v1.3.0
git push origin v1.3.0
```

**Release** 工作流会在 GitHub 的 Windows 机器上安装依赖，核对版本，运行测试，构建安装版与免安装版，生成源码包和校验值，再创建 Release 并上传附件。另一台电脑不需要安装 Node.js 或本地打包环境。首次构建可能需要数分钟。

工作流使用仓库自带的 `GITHUB_TOKEN`，发布 job 已声明 `contents: write`，无需把个人访问令牌写进源码。如果组织禁用 Actions 或限制令牌写入，需要仓库所有者在对应设置中允许。普通 CI 与外部 PR 只有读取权限。

成功后检查 Releases 页是否包含：

- `Shiguang-1.3.0-Setup-x64.exe`
- `Shiguang-1.3.0-Portable-x64.exe`
- `Shiguang-1.3.0-Source.zip`
- `SHA256SUMS.txt`

发布过程先建立草稿，附件完整上传后才设为公开。上传失败可在 Actions 中重新运行失败的工作流；若已公开同名版本，脚本会停止，避免覆盖别人已下载的文件。Release 的安装包无数字签名，不会显示经证书验证的发布者。

## 三、直接上传这次已经打好的包

如果想使用发布资料内的成品，完成源码上传后，在 GitHub 的 **Releases → Draft a new release** 中操作：

1. 输入新标签 `v1.3.0`，目标选择 `main`，标题填写“拾光 1.3.0”。
2. 将随包的 `RELEASE_NOTES.md` 内容复制到描述。
3. 拖入上面的两个 EXE、Source ZIP 和 `SHA256SUMS.txt`。
4. 检查后点击 **Publish release**。

自动与手动发布选一种即可。由网页创建的新标签也可能触发 Release 工作流；如果本次选择手动方式，先在 Actions 页选择 Release 工作流并暂时 **Disable workflow**，手动发布完成后再启用，避免两种方式同时发布同一标签。README 下载入口在首个公开 Release 发布后生效。

## 四、以后更新版本

在 Windows、Node.js 22+ 环境下：

```powershell
npm ci
npm version 1.3.1 --no-git-tag-version
```

更新 `CHANGELOG.md`，创建对应的 `docs/releases/v1.3.1.md`，并将本指南中的当前版本与示例更新。然后运行：

```powershell
npm test
npm run test:startup
npm run test:ui
npm run check:docs
git add .
git commit -m "Release Shiguang 1.3.1"
git push
git tag v1.3.1
git push origin v1.3.1
```

已公开的版本不覆盖重发，修复请使用新版本号。

## 五、在本地重新打包

需要 Windows x64 和 Node.js 22+，首次构建需要联网下载 Electron 与 NSIS 工具。

```powershell
npm ci
npm run dist
npm run release:prepare
```

输出位于 `release`。发布脚本仅收集当前版本的两个 EXE、源码 ZIP 和校验值；`win-unpacked`、`*.blockmap`、`builder-*.yaml`、历史包不用上传。源码 ZIP 采用白名单，不收集运行时、工时数据或密钥文件。

安装后可在 Windows 文件属性中看到 Hoshi Takyobu。由于当前未配置代码签名证书，数字签名栏为空，这是发布者文本与证书签名的区别。
