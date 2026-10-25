# @local/dsh-win-toast

DSH 宿主 + 客户端插件：在以下时刻弹出 Windows **原生 Toast 通知**（横幅 + 通知中心），点击通知会回到 DSH 并打开对应对话：

- 任务完成（本轮结束）
- 出错（本轮以错误结束）
- 需要你回答（`ask_user_question`）
- 需要审批（工具审批）
- 可选：被阻塞 / 被中止（`onBlocked` / `onAbort`）

通知由 `lib/toast.ps1` 通过 WinRT Toast API 发送，AUMID 为 `Dsh.WinToast`，因此在 Windows 通知设置里显示为 **DSH Win Toast**。本插件是非官方项目，与 DeepSeek 无隶属关系，也不使用 DSH 的名称或图标。

## 点击通知后的行为

1. Toast 的激活 URI 形如 `dshfocus://focus?session=<sessionId>&pid=<hostPid>&app=...&title=...`。
2. Windows 调起 `wscript.exe //nologo focus-launch.vbs "<uri>"`（无控制台窗口）。
3. `focus-launch.vbs` 把 URI 放进子进程的 `DSH_FOCUS_URI` 环境变量；`focus.ps1` 从环境变量读取，**不把 URI 拼进 PowerShell 命令行**，因此 URI 里的 `$(...)`、引号等只会被当作数据。
4. `focus.ps1` 按 `pid` 找到对应 DSH 实例的窗口（找不到时再用 `title` 在所有 DSH 窗口中匹配），把窗口切到前台，并把 `{ sessionId, at }` 原子写入 `%TEMP%\dsh-toast-focus-<hostPid>.json`。
5. 客户端半部 `lib/client.js` 轮询 Host 路由 `GET /win-toast/focus`；每个 Host 只消费自己 pid 的请求文件，拿到 sessionId 后调用 `uiWorkspace.openSession(sessionId)`，UI 直接切到该对话。

协议处理器始终使用签名过的 `wscript.exe` + `powershell.exe`，**不再使用自编译的 `focus.exe`**——未签名 exe 在本机会触发「是否批准未知来源的程序运行」提示，导致点击通知被拦截。

## 通知停留时间与堆叠

- 每条通知都是独立的（**不设置 Tag/Group**）：Windows 按自己的队列显示横幅，新通知不会替换正在显示的旧横幅，也不会吞掉新横幅。
- `sound` 为 `true` 时通知里不写 `<audio>`，由 Windows 播放该系统通知音；为 `false` 时写 `<audio silent="true" />`，完全静音。
- `duration` 默认 `short`（约 5 秒）；`long` 约 25 秒。这是 Toast XML 的档位，不能精确到任意秒。
- 通知中心里的条目由 `expireSeconds` 控制（默认 30 秒后过期，`0` = 永不过期）。
- Windows 11 还可以在「设置 → 辅助功能 → 视觉效果」里全局调整通知显示时长；系统设置可能覆盖应用侧的效果。

## 配置

插件默认值集中在 `lib/index.js` 的 `DEFAULTS`。`cordis.patch.yml` 里的 `config` 默认为空对象，只有需要覆盖时才写键；例如：

```yaml
- insert:
    - id: win-toast
      name: '@local/dsh-win-toast'
      config:
        onAbort: true
        locale: en
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `onTurnEnd` | `true` | 任务完成 / 输出达上限时通知 |
| `onError` | `true` | 本轮出错时通知 |
| `onBlocked` | `true` | 本轮被策略或前置条件阻塞时通知（不是审批；审批见 `onApproval`） |
| `onQuestion` | `true` | 提问时通知 |
| `onApproval` | `true` | 工具审批时通知 |
| `onAbort` | `false` | 用户主动停止时也通知 |
| `notifySubagents` | `false` | 子代理的轮次也通知 |
| `skipWhenFocused` | `false` | DSH 窗口在前台时不弹（需要 user32 前台检测） |
| `onActivate` | `true` | 点击通知回到 DSH 并打开对应对话 |
| `sound` | `true` | 播放默认通知音 |
| `bodyLimit` | `180` | 正文截断长度 |
| `duration` | `short` | 横幅停留时间：`short` / `long` |
| `expireSeconds` | `30` | 通知中心硬过期秒数，`0` = 永不过期 |
| `locale` | `auto` | 通知文案语言：`auto` / `zh` / `en` |
| `focusProcessNames` | `["DeepSeek Harness"]` | `skipWhenFocused` 与点击回焦使用的进程名 |

## 实现要点

- Host 监听 `session/event` 的 `turn/end`，从 `reason.kind` 区分 completed / error / blocked / max-tokens / aborted；`blocked` 表示本轮被策略或前置条件挡住，不表示「正在等审批」。
- 审批与提问是 waterfall 事件：只旁听并用 `next()` 委托，绝不代替内置 UI 作答。
- 每次通知启动一个短生命周期的 PowerShell 进程，不阻塞会话；异常不会影响审批流程。
- `pending` 槽位在任何可失败操作前预留，`error`/`exit` 只释放一次；`mkdtempSync` 失败不会误减其他通知的槽位。
- 正文优先取本轮最后一条助手文本（`assistant/message`）的摘要。
- `isSubagentSession` 在 agent 注册表查不到会话时按「非子代理」处理，宁可多弹一条也不静默吞掉轮次。
- Toast 协议项只在命令值变化时写 HKCU，不再每条通知重写。
- Client 半部由 `package.json` 的 `dsh.client` 声明（`lib/client.js`），只做轮询与 `openSession()` 导航，不渲染 UI。

## 已知限制

- 仅 Windows 桌面 DSH；`dsh web` 的浏览器页面没有 Windows Toast 能力。
- 多实例（多个 Host 进程）已按 pid 隔离；如果多个窗口共享同一个 Host 进程，`title` 只能做尽力匹配，回焦仍可能落在该进程的第一个窗口。
- `HKCU\Software\Classes\dshfocus` 是用户级协议注册，卸载插件后不会自动删除；不需要时手动删除该键即可。
- Windows 的「专注助手」/通知权限会直接吞掉横幅；这类情况插件无法感知。

## 测试

```powershell
npm test                # 等价于 node test/bridge.mjs：离线校验路由、BOM、过期、半写文件、pid 隔离、legacy 回退、跨源/non-GET
npm run test:visual     # node test/harness.mjs：真实弹四种通知并截图到 test/.tmp（需要交互桌面，人工看图）
```

`test/harness.mjs` 是视觉验证脚本，不做断言；日常回归以 `test/bridge.mjs` 为准。

## 开发

修改 Host 侧代码后需要重启 DSH 桌面应用；只改 `lib/client.js` 时刷新页面（Ctrl+R）即可。首次新增 `dsh.client` 声明（或改 `package.json`）也需要重启一次，让 Host 重新扫描客户端 bundle。

## License

MIT，见 [LICENSE](LICENSE)。
