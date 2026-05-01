## Issues

### 2026-05-01 Final Wave: 审查发现的轻微偏差

1. **db-preload.ts 顶层 import 未移除** (T4)
   - 计划要求移除 `import { Database } from 'bun:sqlite'` 改为函数内动态导入
   - 实际做法：整个 db-preload.js 通过 `setTimeout(() => import('./db-preload.js'), 0)` 延迟加载
   - 结果：功能等价，bun:sqlite 不再阻塞启动。alternative approach is arguably better
   - 风险：低。不影响功能

2. **T4/T5 缺少独立测试文件**
   - `tests/index-preload.test.ts` 和 `tests/session-cache-lazy.test.ts` 未创建
   - 延迟加载行为由 `tests/incremental-agg.test.ts` 间接覆盖
   - 风险：低。核心功能有测试保护

3. **package.json 版本号被意外修改**
   - 0.1.54 -> 0.1.55，不属于任何任务规范
   - 需提交前确认是否需要还原

4. **71 个预存测试失败** (联合运行 mock 隔离问题)
   - config/dingtalk/email/feishu/file/recorder/updater 测试联合运行时因 mock.module() 全局污染导致失败
   - 单独运行全部通过
   - 非本次优化引入，是原有问题
