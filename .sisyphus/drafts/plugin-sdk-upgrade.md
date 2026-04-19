# Draft: Plugin SDK Upgrade (1.2.27 -> 1.14.17)

## Requirements (confirmed)
- 插件升级到兼容最新 OpenCode (1.14.17 SDK)
- 只有作者自己在用，不需要向后兼容旧版 OpenCode
- 插件收不到消息的根本原因是 OpenCode 升级后插件加载机制变化

## Root Cause Analysis

### 确认的根本原因
新版 OpenCode 的插件加载器 (PluginLoader) 发生了重大重构 (commit fa95a61):

1. **PluginModule 格式**: 新 loader 导入模块后调用 `(plugin as PluginModule).server(input, options)`
   - PluginModule = `{ id?: string, server: Plugin, tui?: never }`
   - 旧格式: 导出 Plugin 函数 (如 `export default NotificationPlugin`)
   - 新格式需要: 导出对象 `{ server: PluginFunction }` 或模块有 `.server` 属性

2. **exports 解析规则变化**:
   - 如果 package.json 有 `exports` 字段，loader 只解析 `./server` 或 `./tui`
   - 不再回退到 `exports["."]`
   - `package.json main` 只在无 `exports` 时用于 server 插件入口

3. **当前包的 exports 配置**:
   ```json
   "exports": {
     ".": { "import": "./dist/index.js" },
     "./server": { "import": "./dist/index.js" }
   }
   ```
   loader 解析 `./server` -> `dist/index.js` -> 导入模块 -> 调用 `module.server()` -> undefined -> 静默失败

### SDK 接口对比 (1.2.27 vs 1.14.17)

**兼容的 (无变化)**:
- `Hooks.event` 签名: `(input: { event: Event }) => Promise<void>` - 完全相同
- `Plugin` 类型: 仍然是 `(input: PluginInput) => Promise<Hooks>` (加了可选 options)
- `PluginInput` 字段: client, project, directory, worktree, serverUrl, $ - 全部保留

**新增的**:
- `PluginInput.experimental_workspace` - 新增
- `PluginOptions` - 可选参数
- `ProviderHook` - 新增 hook
- `experimental.compaction.autocontinue` - 新增 hook
- `chat.params` 新增 `maxOutputTokens`

**PluginModule 类型 (新增)**:
```typescript
export type PluginModule = {
    id?: string;
    server: Plugin;
    tui?: never;
};
```

### Event 类型变化
需要确认: Event, Session 等 SDK 类型是否有变化（字段名、结构）

## Technical Decisions
- 直接升级到最新 SDK，不保留旧版兼容
- 使用 PluginModule 格式导出
- 重新验证 Event/Session 类型兼容性

## Scope Boundaries
- INCLUDE: 升级 SDK 依赖、修复导出格式、更新 package.json exports、确认类型兼容、测试
- EXCLUDE: 不添加新功能（如新 hook），不改通知逻辑

## Open Questions
- Event/Session SDK 类型是否有字段变化？（需要检查 @opencode-ai/sdk 类型定义）
- ctx.client.tui.showToast 是否还有效？（TUI 已移到单独模块）
