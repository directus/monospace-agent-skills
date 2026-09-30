# Monospace authentication + MCP server

Covers how credentials work, how to log in over HTTP, what an API key can do, license and permission preflights, and how to connect to and diagnose the per-workspace MCP server.

## Credentials

An authenticated request uses **exactly one** credential source:
- `Authorization: Bearer <token>`: preferred for agents, scripts, and servers.
- `access_token=<token>` query parameter: only for clients that cannot set headers (URLs end up in logs and config).
- The session cookie: for browser sessions.

Sending two sources fails. In particular, a valid bearer token **plus a stale session cookie returns 400** even though the bearer token alone works. Keep tokens in an env var (`MONOSPACE_API_KEY`) or a secret store, never in source or committed config.

Two token kinds are accepted on the wire:
- **User access token**: short-lived and paired with a refresh token, obtained by logging in.
- **API key**: a long-lived token created in the Studio under **Account → Access → API Keys**, or with `POST /api/system/api-keys` (the response's `data.key` field is the token, so store it right away).

### API key authority

An API key **acts as its subject user**, with that user's roles and policies. Nothing in the key itself scopes it: the creation input has only the user, a name, a description, and an expiry, with no per-key role or policy. So:
- Minting a new key does not give you more or less access than that user already has. To change what a key can do, change the subject's roles or policies (where the license allows it), or use a key for a different user or service account.
- Deleting a key revokes it (subsequent requests get 401).
- Treat an administrator's key as an administrator credential.

## Log in over HTTP

The SDK has no login or refresh helpers. Use the CLI (`monospace login`, see [sdk.md](sdk.md#generate-types-with-the-cli)) or these routes. The provider is usually `local`.

```bash
# Requires jq and exported MONOSPACE_EMAIL / MONOSPACE_PASSWORD.
# JSON-encode credentials; capture the token without printing it.
TOKEN="$(
  jq -n '{email: env.MONOSPACE_EMAIL, password: env.MONOSPACE_PASSWORD, mode: "json"}' |
  curl --fail-with-body -sS "https://YOUR_HOST/api/auth/providers/local/password/login" \
    -H "Content-Type: application/json" --data-binary @- |
  jq -er '.accessToken'
)"
```

- `"mode": "json"` returns a **bare** body: `{ accessToken, refreshToken, expires, requireAcceptTerms? }`. `expires` is the access-token lifetime in seconds. Read `body.accessToken`, not `body.data.accessToken`.
- Without `mode` (the default is `"session"`), the server instead sets httpOnly cookies (access cookie on `/api`, refresh cookie on `/api/auth`), and the body carries no tokens. Use this for browser apps.
- Refresh: `POST /api/auth/refresh` with `{"refreshToken":"…"}` returns a new bare token pair (JSON mode). With body `{}` it uses the refresh cookie and re-issues cookies (session mode).
- Logout: `POST /api/auth/logout` with `{"refreshToken":"…"}` (or `{}` with the refresh cookie) invalidates the refresh token and clears session cookies.
- `requireAcceptTerms: true` means the organization's terms are still pending. Surface the pending Studio onboarding step to the operator; successful login does not imply terms acceptance. API calls can still work in the meantime.

## Roles, policies, and license preflight

- Roles are flat (no inheritance). When diagnosing access, check the user's **directly assigned** roles and the policies on those roles. Suspended users cannot authenticate.
- Each workspace gets built-in **public** and **administrator** roles automatically. They cannot be updated or deleted, and the public role cannot be attached to a user.
- **Check the license before designing authorization.** The keyless Starter profile has `custom_roles: 0`, `custom_policies: 0`, `service_accounts: 0`, and `workspaces: 1`. Creating a custom role, policy, service account, or a second workspace returns 402 (see [bootstrap-and-schema.md](bootstrap-and-schema.md#1-preflight-the-instance)). On Starter, per-customer or per-tenant access control cannot be built from custom roles and policies. Say so and offer alternatives, such as a server-side backend that enforces tenant scoping, or a plan upgrade.
- Filtering results only in browser code while authenticated as an administrator **is not tenant isolation**. Do not present it as such, and do not ship admin or API-key credentials to browsers.

## MCP server

- **Endpoint:** `POST https://<host>/api/<workspace>/mcp`, one per workspace. There is no `/api/mcp` or `/api/system/mcp`.
- **Transport:** stateless streamable HTTP, POST only (GET → 405). Protocol version `2025-11-25`. The server name is `monospace`.
- **Auth:** a bearer token (API key or user access token). There is no OAuth / dynamic client registration. The caller also needs the **`ai:mcp`** entitlement through their roles or policies. The administrator used in testing had it. Anonymous requests get **403** by default, because the default public role does not grant `ai:mcp`. Anonymous MCP access happens only if someone explicitly grants `ai:mcp` to the public role, so don't assume it or recommend it by default.
- **Authorization per call:** every tool call is checked against the caller's permissions. `tools/list` shows all seven tools to any caller with `ai:mcp`. **A listed tool does not mean the caller may run it.** Expect a permission error from the call itself.

### Config

`.mcp.json` (Claude Code, project root):
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
Codex (`~/.codex/config.toml`):
```toml
[mcp_servers.monospace]
url = "https://YOUR_HOST/api/YOUR_WORKSPACE/mcp"
bearer_token_env_var = "MONOSPACE_API_KEY"
```
Other clients need the same three facts: HTTP transport, the per-workspace URL, and a bearer header. Clients that only accept a URL can use `?access_token=`, filled in from a secret store.

### Tools (7)

| Tool | Does | Needs (besides `ai:mcp`) |
| --- | --- | --- |
| `list_items` | query items (filter/sort/paginate) | read permission on the collection |
| `create_items` | create one or more items | create permission |
| `update_item` | update an item | update permission |
| `delete_item` | delete an item | delete permission |
| `read_schema` | inspect collections, fields, relations | `dataModel:read` |
| `read_data_sources` | list data sources | `dataModel:read` + `dataSource:read` |
| `mutate_schema` | create or alter schema (can be **destructive**) | `dataModel:edit` |

Work read-first: call `read_schema` and `list_items` before any create, update, or `mutate_schema`, then verify with a follow-up read. Apply schema changes within the user's authorized scope; clarify destructive effects outside that scope before proceeding.

**`list_items` limits:** it takes `collection`, a required scalar `fields` array, and optional `filter`, `sort`, `limit`, `offset`. It has no `include` and no `meta`, so use SDK or REST for related rows or total counts. Use the object sort form even if a tool description suggests `-field`:
```json
{ "collection": "Articles", "fields": ["id", "title"], "filter": { "status": { "_eq": "published" } },
  "sort": [{ "created_at": { "direction": "desc" } }], "limit": 20 }
```

### Diagnose with a real initialize request

A bare `curl -X POST …/mcp` cannot tell reachability, authentication, and protocol errors apart. Send a proper initialize request:

```bash
curl -sS -i -X POST "https://YOUR_HOST/api/YOUR_WORKSPACE/mcp" \
  -H "Authorization: Bearer $MONOSPACE_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"diag","version":"1"}}}'
```

Then send `{"jsonrpc":"2.0","id":2,"method":"tools/list"}` with the same headers. The server is stateless, so no session header is needed.

| Result | Meaning / fix |
| --- | --- |
| 200 with `result.protocolVersion` | transport and initialization work; diagnose each subsequent tool result separately |
| 401 `Invalid token` | token malformed, expired, or revoked |
| 403 (message names `ai:mcp`) | no credential sent, or the subject lacks the `ai:mcp` entitlement |
| 200 with `result.isError: true` | tool execution failed; inspect `result.content` for permission, query, or schema errors. A new key for the same user cannot change its permissions |
| 405 | used GET/DELETE; use POST |
| 406 | `Accept` missing or incomplete. It must list both `application/json` and `text/event-stream` |
| 415 | `Content-Type: application/json` missing |
| 404, timeout, refused | wrong host, path, or workspace slug, or unreachable |

Read HTTP error bodies, JSON-RPC `error`, and tool `result.isError` / `result.content`. An HTTP 200 alone does not prove the operation succeeded.

## When to use MCP vs SDK vs REST

- **MCP**: agentic CRUD and schema work inside a chat or coding agent, no codegen step.
- **SDK** (`@monospace/sdk`): TypeScript application code. Generate types first ([sdk.md](sdk.md)).
- **REST**: other languages, scripts, bootstrap and management routes ([rest-api.md](rest-api.md), [bootstrap-and-schema.md](bootstrap-and-schema.md)).
