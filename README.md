# random-dsh-plugins

堆放屎山。

能跑就行。

这里放的是我自己在用的 DeepSeek Harness（DSH）插件源码。没有上 npm，也没有做正式发行版；两个包都是 `private: true`，按本地 link 插件使用。

## 插件

| 插件 | 做什么 | 适用环境 |
| --- | --- | --- |
| [`win-toast`](win-toast/README.md) | 任务完成、出错、提问、审批时弹 Windows 原生 Toast；点击通知回到对应对话 | Windows 桌面版 DSH |
| [`settings-tweaks`](settings-tweaks/README.md) | 把「退出登录」「意见反馈」搬进设置页；左下角入口直接打开设置 | DSH Desktop，依赖官方内部槽位 |

## 安装

两个插件都通过 DSH profile 的本地 `link:` 依赖加载，不需要发布到 npm。

1. 克隆仓库到本地，例如：

   ```powershell
   git clone https://github.com/wdlpiaoyi/random-dsh-plugins.git C:\path\to\random-dsh-plugins
   ```

2. 打开 DSH profile 的 `package.json`（Windows 默认在
   `%USERPROFILE%\.dsh\profiles\desktop\package.json`），在 `dependencies` 里加：

   ```json
   {
     "@local/dsh-win-toast": "link:C:/path/to/random-dsh-plugins/win-toast",
     "@local/dsh-settings-tweaks": "link:C:/path/to/random-dsh-plugins/settings-tweaks"
   }
   ```

   只装其中一个时，只加对应的一行。

3. 在 `dsh.profile.bundles` 里追加要启用的包名：

   ```json
   [
     "@local/dsh-win-toast",
     "@local/dsh-settings-tweaks"
   ]
   ```

4. 在 profile 目录执行 `pnpm install`（或让 DSH 重新安装依赖），然后完全退出并重启 DSH Desktop。

   两个插件都带 `dsh.bundle.patch`，加载 bundle 时会自动插入自己的 Host 行，不需要再手动改 `cordis.patch.yml`。只改 `client.js` 时刷新页面即可；改 Host 侧代码或 `package.json` 后需要重启。

## win-toast

Windows 原生通知，不依赖第三方通知库：

- 覆盖任务完成、出错、提问、审批；可选被阻塞、被中止、子代理轮次。
- 点击通知会按 Host 进程 `pid` 找窗口并切到对应会话；多实例按 `pid` 隔离。
- 通知和点击回焦都由 PowerShell + `wscript.exe` 完成，不需要管理员权限，也不需要额外安装程序。
- AUMID 是 `Dsh.WinToast`，在 Windows 通知设置里显示为 **DSH Win Toast**；非官方项目，与 DeepSeek 无隶属关系。

配置项（`onTurnEnd`、`onError`、`sound`、`duration`、`locale` 等）和实现细节见
[`win-toast/README.md`](win-toast/README.md)。

安装前需要知道：

- 仅 Windows 10/11 桌面版；`dsh web` 没有 Windows Toast 能力。
- 会在 `HKCU\Software\Classes\dshfocus` 注册 `dshfocus://` 协议，卸载插件后不会自动删除。
- 通知权限或「专注助手」会直接吞掉横幅，插件无法感知。
- `package.json` 标注的 DSH 范围是 `>=0.1.1-rc.2 <0.3.0`，超出范围不保证能加载。

## settings-tweaks

不改 `app.asar`，只包装官方设置条目的 `component`：

- 已登录时，左下角账号菜单的「退出登录」变成设置页账号卡片下方的退出卡片。
- 「意见反馈」变成设置页「通用设置」里的一行。
- 左下角入口直接打开设置，不再展开账号菜单。
- 禁用插件后会还原被包装的条目和新增的反馈行。

它依赖官方 `settings.launcher`、`settings.section` 的结构和 `inject` 面（`signOut`、`hasRunningAccountTasks`、`contactUs`）。DSH 升级后如果这些内部接口变了，插件会尽量静默跳过而不是让页面崩溃；详见
[`settings-tweaks/README.md`](settings-tweaks/README.md)。

## 兼容性与限制

- 两个插件都面向 **DSH Desktop**；`settings-tweaks` 没有在 `dsh web` 上验证，`win-toast` 不适用于 web。
- 都依赖 DSH 的内部事件、槽位或客户端注入面，属于「跟着当前版本能用」的状态，不保证跨大版本兼容。
- 没有 npm 包、没有自动更新、没有 CI；这是个人自用堆放区，不提供稳定性承诺。

## 开发与验证

`win-toast`：

```powershell
cd win-toast
npm test              # 离线校验路由、过期、半写文件、pid 隔离等
npm run test:visual   # 真实弹四种通知并截图到 test/.tmp，需要交互桌面
```

`settings-tweaks` 没有自动化测试，改完在设置页手动验证：账号页退出卡片、通用设置反馈行、左下角点击行为、禁用插件后的复原。

## License

MIT，见根目录 [LICENSE](LICENSE)；各插件目录下也各有一份 `LICENSE`。

本项目是个人项目，与 DeepSeek 无隶属关系。使用前请自行确认 DSH 版本和插件行为；因升级、内部接口变化或系统通知设置导致的问题，不提供保证。
