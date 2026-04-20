# Decisions

## Architecture
- customVariables in NotificationConfig top-level (all channels shared)
- System variables built in handler.ts variables map (NOT in EventPayload)
- Static vars cached in createEventHandler closure (collected once)
- Dynamic vars (localIP, systemUptime, processPid) per-event
- opencodeVersion passed via config injection from index.ts

## Merge Strategy
- customVariables: `{ ...global, ...project }` (project overrides same-name)
- Variable name validation: key must match /^\w+$/, value must be string
- Custom vars can override built-in vars (allowed)

## Limits
- Custom vars: static values only, no env var expansion
- Nesting: single-layer only (custom refs built-in, not other custom)
- localIP: first non-internal IPv4, skip virtual NIC prefixes
