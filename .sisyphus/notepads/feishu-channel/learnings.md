# Feishu Channel - Learnings

## 签名算法关键差异
- 飞书: HMAC-SHA256(key = timestamp + "\n" + secret, message = "")
- 钉钉: HMAC-SHA256(key = secret, message = timestamp + "\n" + secret)
- 飞书 timestamp 单位: 秒 (Math.floor(Date.now() / 1000))
- 钉钉 timestamp 单位: 毫秒 (Date.now())
- 飞书签名放在 JSON body 中 (timestamp + sign 字段)
- 钉钉签名放在 URL 参数中 (?timestamp=xxx&sign=xxx)

## API 响应差异
- 飞书: {"code": 0, "msg": "success"}
- 钉钉: {"errcode": 0, "errmsg": "ok"}

## 消息格式
- 飞书使用 interactive 卡片 (msg_type: "interactive")
- 飞书 lark_md 是标准 Markdown 子集，不需要钉钉的 17 字符转义

## F2 质量审计结果 (2026-04-09)

- VERDICT: APPROVE
- 8 文件全部通过，0 CRITICAL/WARNING 问题
- 2 个 INFO 级别陈旧注释 (types.ts:52, config.ts:184)，非本次变更引入
- 测试: 28 feishu tests pass, 60 assertions
- 反模式扫描: 0 as any, 0 @ts-ignore, 0 console.log in feishu code
- ESLint 不可用 (项目缺少 eslint.config.js，pre-existing)
- updater.test.ts 5 fail (pre-existing, fs.mkdirSync mock issue)
