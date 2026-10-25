# @local/dsh-settings-tweaks

把左下角账号菜单里的两项搬进设置，并让左下角入口直接打开设置。

| # | 原行为 | 现在 |
| - | --- | --- |
| 1 | 左下角菜单 → 「退出登录」 | 设置 → **账号与余额** 页底部，账号卡片下方的一张卡片（内联二次确认） |
| 2 | 左下角菜单 → 「意见反馈」 | 设置 → **通用设置** 里的一行（在「开发者工具」与「当前版本」之间） |
| 3 | 点左下角弹出菜单 | 点左下角 **直接打开设置** |

## 实现方式

官方客户端包 `@deepseek-ai/dsh-client-ui-settings-account` 在 `settings.launcher`
（单槽）与 `settings.section`（`id: account`）上注册了左下角菜单和账号页。本插件
**不改 `app.asar`**，只利用槽位引擎暴露的可写 `StoredEntry.component`：

- `settings.launcher` 的条目组件被包一层 `<div style="display:contents" onClickCapture>`：
  已登录时在捕获阶段拦下 `[aria-haspopup="menu"]` 的点击并调用 ownerProps 里的
  `openSettings()`，菜单不会展开。官方 `AccountMenu` 仍然完整挂载，所以奖励通知卡、
  会话过期 / 需要登录的 Toast、登录弹窗、退出确认弹窗全部照常工作。
- `settings.section` 中 `id === 'account'` 的条目组件被包一层：先渲染官方
  `AccountSection`（账号卡片、余额、钱包、充值等 UI 原样保留），再在其下方追加
  `SignOutCard`。`signOut()` / `hasRunningAccountTasks()` 来自该条目 inject 面
  （即账号插件的 `operations` 对象），所以退出语义与官方完全一致。
- `settings.general.item`（列表槽，root 作用域）新增一条 `id: feedback`、`order: 50`
  的条目，点击调用同一个 `operations.contactUs()`；取不到时降级为按
  `globalThis.__DSH_CONTACT_CONFIG__` 自拼 URL 打开。

`ctx.slots.subscribe` 让包装在官方条目重注册（登录态变化）后重新生效；
`ctx.effect` 的清理函数把每个 `component` 还原、注销反馈行与订阅，禁用插件即完全复原。

## 文件

```
package.json       dsh.bundle.patch → cordis.patch.yml；dsh.client → client.js（web/immediately）
cordis.patch.yml   一行 insert：id settings-tweaks，name '@local/dsh-settings-tweaks'
index.js           Host 半边，空 apply（只为让 host 的 client-module 扫描读到包根）
client.js          全部 UI 逻辑
```

## 已知限制

- **未登录时**左下角保留官方菜单（登录入口不能丢），此时菜单里仍会出现「意见反馈」。
  已登录用户完全看不到菜单。
- 依赖官方条目的 `inject` 面带 `signOut` / `hasRunningAccountTasks` / `contactUs`。
  DSH 升级后若这些键消失，退出卡片自动隐藏并打 warn，界面不会崩。
- 若官方把 `settings.section` 的账号条目改成不写 `component` 或冻结该对象，包装会
  静默跳过（console warn），设置页保持官方原样。

## 安装 / 回滚

安装：profile `package.json` 的 `dependencies` 加
`"@local/dsh-settings-tweaks": "link:/path/to/settings-tweaks"`，
`dsh.profile.bundles` 追加 `"@local/dsh-settings-tweaks"`，`pnpm install`，重启宿主。

回滚：从 `dsh.profile.bundles` 删除该行 → `pnpm install` → 重启；或恢复
`package.json.bak-<epoch>`。目录留在原地即可，不在 bundles 里就不会加载。
