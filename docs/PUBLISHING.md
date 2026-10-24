# 发布拾光

仓库：**[HoshiTakyobu/shiguang](https://github.com/HoshiTakyobu/shiguang)**。作者与发布者署名：**Hoshi Takyobu**。当前版本 **1.6.0**，MIT 开源。

## 准备与验证

在 Windows x64、Node.js 22+ 环境下克隆仓库；持续集成使用 Node.js 24。也可解压 `Shiguang-1.6.0-Source.zip` 进行本地构建，源码包不含 Git 历史、依赖、安装包或个人工时。

```powershell
git clone https://github.com/HoshiTakyobu/shiguang.git
cd shiguang
npm ci
npm test
npm run test:startup
npm run test:system
npm run test:shutdown
npm run test:exit
npm run test:monthly
npm run test:cloud
npm run test:phone
npm run test:shortcuts
npm run test:ui
npm run check:docs
```

`test:shutdown` 向隔离测试进程发送 Windows 会话结束消息，不会关闭 Windows。`test:shortcuts` 检查原生全局快捷键注册、冲突和触发。发布记录应区分已运行的消息回归与整机真实关机测试。正式应用的数据不作为测试样本。

版本必须在 `package.json`、`package-lock.json`、`CHANGELOG.md` 和 `docs/releases/v1.6.0.md` 中一致。确认改动与测试结果后提交并推送源码，先等待仓库 Actions 页中的 **CI** 成功。

## 自动发布

当前版本尚未发布时，推送与包版本一致的新标签：

```powershell
git tag v1.6.0
git push origin v1.6.0
```

**Release** 工作流在 Windows 上安装依赖，核对版本，运行检查，构建安装版与免安装版，并对打包后的应用再次运行界面、会话结束和快捷键回归。随后生成源码包与校验值，创建 Release 草稿，完整上传附件后公开。

工作流使用仓库自带的 `GITHUB_TOKEN`，发布 job 声明 `contents: write`，无需将个人令牌写进源码。普通 CI 与外部 PR 只有读取权限。若仓库限制 Actions 或令牌写入，由仓库所有者调整对应设置。

成功后在 [Releases](https://github.com/HoshiTakyobu/shiguang/releases) 检查版本、说明及四个附件：

- `Shiguang-1.6.0-Setup-x64.exe`
- `Shiguang-1.6.0-Portable-x64.exe`
- `Shiguang-1.6.0-Source.zip`
- `SHA256SUMS.txt`

下载后可用 `Get-FileHash -Algorithm SHA256 文件路径` 对照校验值。上传失败可重新运行失败的工作流；若同名版本已经公开，发布脚本会停止。已公开附件不覆盖重发，修复需使用新版本号。

## 本地构建

首次构建需要联网下载 Electron 与 NSIS 工具。验证通过后运行：

```powershell
npm run dist
$env:SHIGUANG_EXECUTABLE = Join-Path (Get-Location) 'release/win-unpacked/拾光.exe'
npm run test:ui
npm run test:shutdown
npm run test:exit
npm run test:monthly
npm run test:cloud
npm run test:phone
npm run test:shortcuts
Remove-Item Env:SHIGUANG_EXECUTABLE
npm run release:prepare
```

每个命令成功后再执行下一步。输出在 `release`，包括上述附件及 `RELEASE_NOTES.md`。源码包按白名单生成，不收集运行时、工时数据或密钥文件。`win-unpacked`、`*.blockmap`、`builder-*.yaml` 和历史包不用上传。

如需手动发布，先暂时禁用 **Release** 工作流以避免同一标签重复发布，再在 GitHub 创建草稿，选择已验证的提交，填写 `RELEASE_NOTES.md` 并上传四个附件。检查完整后公开并恢复工作流。自动发布和手动发布选择一种即可。

当前 EXE 未配置数字签名。文件属性中的 Hoshi Takyobu 是发布者文本，不能代替证书签名。

## 后续版本

例如下一次修复版本：

```powershell
npm version 1.6.1 --no-git-tag-version
```

同步更新日志、新建 `docs/releases/v1.6.1.md`，并更新本指南中的版本与文件名。完成相关检查、提交和 CI 后，再推送对应的 `v1.6.1` 标签。
