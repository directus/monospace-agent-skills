# Monospace REST API

How to call the Monospace HTTP API directly (raw REST, or from a non-TypeScript language). For TypeScript, prefer the generated SDK — see [sdk.md](sdk.md). Verify anything not here against the live OpenAPI doc (`GET /api/<workspace>/openapi`).

## Base URL, workspaces, content type

Monospace is multi-workspace. Most data and schema routes are workspace-scoped under `/api/<workspace>/...`; instance-wide routes are under `/api/system/...`, and authentication routes are under `/api/auth/...`. Requests and responses are JSON (`Content-Type: application/json`).

## Auth

Auth endpoints are instance-scoped, not workspace-scoped:
- `POST /api/auth/providers/<name>/password/login` — authenticate with email/password for the named provider (commonly `local`); supports `session` cookie mode and `json` token-response mode.
- `POST /api/auth/refresh` — obtain a new access token from a refresh token in a cookie or request body.
- `POST /api/auth/logout` — invalidate the refresh token and clear session cookies.

Authenticated requests accept exactly one credential source: `Authorization: Bearer <token>`, `access_token=<token>` query parameter, or the session cookie. Prefer the `Authorization` header for agents/scripts; use the query parameter only for clients that cannot set headers, and use cookies for browser sessions.

The token may be a user **access token** from login or an **API key** (create one in the Studio under Account → Access → API Keys; programmatically `POST /api/system/api-keys`) — both are JWTs.

## Response envelope

Non-empty JSON responses wrap payload in `data`; delete responses return no content unless `fields` or `include` selects rows to return:
```jsonc
// GET /api/<workspace>/items/articles  ->
{ "data": [ { "id": "…", "title": "…" } ] }
// GET /api/<workspace>/items/articles/<id>  ->
{ "data": { "id": "…", "title": "…" } }
```
**Nested to-many relations are themselves enveloped** — e.g. `data.comments.data`. List responses can include a top-level `meta.totalCount` when requested with `meta=totalCount`.

## Query engine

Pass these as query params (or in the request for the SDK). Examples use bracketed query-string form.

**fields** — scalar selection at the current level. Send `fields=id,title` (or
`fields[0]=id&fields[1]=title`) for explicit selection, or `fields=*` for all scalars.
For creates and updates this selects the response, not the input payload. Relations
are never included in `*`; select them with `include`. The SDK supplies `['*']` when
`fields` is omitted; use explicit selections in raw REST requests.

Dots in `fields` are literal characters, not relation paths. Use `include` for
relations; nested objects in `fields` and the `deep` parameter are unsupported.

**include** — recursive relation queries. Each relation has its own `fields`, nested
`include`, and supported `filter`/`sort`/`limit`/`offset` arguments, without underscore
prefixes on argument names:
```
fields=id,title&include[author][fields]=name
include[comments][fields]=id,body&include[comments][filter][approved][_eq]=true&include[comments][limit]=5
include[comments][include][author][fields]=name
```
Combine these parameters on one request as needed. An included relation is selected
without also naming it in `fields`. To-many relations support filtering, sorting,
and pagination; nullable to-one relations support filtering; required to-one relations
do not support filtering. Nested limits apply per parent. A nested filter narrows
the returned relation; a top-level relation filter narrows the parent results.

**Aliases** — `responseName:sourceField` in scalar selections and include keys:
```
fields=id,headline:title&include[writer:author][fields]=name
```
This returns `headline` and `writer`. Alias the same relation twice to request two
different filtered or paginated views. With `*`, an explicit scalar alias replaces
the source name unless you also select that source name explicitly.

**filter** — underscore-prefixed operators:

| Group | Operators |
| --- | --- |
| Equality / compare | `_eq` `_neq` `_lt` `_lte` `_gt` `_gte` |
| Sets / ranges | `_in` `_nin` `_between` `_nbetween` |
| String | `_contains` `_icontains` `_ncontains` `_nicontains` `_starts_with` `_nstarts_with` `_ends_with` `_nends_with` |
| Null | `_null` (nullable fields only) |
| Logical | `_and` `_or` `_not` |
| To-many relation quantifiers | `_some` `_every` `_none` |

```
filter[status][_eq]=published
filter[_and][0][views][_gte]=100&filter[_and][1][title][_icontains]=monospace
filter[comments][_some][approved][_eq]=true
```
Operators depend on both type and field capabilities — e.g. `_null` only applies to nullable fields, string operators only to text, and a connector may restrict filtering or particular operators. Sorting and write operations are also capability-gated. Inspect the live OpenAPI/generated types instead of assuming every field supports the full table. Filtering a to-one relation is only allowed on nullable relations; to-many defaults to `_some` if no quantifier is given.

**sort** — use the explicit object form; `-field` shorthand is rejected:
```
sort[0][created_at][direction]=desc&sort[1][title][direction]=asc
```

**limit / offset** — `limit` default 100, `offset` default 0. `limit=0` or `limit=-1` requests unlimited (subject to the configured max). Defaults/max are configurable via `MONOSPACE_QUERY_LIMIT_DEFAULT` / `MONOSPACE_QUERY_LIMIT_MAX`. There is no `page` param and no cursor pagination — page manually with `offset = (page - 1) * limit`. Request `meta=totalCount` on list queries when you need the total matching row count.

**Not available:** `search`, aggregates / `group_by`, and the GraphQL router. Use REST or the SDK.

## Endpoints (workspace-scoped unless noted)

| Purpose | Method + path |
| --- | --- |
| List items | `GET /api/<workspace>/items/<collection>` |
| Read item | `GET /api/<workspace>/items/<collection>/<id>` |
| Create items | `POST /api/<workspace>/items/<collection>` (accepts one or many) |
| Update item | `PATCH /api/<workspace>/items/<collection>/<id>` |
| Delete item | `DELETE /api/<workspace>/items/<collection>/<id>` |
| OpenAPI (workspace) | `GET /api/<workspace>/openapi` |
| OpenAPI (system) | `GET /api/system/openapi` |
| Create API key (or use Studio → Account → Access) | `POST /api/system/api-keys` |
| Password login | `POST /api/auth/providers/<name>/password/login` |
| Refresh token | `POST /api/auth/refresh` |
| Logout | `POST /api/auth/logout` |

The engine exposes additional admin/schema/data-source/AI/audit endpoints beyond this core set; the OpenAPI doc is the authoritative, complete list for a given instance. Always check it for the exact route and payload of anything not above.

## Errors

Error responses are JSON: `{ "message": string, "code"?: string, "meta"?: object, "source"?: <nested error> }`. The HTTP status carries the category (401 unauthenticated, 403 forbidden, 404 not found, 4xx validation). Read `message` for the human-readable cause; `code` (when present) is the stable machine code.

## OpenAPI 3.1

The spec is generated dynamically from the live schema (so it always matches the instance) and carries a custom `x-monospace-mappings` extension that the SDK type generator consumes. Fetch it to confirm exact shapes, or feed it to `npx @monospace/sdk generate` (see [sdk.md](sdk.md)).
