## Learnings

(Empty - no learnings yet)

### 函数结果缓存 (Wave 1: getLocalIP/getCurrentVersion/systemUptime)
- getLocalIP 缓存: 模块级 `let cachedLocalIP: string | null = null`，首次调用后永久缓存。IP 在进程生命周期内不变。
- getCurrentVersion 缓存: 模块级 `let versionCache: string | null | undefined = undefined`，用 undefined 区分"未缓存"和"缓存为 null"。
- systemUptime 缓存: 60s TTL，封装在 `getCachedSystemUptime()` 内部函数中。uptime 变化慢，60s 内无实际差异。
- 导出 `resetIPCache()`/`resetUptimeCache()`/`resetVersionCache()` 供测试用例重置缓存，避免跨测试污染。
- handler-system-vars.test.ts 中 getLocalIP 的原有测试通过临时覆盖 `os.networkInterfaces` 来验证不同场景，必须在 beforeEach 中调用 resetIPCache()，否则缓存会导致后续测试取到错误值。
- updater.test.ts 中 `runAutoUpdate` 相关的3个测试在当前环境预存失败（bun vs npm 检测、invalidatePackage 路径问题），与缓存修改无关。
- 函数公开签名保持不变，缓存逻辑完全在内部实现。
- 4处轮转代码(logger.ts, recorder.ts, session-cache.ts, file.ts)逻辑完全一致：mid点找换行、保留后半、写入 truncateMarker
- 默认 truncateMarker = `'[TRUNCATED] ... old records dropped\n'`
- `shouldRotate` 用 `fs.statSync` 检查大小；`rotateFile` 读全量内容截断写回
- 两个函数都 try/catch 包裹，永不抛异常
- 测试中 `rotateFile` 第二参数是 `truncateMarker` 而非 maxSize，不要混淆
### 增量项目级聚合器 (T8)
- projectAgg 模块级计数器替代 fillProjectData 中的 O(N) 全量扫描，改为 O(1) 读取
- 关键点: message.updated 是覆盖写入（overwrite），delta = 新值 - 旧值，不是 +新值
- projectAgg 在 NotificationPluginImpl 入口处重置为 0，避免跨测试/跨实例污染
- __test_resetFlags 也重置 projectAgg，双重保障测试隔离
- preload 初始化基数时遍历 tokenDataMap 中匹配 projectPath 的会话，使用 sumAllCompletedTokens
- sessionCache 补充基数时排除已在 tokenDataMap 中的 sessionId（去重）
- session.created backfill projectPath 时需回溯性将预加载数据加入 projectAgg（极端边界：旧 SQL 无 directory 列）
- message.updated 中 projectPath 从 undefined 变为有值时也需回溯性添加（sumAllCompletedTokens 全量扫描当次）
- aggregateProjectTokens 和 aggregateProjectFromCache 函数保留未删除，fillProjectData 不再调用它们
- Bun mock.module 是进程级全局的，projectAgg 模块级变量在同一个进程的所有测试间共享，必须在每个 NotificationPlugin 实例创建时重置
- 测试策略: 通过 NotificationPlugin 实例化 + 模拟事件 + 检查 payload.projectTokens/projectCost 间接验证 projectAgg
