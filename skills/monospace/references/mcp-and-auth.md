# Monospace MCP server + authentication

How to connect an agent to the Monospace MCP server, what it exposes, and how auth works across the MCP, REST, and SDK.

## Authentication model

Everything authenticates with a token. Two kinds are interchangeable on the wire:
- **API key** — create one in the Studio under **Account → Access → API Keys** (`/account/access#api-keys`); for automation it is also available as `POST /api/system/api-keys`. Best for agents. Carries its own RBAC.
- **User access token** — obtained by logging in (`POST /api/auth/providers/<name>/password/login`, commonly the `local` provider). Carries the user's RBAC.

Authenticated API requests accept exactly one credential source: `Authorization: Bearer <token>`, `access_token=<token>` query parameter, or the session cookie. For MCP, prefer the `Authorization` header; query-string tokens are a fallback only for clients that cannot set headers, because URLs may be stored in config or logs. Keep tokens out of source; use an env var (`MONOSPACE_API_KEY`) or your agent's secret store, including for URL token interpolation. Use cookies for browser sessions, not agent config.

## MCP server

- **Transport:** streamable-HTTP, stateless. JSON responses. **POST only** (GET/DELETE → 405). MCP protocol version `2025-11-25`; the server identifies as `monospace`.
- **Endpoint:** `POST https://<host>/api/<workspace>/mcp` — **per workspace**. Each workspace has its own MCP endpoint; there is no single system-wide MCP URL.
- **Authorization:** `Authorization: Bearer <token>` or, only when headers are unavailable, `access_token=<token>` query parameter (API key or user access token). The workspace must have the **`ai:mcp` entitlement** enabled. Beyond that, every tool call is checked against the token's RBAC, so the agent can only do what the key/user is allowed to do.

> This branch authenticates the MCP server with static tokens — there is no OAuth 2.1 / dynamic-client-registration handshake in the engine here. A hosted/managed Monospace may expose an OAuth flow; for a self-hosted instance, use an API key as shown.

### `.mcp.json` (Claude Code, project root)

```jsonc
{
  "mcpServers": {
    "monospace": {
      "type": "http",
      "url": "https://YOUR_HOST/api/YOUR_WORKSPACE/mcp",
      "headers": { "Authorization": "Bearer ${MONOSPACE_API_KEY}" }
    }
  }
}
```
Other agents (Cursor, etc.) use the same three facts — remote/HTTP transport, the per-workspace URL, and either the `Authorization: Bearer` header or, for URL-only clients, an `access_token` query parameter populated from a secret store — in their own MCP config format.

### Tools (7)

| Tool | Does | Permission required |
| --- | --- | --- |
| `list_items` | Query items in a collection (filter/sort/paginate) | caller's read permission |
| `create_items` | Create one or more items | caller's create permission |
| `update_item` | Update an item | caller's update permission |
| `delete_item` | Delete an item | caller's delete permission |
| `read_schema` | Inspect collections/fields/relations | `dataModel:read` |
| `read_data_sources` | List configured data sources | `dataModel:read` + `dataSource:read` |
| `mutate_schema` | Create/alter schema (can be **destructive**) | `dataModel:edit` |

Read-first workflow: use `read_schema` (and `list_items`) before `create_items` / `update_item` / `mutate_schema`, then verify with a follow-up read. Treat `mutate_schema` as destructive — confirm intent before altering or dropping schema.

### Troubleshooting

1. **Reachable?** `curl -s -o /dev/null -w "%{http_code}" -X POST https://<host>/api/<workspace>/mcp` — `401` = up but unauthenticated (expected with no token); `403` = authenticated but forbidden by RBAC or missing entitlement; `404` = wrong path; timeout/refused = unreachable or wrong host.
2. **Right URL?** It must be `/api/<workspace>/mcp` with the correct workspace slug. There is no `/api/mcp` or `/api/system/mcp`.
3. **Token valid + entitled?** Confirm either the `Authorization: Bearer` header or the `access_token` query parameter is present, but not both, and that the token is valid and the workspace has the `ai:mcp` entitlement. Tools missing entirely usually means auth/entitlement, not transport.
4. **Tool says forbidden?** The token lacks the RBAC for that tool (e.g. `read_schema` needs `dataModel:read`). Mint a key with the needed permissions.

## When to use MCP vs SDK vs REST

- **MCP** — agentic CRUD and schema work from inside a chat/coding agent, under RBAC, no codegen step. Start here for "read/change my data" tasks.
- **SDK** (`@monospace/sdk`) — application code in TypeScript; generate types first for full type safety ([sdk.md](sdk.md)).
- **REST** — other languages, scripts, or when you need raw control ([rest-api.md](rest-api.md)).
