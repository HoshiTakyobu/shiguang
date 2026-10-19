# 参与拾光

欢迎反馈问题、改进体验或提交代码。项目由 **Hoshi Takyobu** 维护，采用 MIT 许可。

## 提交问题

在 GitHub Issues 中说明版本、Windows 版本、复现步骤、预期结果和实际结果。截图请先遮盖个人信息；请勿公开上传自己的 `worklog.json`、用户名路径、访问令牌等内容。

## 开发与验证

使用 Windows 和 Node.js 22+，先执行 `npm ci`，再执行 `npm start`。计时规则在 `src/clock.cjs`，数据存储在 `src/store.cjs` 与 `src/settings.cjs`，原生窗口和 IPC 在 `src/main.cjs`，自启动在 `src/startup.cjs`，界面位于 `src/renderer/`。

请运行与改动相关的检查：

```powershell
npm test
npm run test:startup
npm run test:ui
npm run check:docs
```

启动项测试会临时创建带独立测试 ID 的当前用户注册表项，结束后清理。界面测试使用临时工时目录。正式应用的启动项和数据不作为测试样本。

提交 PR 时说明用户遇到的问题、改动后的行为以及验证结果。界面改动附截图。不要提交 `node_modules`、`release`、测试输出、个人数据或凭据。字体或运行时调整需要同步第三方许可。

版本发布由维护者按 [发布指南](docs/PUBLISHING.md) 操作。
