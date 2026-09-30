---
name: monospace
description: "Use for Monospace REST or @monospace/sdk data access, @monospace/cli codegen, workspace and schema setup, authentication and permissions, or MCP configuration and troubleshooting. Not for legacy Directus or @directus/sdk."
metadata:
  author: monospace
---

# Monospace

Work with a Monospace instance: query and mutate data through the REST API or the typed SDK, generate instance-specific types, bootstrap workspaces and discover schema, and use the per-workspace MCP server. Read the traps below, then load the reference that matches the task.

*Verified against engine source `4f6f48c` (reports `0.7.0`) with `@monospace/sdk` `0.8.0` and `@monospace/cli` `0.1.0` from continuous build `31d52d0`. Monospace is in early access. If an instance behaves differently, trust the instance and its error messages.*

## Principles

1. **Don't guess the API.** Monospace has a different API and SDK from Directus. The sources of truth are the types generated from the instance (`monospace sdk generate`), the instance's own responses and error messages, and these references. The workspace **OpenAPI document describes item routes** (use it for payload shapes and codegen). It is **not a complete or fully correct catalog** of management and schema routes, so use [bootstrap-and-schema.md](references/bootstrap-and-schema.md) for those.
2. **Generate types, then write against them.** Examples here use illustrative collection and field names, so adapt names and types to the generated schema.
3. **Inspect, write, verify.** Read the schema and existing rows before writing. Send an explicit `fields` selection on item reads and writes. Afterwards, read back using the same key or the user's exact filter.
4. **Recover, don't loop.** Read the error body, including its nested `source` chain. After 2–3 failed attempts, re-check the schema, permissions, and license instead of retrying.

## Critical traps

- **Envelopes depend on the endpoint.** Item and most management responses are `{ data }` (plus `meta` when requested). JSON login, `/api/system/info`, the `/schema` manifest, and OpenAPI are **bare**. A raw item `POST` returns a `data` **array** even for one object. The SDK unwraps only the top level. **Nested to-many relations stay `relation.data`**, and to-one relations are direct.
- **Deletes need a selection.** Use `deleteOne({ key, fields: ['id'] })` / `deleteMany({ filter, fields: ['id'] })` / `DELETE …?fields=id`. Without one, the engine returns **422 and the row remains**. Confirm with a read-back.
- **SDK call shape:** `method(parameters, options?)`. The first argument is an object (`{ key, data, fields, include, filter, sort, limit, offset, meta }`), never a positional id. The optional second argument is `{ unwrapEnvelope: false }`, needed to keep `meta.totalCount`. Collections are cased as named (`client.Articles`).
- **`fields` selects scalars, `include` selects relations.** Example: `fields: ['id'], include: { author: { fields: ['name'] } }`. Don't use dotted paths, nested objects in `fields`, or `deep`. Inside `include`, arguments are `filter`/`sort`/`limit`/`offset` (no underscore), and operators keep underscores (`_eq`).
- **Filters** use underscore operators (`_eq`, `_in`, `_null`), combined with `_and`/`_or`/`_not`, and `_some`/`_every`/`_none` on to-many relations. The full [operator table](references/rest-api.md#query-engine) is in the REST reference. `_null` works only on nullable fields. Field and connector capabilities decide what is filterable, sortable, and writable.
- **Sort uses the object form** `sort: [{ field: { direction: 'desc' } }]`. `-field` is rejected.
- **No `search`, no `page` or cursor, no aggregates.** Use `limit` (default 100) + `offset` + a stable sort, and `meta` for `totalCount`. **Unknown parameters can be silently ignored with a 200**, so a success status doesn't prove a parameter was applied.
- **64-bit integers are strings on output.** Input accepts `string | number`, but values outside the safe integer range can round before transmission, so pass large integers as strings. Decimals are strings too. Don't convert money through floats.
- **Built-in SDK transport errors:** only 401 (`MonospaceAuthError`) and 403 (`MonospacePermissionError`) get subclasses. Validation failures (400/422), 402 license limits, and 404s arrive as base `MonospaceError`, so branch on `.status`. `MonospaceValidationError` is not currently thrown.
- **One credential per request.** A bearer token plus a stale session cookie returns 400. **API keys act as their subject user**, with no per-key scope. Creating another key for the same user doesn't change what it can do.
- **Check the license before designing access control.** The keyless Starter profile allows 0 custom roles, 0 custom policies, 0 service accounts, and 1 workspace (402 otherwise). Client-side filtering with administrator credentials is not tenant isolation.

## Connect

You need the **host**, the **workspace** (its `apiName`, used as the URL segment in `/api/<workspace>/...`), and a **token**: an API key (Studio → Account → Access → API Keys) or a user access token from login. Use `Authorization: Bearer <token>`. If login returns `requireAcceptTerms: true`, surface the pending Studio onboarding step to the operator; successful API calls do not imply terms acceptance. Details: [mcp-and-auth.md](references/mcp-and-auth.md).

## MCP server (agentic CRUD and schema work)

`POST https://<host>/api/<workspace>/mcp`: per workspace, stateless streamable HTTP, protocol `2025-11-25`. The caller needs the `ai:mcp` entitlement, and anonymous access is 403 unless the public role was explicitly granted it.

```jsonc
// .mcp.json
{ "mcpServers": { "monospace": { "type": "http",
  "url": "https://YOUR_HOST/api/YOUR_WORKSPACE/mcp",
  "headers": { "Authorization": "Bearer ${MONOSPACE_API_KEY}" } } } }
```

Seven tools: `list_items`, `create_items`, `update_item`, `delete_item`, `read_schema`, `read_data_sources`, `mutate_schema` (can be destructive). **A tool being listed doesn't mean the caller may run it.** Each call is checked against the subject's permissions. To diagnose, send a real `initialize` request with `Content-Type: application/json` and `Accept: application/json, text/event-stream`, not a bare POST: [mcp-and-auth.md](references/mcp-and-auth.md#diagnose-with-a-real-initialize-request).

## Generate a typed client

```bash
# For a new project; keep existing compatible pins in an established project.
npm install https://pkg.pr.new/directus/monospace/@monospace/sdk@31d52d0
npm install --save-dev https://pkg.pr.new/directus/monospace/@monospace/cli@31d52d0
npx monospace sdk init --url https://YOUR_HOST --workspace YOUR_WORKSPACE --dir ./src/generated/monospace
npx monospace login --url https://YOUR_HOST        # or set MONOSPACE_API_KEY
npx monospace sdk generate                          # writes <output>/index.ts
```
Import `createClient` from the generated output, not from `@monospace/sdk`. The old `npx @monospace/sdk …` commands no longer work. The engine, SDK, and CLI have independent version numbers. Tested pins, config, and flags: [sdk.md](references/sdk.md).

## References

| Load when | Reference |
| --- | --- |
| Writing TypeScript: install and pin packages, CLI codegen, `createClient`, browser auth, pagination with a total, types, errors | [references/sdk.md](references/sdk.md) |
| Reading or writing data: CRUD, relation writes (`_connect`/`_create`), deletes, money, read-back verification | [references/data-workflows.md](references/data-workflows.md) |
| Calling HTTP directly: query parameters, envelopes by endpoint, value encoding, item routes, status codes | [references/rest-api.md](references/rest-api.md) |
| Starting from scratch: instance info, license, workspaces, schema discovery, bundled `scripts/schema-view.mjs` decoder, migrations | [references/bootstrap-and-schema.md](references/bootstrap-and-schema.md) |
| Logging in, API-key authority, roles and license preflight, MCP setup, tools, and diagnostics | [references/mcp-and-auth.md](references/mcp-and-auth.md) |
