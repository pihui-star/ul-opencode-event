# Draft: 插件重启后 token 数据恢复

## 需求
插件重启后，tokenDataMap 为空，旧会话的 token 显示为 0。需要在初始化时从 OpenCode SQLite 数据库预加载最近会话的 token 数据。

## 技术方案

### 数据源：直接读 OpenCode SQLite 数据库
- 路径：`~/.local/share/opencode/opencode.db`（已通过 OPENCODE_DATA_DIR 环境变量可知）
- 表：`message`，`data` JSON 字段包含 tokens/cost/modelID/providerID
- 过滤：`role === 'assistant'` 且 `tokens.input + tokens.output > 0`
- 引用最近的 session（session 表按 time_updated DESC 排序）

### 并发安全
- WAL 模式下只读并发完全安全
- bun:sqlite readonly 模式，不阻塞 OpenCode 写操作
- 短生命周期连接：初始化时读取，读完关闭

### 实现思路
1. 插件初始化时，用 bun:sqlite 只读打开 opencode.db
2. 查询最近 N 个 session 的 assistant 消息
3. 解析 data JSON，提取 tokens/cost/modelID/providerID
4. 写入 tokenDataMap
5. 关闭数据库连接

### 加载范围
- 只加载最近 N 个 session（如最近 5-10 个）
- 每个 session 只加载 assistant 消息
- 初始化完成后关闭数据库连接

## 调研结果
- SQLite WAL 只读并发：安全（官方确认）
- bun:sqlite 内置支持：零外部依赖
- tokenscope 用 SDK API：不适合事件触发场景
- 其他项目先例：better-sqlite3 作者确认多进程只读可行

## 数据库结构
```sql
message 表:
  id TEXT PRIMARY KEY
  session_id TEXT NOT NULL
  time_created INTEGER NOT NULL
  time_updated INTEGER NOT NULL
  data TEXT NOT NULL  -- JSON，含 tokens/cost/modelID/providerID

message.data（assistant 消息）:
  {
    role: "assistant",
    tokens: { input: N, output: N, reasoning: N, cache: { read: N, write: N } },
    cost: N,
    modelID: "...",
    providerID: "...",
    mode: "build",
    agent: "build"
  }
```

## 注意事项
- bun:sqlite 是 Bun 内置的，不需要额外安装依赖
- 但插件也可能在 Node.js 环境运行（OpenCode 支持 Node），需要考虑兼容性
- message.data 的 tokens 结构与 SDK 事件中略有不同（cache 是嵌套对象而非 cacheRead/cacheWrite 平级字段）
