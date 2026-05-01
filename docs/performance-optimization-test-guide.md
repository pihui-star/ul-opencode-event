# 性能优化改动影响分析与测试指南

> 本文档基于 v0.1.55 性能优化改动的全面分析，用于指导版本更新后的验证测试。

---

## 1. 改动概览

本次优化围绕 3 个目标，涉及 7 个改动点：

| 改动类别 | 具体改动 | 涉及文件 | 核心机制 |
|---------|---------|---------|---------|
| 启动阻塞消除 | preload/sessionCache 延迟加载 | `src/index.ts` | `setTimeout(fn, 0)` + 动态 import |
| 写 I/O 缓冲化 | logger/file channel 批量写入 | `src/logger.ts` `src/file.ts` | `WriteBuffer` (500ms 间隔) |
| 聚合计算优化 | projectAgg 增量计数器 | `src/index.ts` | delta(新值-旧值) 替代全量扫描 |

### 新增模块

| 文件 | 用途 |
|------|------|
| `src/write-buffer.ts` | 通用写缓冲区（append/flush/close，exit hook） |
| `src/file-rotation.ts` | 共享文件轮转逻辑（shouldRotate + rotateFile） |

### 未改动的模块（同步写入保留）

- `src/recorder.ts` -- 系统级变量录制器，保持同步写入（调试数据可靠性优先）
- `src/session-cache.ts` -- 会话级 token 缓存，保持同步写入

---

## 2. 影响面分析

### 2.1 projectAgg 增量聚合 -- Token 数值准确性

#### 数据流

```
message.updated (SDK 事件)
  ↓ 过滤: 仅 role=assistant
  ↓ delta = 新 token 值 - 旧 token 值 (同 messageId)
  ↓ 条件: sessionData.projectPath 匹配 ctx.directory
projectAgg 累加 (模块级计数器)
  ↓
通知事件 (idle/error/question/status/...)
  ↓ fillProjectData() — O(1) 读取 projectAgg
  ↓ 写入 payload.projectTokens / payload.projectCost
  ↓ handler.ts 构造 15 个模板变量
  ↓ locales.ts 模板渲染
  ↓ formatters.ts 通道格式化
邮件 / 钉钉 / 飞书
```

#### projectAgg 的 4 个写入路径

| 路径 | 触发时机 | 行号 | 说明 |
|------|---------|------|------|
| preload 初始化 | setTimeout(0) 中 preloadTokenData 完成后 | index.ts:643-655 | 遍历 tokenDataMap 匹配 projectPath 的会话，累加基数 |
| sessionCache 补充 | setTimeout(0) 中 loadSessionCache 完成后 | index.ts:668-679 | 去重排除已 preload 的会话，补充缓存中的历史数据 |
| session.created 回溯 | 预加载会话获得 projectPath 时 | index.ts:735-746 | 处理 preload 时无 directory 信息的会话 |
| message.updated delta | 每条 assistant 消息更新时 | index.ts:829-845 | 核心: delta = 新值 - 旧值 |

#### 受影响的模板变量（15 个）

所有通知模板中使用 `{{projectTokens*}}` 和 `{{projectCost*}}` 的变量：

- `{{projectTokensInput}}` / `{{projectTokensOutput}}` / `{{projectTokensReasoning}}`
- `{{projectTokensCacheRead}}` / `{{projectTokensCacheWrite}}`
- `{{projectTokensTotal}}` / `{{projectTokensTotalHuman}}`
- `{{projectCost}}` / `{{projectCostFormatted}}`
- `{{projectCacheHitRate}}`

**这三个层级互不影响**:
- 会话级 (`sessionTokens*`) -- 直接从 tokenDataMap 计算，不经过 projectAgg
- 总计级 (`totalTokens*`) -- aggregateSubSessions，不经过 projectAgg
- 项目级 (`projectTokens*`) -- 使用 projectAgg 增量计数器

#### 可能出问题的场景

| 场景 | 风险 | 现有防护 | 影响 |
|------|------|---------|------|
| preload 未完成就收到通知 | projectAgg 基数为 0 | 无防护（设计如此） | 项目级 token 偏低，后续通知会正确 |
| session.created 与 preload 竞态 | 理论上可能重复计算 | `!existingSessionData.projectPath` 守卫 | 低风险 |
| 同一 messageId streaming 更新 | delta 可能在中间态为 0 | SDK 中间态 token=0 不影响最终值 | 最终收敛正确 |
| 跨项目隔离失败 | 其他项目的 token 被计入 | `path.normalize()` 比对 | 有测试覆盖 |

### 2.2 写缓冲化 -- 数据丢失窗口

#### 各模块写入方式对比

| 模块 | 写入方式 | 缓冲大小 | 最大丢失窗口 | 用途 |
|------|---------|---------|------------|------|
| `logger.ts` | WriteBuffer | 500ms / 50条 | 最多 500ms 日志 | 运行日志 |
| `file.ts` | WriteBuffer | 500ms / 50条 | 最多 500ms 消息记录 | JSONL 通知记录 |
| `recorder.ts` | 同步 `appendFileSync` | 无 | 0 | 模板变量记录（最可靠） |
| `session-cache.ts` | 同步 `appendFileSync` | 无 | 0 | 会话 token 缓存 |

#### WriteBuffer 刷盘机制

| 触发条件 | 说明 |
|---------|------|
| `setInterval(500ms)` | 定时刷盘，每 500ms 一次 |
| `buffer.length >= 50` | 批量阈值，满 50 条立即刷盘 |
| `process.on('exit')` | 进程正常退出时同步刷盘 |
| 轮转前 (logger) | 文件可能超限时先 flush 再轮转 |

#### 进程退出时的数据安全

| 退出方式 | logger/file | recorder/session-cache |
|---------|-------------|----------------------|
| 正常退出 / `process.exit()` | 安全 (exit hook) | 安全 (即时写) |
| `SIGINT` (Ctrl+C) | 取决于 exit 事件是否触发 | 安全 |
| `SIGTERM` | 取决于 exit 事件是否触发 | 安全 |
| `SIGKILL` / 崩溃 / 断电 | **丢失最多 500ms** | 安全 |

#### 关键发现

`eventHandler.close()` 在插件生命周期中**从未被调用**。缓冲区的完整清理完全依赖 `process.on('exit')` hook。这意味着 OpenCode 如果通过 SIGKILL 退出（如系统 OOM killer），logger 和 file channel 的缓冲区数据会丢失。

### 2.3 延迟加载 -- 初始数据完整性

preload 和 sessionCache 均通过 `setTimeout(fn, 0)` 延迟执行。

**插件初始化后的状态**:

| 数据 | 初始值 | 加载时机 |
|------|--------|---------|
| `tokenDataMap` | 空 Map | setTimeout 中从 SQLite 预加载 |
| `sessionCache` | 空 Map | setTimeout 中从 JSONL 加载 |
| `projectAgg` | 全零 | preload/sessionCache 加载后累加 |

**影响**: 更新后首次使用时，第一个通知可能显示 Token(0/0/0) 的项目级数据。这不是 bug，是"启动不阻塞"的设计权衡。

---

## 3. 测试方法

### 3.1 方式一: 日志验证（推荐首选）

开启 debug 模式运行 OpenCode:

```bash
UL_OPENCODE_EVENT_DEBUG=1 opencode
```

**日志文件位置**: `~/.local/share/opencode/ul-opencode-event.log`

**需要关注的日志行**:

```
[EVENT] type=message.updated       # 确认 token 增量更新被处理
[RESOLVED] sessionInfo.id=xxx      # 确认 sessionMap 正确解析
Cache write                         # 确认缓存写入时机
Failed to handle event              # 错误信号，需要调查
Cache write failed                  # 缓存写入失败
```

**验证步骤**:

1. 启动 OpenCode 并执行一个编码任务
2. 等待任务完成（触发 idle 事件）
3. 收到通知后检查日志
4. 确认日志中有完整的 `[EVENT]` -> `[RESOLVED]` -> 正常处理流程
5. 确认无 `Failed to handle event` 错误

### 3.2 方式二: recorder JSONL 验证 Token 数值

recorder.ts 保持同步写入，记录每个通知事件的全部模板变量（约 56 个字段），是**最可靠的数据验证源**。

```bash
# 实时监控 recorder 输出
tail -f ~/.local/share/opencode/ul-opencode-event-variables.jsonl | \
  jq '{event: .eventType, projectInput: .projectTokensInput, projectTotal: .projectTokensTotal, projectCost: .projectCostFormatted}'
```

**验证要点**:

- `projectTokens*` 字段应随使用量**单调递增**，不应下降
- `sessionTokens*` 和 `totalTokens*` 不受 projectAgg 影响（用传统方式计算）
- 如果 `projectTokens` 出现负值或跳跃下降，说明 projectAgg 有 bug
- Token 三段式格式 `Token(会话/总量/项目)` 中，项目级的数值应 >= 会话级

### 3.3 方式三: file channel JSONL 验证消息内容

file channel 自动注入（无需额外配置），记录完整的事件 payload:

```bash
# 查看 file channel 记录
tail -f ~/.local/share/opencode/ul-opencode-event-messages.jsonl | \
  jq '{event: .eventType, projectTokens: .projectTokens, projectCost: .projectCost}'
```

**验证要点**:
- 每条记录是一个完整的 JSON 对象
- `projectTokens` 字段应包含 `{input, output, reasoning, cacheRead, cacheWrite, total}`
- 数值应与 recorder JSONL 中的对应字段一致

### 3.4 方式四: 对比测试（最可靠）

更新前后对同一项目执行相似操作，比较 token 数值:

```bash
# 步骤 1: 在当前版本完成一个任务，记录通知中的 token 数
# 步骤 2: 更新到优化版本
npm update @ulthon/ul-opencode-event

# 步骤 3: 重建缓存（重要！确保基数据正确）
# 在 OpenCode 中执行 /ul-token-rebuild 工具

# 步骤 4: 完成相似任务，比较 token 数值
```

**预期结果**: 相似操作量的任务，token 数值应在一个合理范围内（不会因为优化而大幅偏差）。

### 3.5 方式五: CLI 测试工具

```bash
# 测试所有通道连通性
npx @ulthon/ul-opencode-event test

# 测试指定通道
npx @ulthon/ul-opencode-event test --channel "My Email"

# 仅验证连接不发送
npx @ulthon/ul-opencode-event test --no-send
```

**验证要点**: CLI 应正常启动、显示通道信息、连接测试通过。

### 3.6 方式六: 单元测试

```bash
# 核心模块联合测试 (40 个)
bun test tests/incremental-agg.test.ts tests/write-buffer.test.ts \
  tests/file-rotation.test.ts tests/logger.test.ts tests/file.test.ts

# 项目级聚合集成测试
bun test tests/project-aggregation.test.ts

# 缓存命中率测试
bun test tests/cache-hit-rate.test.ts

# 全量测试 (预期: 452 pass / 71 pre-existing fail)
bun test
```

---

## 4. 后续版本的自动验证方案

### 4.1 recorder JSONL 一致性检查

解析 `ul-opencode-event-variables.jsonl`，自动化检查:

```bash
# 检查 projectTokens 是否单调递增
cat ~/.local/share/opencode/ul-opencode-event-variables.jsonl | \
  jq -r 'select(.eventType == "idle") | "\(.timestamp) \(.projectTokensTotal)"' | \
  awk '{if ($3 < prev) print "REGRESSION: " prev " -> " $3 " at " $1; prev = $3}'
```

### 4.2 file JSONL payload 完整性检查

检查每条通知的 projectTokens 字段:

```bash
# 检查 preload 完成后 projectTokens 是否非零
cat ~/.local/share/opencode/ul-opencode-event-messages.jsonl | \
  jq 'select(.eventType == "idle") | select(.projectTokens.total == 0) | "WARNING: zero projectTokens at " + .timestamp'
```

### 4.3 logger 日志异常监控

```bash
# 搜索错误日志
grep -E "ERROR|WARN" ~/.local/share/opencode/ul-opencode-event.log | \
  grep -v "DEBUG"
```

重点关注:
- `Failed to handle event` -- 事件处理失败
- `Cache write failed` -- 缓存写入失败
- `sessionMap miss` -- session 查找失败（可能的竞态条件）

### 4.4 缓存命中率验证

recorder JSONL 中的缓存命中率字段:

- `sessionCacheHitRate` -- 会话级缓存命中率
- `totalCacheHitRate` -- 总计级缓存命中率
- `projectCacheHitRate` -- 项目级缓存命中率

随着使用量增加，这些值应逐渐趋近 100%。如果始终为 0%，说明缓存未加载或 projectAgg 未正确初始化。

---

## 5. 已知限制与后续改进建议

### 5.1 已知限制

| 限制 | 原因 | 影响 | 缓解措施 |
|------|------|------|---------|
| SIGKILL 丢失最多 500ms 日志 | WriteBuffer 内存缓冲 | 运行日志可能不完整 | recorder.ts 保持同步写入，关键数据不受影响 |
| 首个通知项目级 token 可能为 0 | preload 延迟加载 | 首次使用体验 | 后续通知会自动正确 |
| 71 个测试联合运行失败 | Bun mock.module() 全局污染 | 仅影响 CI，不影响生产 | 单独运行全部通过 |
| ESLint 未配置 | 项目历史原因 | 代码风格无自动检查 | 建议后续添加 |

### 5.2 建议的后续改进

1. **注册 SIGINT/SIGTERM handler** -- 确保优雅关闭时调用 `eventHandler.close()` 和 logger `_close()`，减少缓冲区数据丢失风险
2. **projectAgg 一致性断言** -- 在 debug 模式下，fillProjectData 中添加 projectAgg 值与全量扫描结果的对比日志，便于排查数值偏差
3. **添加 ESLint 配置** -- 防止代码质量退化
4. **handler.close() 生命周期集成** -- 在 OpenCode 插件接口支持 close 钩子时，确保缓冲区完整刷盘

---

## 6. 验证清单（更新后执行）

- [ ] `npx @ulthon/ul-opencode-event test` CLI 正常工作
- [ ] OpenCode 启动不再卡在 "loading plugin"
- [ ] 完成一个编码任务，收到通知
- [ ] 通知中 token 数值非零且合理
- [ ] `~/.local/share/opencode/ul-opencode-event.log` 无 ERROR 级别日志
- [ ] recorder JSONL 中 projectTokens 单调递增
- [ ] 多次使用后 projectCacheHitRate > 0
- [ ] `bun test` 单独运行核心模块全部通过
