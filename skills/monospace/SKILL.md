---
name: monospace
description: "Use when doing ANY task against a Monospace instance. Triggers: reading, creating, updating, deleting, querying, filtering, sorting, or paginating data via the Monospace REST API or the @monospace/sdk (createClient, readMany, createOne, updateOne); generating a typed SDK client (`monospace-sdk generate`, monospace.config.ts); connecting to or using the Monospace MCP server; minting API keys or authenticating; inspecting collections, fields, relations, or schema. Do NOT use for legacy Directus v9 / @directus/sdk — Monospace is a different product with a different API and SDK."
metadata:
  author: monospace
  version: "0.1.0"
---

# Monospace

Drive a Monospace instance from an agent: query and mutate data via the REST API or the typed SDK, generate instance-correct types, and use the MCP server. This page is a router — read the principles and the inline traps, then load the reference for the task.

## Core principles

**1. You almost certainly don't know this API. Don't guess — use the ground truth.**
Monospace is not in most training data, so do not invent endpoints, SDK methods, or types from memory. The SDK is `@monospace/sdk` (`createClient` + per-collection delegates). Get the real shape from generated types (`monospace-sdk generate`) or the live OpenAPI doc (`GET /api/<project>/openapi`), plus the references below. (If you happen to know Directus: it is a different product — don't assume its APIs carry over.)

**2. Generate types, then write against them.**
The most reliable way to get the data shape right is to generate a typed client from the running instance: `monospace-sdk generate` reads the live OpenAPI document and emits a typed client matching *that instance's* schema. Prefer generated types over hand-written shapes. See [references/sdk.md](references/sdk.md).

**3. Verify against current docs / OpenAPI before implementing.**
For anything not covered here, fetch the canonical OpenAPI doc (`GET /api/<project>/openapi`, or `/api/system/openapi`) or the Monospace docs. The OpenAPI doc is generated from the live schema, so it is always correct for the instance.

**4. Inspect before you mutate, then verify.**
Read the schema / list items (read-only) before writing. After a write, read it back to confirm. A change without verification is incomplete.

**5. Recover, don't loop.**
If an approach fails 2-3 times, stop and reconsider — check the error body (it carries a `message`), the schema, and permissions. Retrying the same call rarely fixes it.

## Critical traps (read before writing any data code)

These are verified, easy-to-miss behaviors. Getting them wrong fails silently.

- **Responses are enveloped as `{ "data": ... }`.** A list returns `{ data: [...] }`, a single item `{ data: {...} }`. The SDK strips the *top-level* envelope for you, but **nested to-many relations stay enveloped** — relation data sits under `relation.data`, and the SDK does NOT unwrap it. Reach into `item.<relation>.data` (to-one relations are accessed directly).
- **Methods take a single options object, not positional args.** `readOne`/`updateOne`/`deleteOne` take `{ key, ... }`; `createOne({ data: <object>, fields })` (single object under `data`); `createMany` takes `{ data, fields }`; `updateMany` takes `{ filter, data, fields }`; `deleteMany` takes `{ filter }`. There is no `readOne(id)` form. Collections are cased as named (`client.Articles`, not `client.articles`).
- **Deletes return no content.** `deleteOne({ key })` / `deleteMany({ filter })`; do not require `fields`, and do not return selected deleted rows.
- **`fields` defaults to top-level primitives only.** Relations are not returned unless you select them. The SDK sends `fields: ['*']` by default (top-level), so request nested fields explicitly to get relations.
- **Filter operators are underscore-prefixed.** `_eq _neq _lt _lte _gt _gte _in _nin _between _nbetween _contains _icontains _ncontains _nicontains _starts_with _nstarts_with _ends_with _nends_with _null`; combine with `_and _or _not`; for to-many relations use quantifiers `_some _every _none`. `_null` is only valid on nullable fields. Full table in [references/rest-api.md](references/rest-api.md).
- **Sort uses the object form, not `-field`.** Use `sort: [{ <field>: { direction: 'asc' | 'desc' } }]`. The `-created_at` shorthand is rejected by the engine.
- **No `search` param, no `page`/cursor pagination, no aggregates yet.** Paginate with `limit` (default 100) + `offset`; request `meta=totalCount` when you need the total matching row count. Aggregate/group params parse but are silently ignored today.

## Connect to a Monospace instance

You need three things: the **host** (engine base URL), the **project** slug (Monospace is multi-project; most data routes are `/api/<project>/...`), and a **token**. Create an API key in the Studio under **Account → Access → API Keys** (`/account/access#api-keys`), or use a user access token — both are JWTs and travel as `Authorization: Bearer <token>`. (For automation, the key endpoint is `POST /api/system/api-keys`.)

Two ways an agent works with the data:
- **MCP server** — best for agentic CRUD + schema work inside a chat/coding agent. Set it up below.
- **SDK / REST** — best for writing application code. See [references/sdk.md](references/sdk.md) and [references/rest-api.md](references/rest-api.md).

## MCP server setup (recommended for agentic work)

The Monospace MCP server is served by the engine, **per project**, over streamable-HTTP.

- **Endpoint:** `POST https://<host>/api/<project>/mcp` (per-project; POST only; protocol `2025-11-25`).
- **Auth:** Bearer JWT only (API key or user access token). Session cookies are ignored. The project needs the `ai:mcp` entitlement, and each tool runs under the token's RBAC.

Config (`.mcp.json` at the project root):
```jsonc
{
  "mcpServers": {
    "monospace": {
      "type": "http",
      "url": "https://YOUR_HOST/api/YOUR_PROJECT/mcp",
      "headers": { "Authorization": "Bearer ${MONOSPACE_API_KEY}" }
    }
  }
}
```

**Tools exposed (7):** `list_items`, `create_items`, `update_item`, `delete_item` (CRUD under the caller's permissions), `read_schema` (needs `dataModel:read`), `read_data_sources` (`dataModel:read` + `dataSource:read`), and `mutate_schema` (`dataModel:edit` — can be destructive).

**Troubleshooting:** `curl -s -o /dev/null -w "%{http_code}" -X POST https://<host>/api/<project>/mcp` — a `401` means it's up but unauthenticated (expected without a token); a hang or refusal means it's unreachable. If tools aren't visible: confirm the URL includes the right `<project>`, the `Authorization` header carries a valid Bearer token, and the project has `ai:mcp` enabled. Full details + RBAC and the per-tool input schemas: [references/mcp-and-auth.md](references/mcp-and-auth.md).

## Generate a typed SDK client (codegen)

```bash
npx @monospace/sdk init       # scaffold monospace.config.ts (output defaults to ./src/generated/monospace)
npx @monospace/sdk login      # store credentials in the OS keyring (or set MONOSPACE_API_KEY)
npx @monospace/sdk generate   # fetch the live OpenAPI and emit <output>/index.ts
```
The generated `index.ts` exports a `createClient` bound to your instance's schema — import it from your generated output (default `./src/generated/monospace`; match your project's path/alias), not from `@monospace/sdk`, for fully-typed queries. Remote mode fetches `GET /api/<project>/openapi` (auth required); local mode reads a saved OpenAPI JSON via `input`. Details, flags, and a zero-to-typed-client sequence: [references/sdk.md](references/sdk.md).

## Reference guides

| Topic | Reference | Load when |
| --- | --- | --- |
| Query engine, envelope, endpoints, error shapes, raw REST | [references/rest-api.md](references/rest-api.md) | Calling the API directly, or in a non-TS language |
| `createClient`, typed delegates, codegen workflow, error classes | [references/sdk.md](references/sdk.md) | Writing TypeScript against the SDK or generating types |
| CRUD recipes with the traps annotated | [references/data-workflows.md](references/data-workflows.md) | Reading/writing data and you want a known-good pattern |
| MCP tools + schemas, API keys, auth modes, `.mcp.json` | [references/mcp-and-auth.md](references/mcp-and-auth.md) | Setting up MCP, authenticating, or choosing/using a tool |
