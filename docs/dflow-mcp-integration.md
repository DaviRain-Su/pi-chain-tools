# DFlow MCP Integration

## Endpoint
- `https://pond.dflow.net/mcp`

## Included config
- Repo root: `.mcp.json`
- Server alias: `DFlow`

## Quick checks

### With mcporter
```bash
mcporter call https://pond.dflow.net/mcp.fetch query="order API"
```

### With named server config
```bash
mcporter call DFlow.fetch query="metadata api"
```

## Notes
- This MCP integration is documentation/API-context access for AI tooling.
- It does not bypass project execute guardrails.
