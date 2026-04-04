# F4 Scope Fidelity Check - Issues Log

## Date: 2026-04-04

### Issue #1: config.ts timezone 透传缺失 (Severity: Medium)

**Location**: `src/config.ts:180-182`

**Description**: `loadConfig()` 返回值仅包含 `{ channels: enabledChannels }`，缺少 `timezone` 字段透传。即使配置文件中设置了 `timezone: "Asia/Shanghai"`，该字段也不会传递到 `NotificationPlugin` 中。

**Impact**: `config.timezone` 始终为 `undefined`，`formatTimestamp()` 永远走向后兼容分支（返回原始 ISO 字符串），时区功能无法生效。

**Recommended Fix**: 在 `loadConfig()` 返回值中添加 timezone 合并逻辑：
```typescript
return {
    channels: enabledChannels,
    timezone: globalConfig?.timezone ?? projectConfig?.timezone,
};
```

**Note**: 此问题不属于 Tasks 1-4 的 spec vs actual 偏差（各 Task 的独立实现均正确），属于集成层缺陷。建议在 Task 5 或后续修复时处理。
