# 参与拾光

欢迎反馈问题、改进体验或提交代码。项目由 **Hoshi Takyobu** 维护，采用 MIT 许可。

## 提交问题

在 GitHub Issues 中说明版本、Windows 版本、复现步骤、预期结果和实际结果。截图请先遮盖个人信息；请勿公开上传自己的 `worklog.json`、用户名路径、访问令牌等内容。

## 开发与验证

使用 Windows 和 Node.js 22+，先执行 `npm ci`，再执行 `npm start`。计时与每日记录在 `src/clock.cjs`，退出保存逻辑在 `src/lifecycle.cjs`，数据存储在 `src/store.cjs` 与 `src/settings.cjs`，原生窗口和 IPC 在 `src/main.cjs`，自启动在 `src/startup.cjs`，界面位于 `src/renderer/`。

请运行与改动相关的检查：

```powershell
npm test
npm run test:startup
npm run test:shutdown
npm run test:shortcuts
npm run test:system
npm run test:ui
npm run check:docs
```

启动项测试会临时创建带独立测试 ID 的当前用户注册表项，结束后清理。关机回归向隔离 Electron 测试进程发送真实的 `WM_QUERYENDSESSION` / `WM_ENDSESSION` 消息，不会关闭 Windows。界面测试使用临时工时目录。正式应用的启动项和数据不作为测试样本。报告验证时写明实际运行的命令与结果；消息回归不能替代整机真实关机测试。

工时文件保留 `version: 1`，1.5.0 增加 `events` 和 `lastCheckpointAt` 字段。操作节点保存时间戳，日详情按本机时区拆分；检查点只保存累计，不新增上班节点。兼容旧文件时保留总时长，不推测缺失的历史点击时间。调整记录影响当日累计，不修改原始在岗或休息区间；导出须关闭副本中的未结束区间，不能改变正在计时的实例。

全局快捷键由 `src/shortcuts.cjs` 负责校验和注册，设置默认全部禁用。修改时须同时验证应用内重复和系统注册失败；保存失败应保留原绑定与配置。`test:shortcuts` 检查原生注册、冲突及按键触发，不能只用模拟注册器替代。Windows 注册失败不能用于判断具体哪个应用占用了组合键。

提交 PR 时说明用户遇到的问题、改动后的行为以及验证结果。界面改动附截图。不要提交 `node_modules`、`release`、测试输出、个人数据或凭据。字体或运行时调整需要同步第三方许可。

版本发布由维护者按 [发布指南](docs/PUBLISHING.md) 操作。
