# Monospace REST API

How to call the Monospace HTTP API directly (raw REST, or from a non-TypeScript language). For TypeScript, prefer the generated SDK — see [sdk.md](sdk.md). Verify anything not here against the live OpenAPI doc (`GET /api/<project>/openapi`).

## Base URL, projects, content type

Monospace is multi-project. Most data and schema routes are project-scoped under `/api/<project>/...`; instance-wide routes are under `/api/system/...`, and authentication routes are under `/api/auth/...`. Requests and responses are JSON (`Content-Type: application/json`).

## Auth

Auth endpoints are instance-scoped, not project-scoped:
- `POST /api/auth/providers/<name>/password/login` — authenticate with email/password for the named provider (commonly `local`); supports `session` cookie mode and `json` token-response mode.
- `POST /api/auth/refresh` — obtain a new access token from a refresh token in a cookie or request body.
- `POST /api/auth/logout` — invalidate the refresh token and clear session cookies.

Authenticated requests accept exactly one credential source: `Authorization: Bearer <token>`, `access_token=<token>` query parameter, or the session cookie. Prefer the `Authorization` header for agents/scripts; use the query parameter only for clients that cannot set headers, and use cookies for browser sessions.

The token may be a user **access token** from login or an **API key** (create one in the Studio under Account → Access → API Keys; programmatically `POST /api/system/api-keys`) — both are JWTs.

## Response envelope

Non-empty JSON responses wrap payload in `data`; delete responses return no content unless `fields` selects rows to return:
```jsonc
// GET /api/<project>/items/articles  ->
{ "data": [ { "id": "…", "title": "…" } ] }
// GET /api/<project>/items/articles/<id>  ->
{ "data": { "id": "…", "title": "…" } }
```
**Nested to-many relations are themselves enveloped** — e.g. `data.comments.data`. List responses can include a top-level `meta.totalCount` when requested with `meta=totalCount`.

## Query engine

Pass these as query params (or in the request for the SDK). Examples use bracketed query-string form.

**fields** — selection. Defaults to top-level primitives only; request relations explicitly. `fields=*` selects top-level fields; nested selection pulls relations.

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
Operators are type-gated by the engine — e.g. `_null` only applies to nullable fields, string operators only to text. Filtering a to-one relation is only allowed on nullable relations; to-many defaults to `_some` if no quantifier is given.

**sort** — object form only; `-field` shorthand is rejected:
```
sort[0][created_at][direction]=desc&sort[1][title][direction]=asc
```

**limit / offset** — `limit` default 100, `offset` default 0. `limit=0` or `limit=-1` requests unlimited (subject to the configured max). Defaults/max are configurable via `MONOSPACE_QUERY_LIMIT_DEFAULT` / `MONOSPACE_QUERY_LIMIT_MAX`. There is no `page` param and no cursor pagination — page manually with `offset = (page - 1) * limit`. Request `meta=totalCount` on list queries when you need the total matching row count.

**deep** — filter/sort/paginate a nested relation, with underscore-prefixed keys:
```
deep[comments][_filter][approved][_eq]=true&deep[comments][_limit]=5
```

**Not available yet:** `search`, aggregates / `group_by` (params parse but are ignored).

## Endpoints (project-scoped unless noted)

| Purpose | Method + path |
| --- | --- |
| List items | `GET /api/<project>/items/<collection>` |
| Read item | `GET /api/<project>/items/<collection>/<id>` |
| Create items | `POST /api/<project>/items/<collection>` (accepts one or many) |
| Update item | `PATCH /api/<project>/items/<collection>/<id>` |
| Delete item | `DELETE /api/<project>/items/<collection>/<id>` |
| OpenAPI (project) | `GET /api/<project>/openapi` |
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
