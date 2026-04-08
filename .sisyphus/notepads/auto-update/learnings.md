# Auto-Update Learnings

## [2026-04-08] Planning Phase
- oh-my-openagent uses `https://registry.npmjs.org/-/package/{name}/dist-tags` for lightweight version check
- bun install is the update mechanism (not npm)
- Cache dir: `$OPENCODE_DATA_DIR` or `~/.local/share/opencode/`
- Windows: child_process.spawn with windowsHide:true + shell:true
- Toast API: ctx.client.tui.showToast() with .catch(() => {}) fallback
