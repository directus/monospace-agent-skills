# Monospace REST API

Covers calling the HTTP API directly (raw REST, or a language other than TypeScript). For TypeScript, prefer the generated SDK ([sdk.md](sdk.md)). Login and credentials are in [mcp-and-auth.md](mcp-and-auth.md). Workspace, schema, and license routes are in [bootstrap-and-schema.md](bootstrap-and-schema.md).

## Route families

| Prefix | Scope |
| --- | --- |
| `/api/<workspace>/items/<collection>` | item data (the query engine below) |
| `/api/<workspace>/schema…`, `/api/<workspace>/openapi`, `/api/<workspace>/mcp` | workspace schema, OpenAPI, MCP |
| `/api/system/…` | instance-wide: workspaces, users, API keys, license, info |
| `/api/auth/…` | login, refresh, logout |

Request bodies are JSON (`Content-Type: application/json`).

## Response envelopes depend on the endpoint

| Endpoint | Response shape |
| --- | --- |
| Item list, read, create, update, delete-with-selection | `{ "data": … }`, plus `meta` when requested |
| Item create (`POST /items/<collection>`) | `{ "data": [ … ] }`: **always an array**, even when the body was one object |
| Management lists/reads (`/api/system/workspaces`, `/api/system/api-keys`, schema structure routes, …) | `{ "data": … }` |
| Workspace create | `{ "data": { "id": "…" } }` |
| JSON-mode login / refresh | **bare** `{ accessToken, refreshToken, expires, requireAcceptTerms? }` |
| `/api/system/info`, `/api/<ws>/schema` manifest, OpenAPI documents | **bare** objects |
| Errors | bare `{ message, code?, meta?, source? }` |

Nested to-many relations inside item data are enveloped too: `data.comments.data`. To-one relations are plain objects or `null`.

## Query engine

These are query parameters on item routes. Examples use bracketed query-string form.

**fields** selects scalars at the current level: `fields=id,title` (or `fields[]=id&fields[]=title`), or `fields=*` for all scalars. On creates and updates it selects what comes back, not the input. Relations are never part of `*`; select them with `include`. Dots in `fields` are literal characters, not relation paths. Nested objects in `fields` and the `deep` parameter are unsupported. **Send explicit `fields` on raw item reads and writes.** The engine rejects some requests without a selection (deletes, schema structure routes) with 422.

**include** runs recursive relation queries. Each relation takes its own `fields`, nested `include`, and supported `filter`/`sort`/`limit`/`offset`. Argument names have no underscore prefix:
```
fields=id,title&include[author][fields]=name
include[comments][fields]=id,body&include[comments][filter][approved][_eq]=true&include[comments][limit]=5
include[comments][include][author][fields]=name
```
An included relation does not also need to be named in `fields`. To-many relations support filter, sort, and pagination. Nullable to-one relations support filter. Required to-one relations support selection only. Nested limits apply per parent. A nested filter narrows the returned related rows, while a top-level relation filter narrows the parents.

**Aliases** use `responseName:sourceField` in scalar selections and include keys:
```
fields=id,headline:title&include[writer:author][fields]=name
```
This returns `headline` and `writer`. Alias one relation twice to get two differently filtered or paginated views. With `*`, an explicit scalar alias replaces the source name unless you also select the source name.

**filter** uses underscore-prefixed operators:

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
Which operators work depends on the field's type and capabilities, and the connector can restrict filtering, sorting, and writes further. Check generated types or OpenAPI instead of assuming every field supports the whole table. A to-many filter with no quantifier defaults to `_some`. Only nullable to-one relations can be filtered.

*JSON fields on raw REST:* an `_eq` object filter written in bracket form (`filter[payload][_eq][site]=east`) matched string-valued keys. The audited engine did not match numeric JSON values through bracket or JSON-literal query encodings. This was only tested on raw REST query strings. If you need exact numeric JSON matching there, verify it against the instance first.

**sort** takes the explicit object form. `-field` is rejected:
```
sort[0][created_at][direction]=desc&sort[1][title][direction]=asc
```
A bare `sort[]=title` means ascending.

**limit / offset / meta**: `limit` defaults to 100 and `offset` to 0. `limit=0` or `limit=-1` means unlimited, up to the configured maximum (`MONOSPACE_QUERY_LIMIT_DEFAULT` / `MONOSPACE_QUERY_LIMIT_MAX`). There is no `page` parameter and no cursor: use `offset = (page - 1) * limit` with a stable sort. Add `meta=totalCount` to get `meta.totalCount`, the total number of matching rows.

**Not available:** `search`, aggregates / `group_by`, GraphQL. **Unknown query parameters can be silently ignored.** For example, `aggregate[count]=*` returned 200 with ordinary rows and no aggregate, so a 200 does not prove a parameter was honored.

## Value encoding

- **64-bit integers** (`int64`, `uint64`) come back as **decimal strings** (`"9007199254740993"`). 32-bit integers stay JSON numbers. Inputs accept a string or a number, but values outside the safe integer range can round before transmission, so send large integers as strings.
- **Decimals** come back as strings (for example `"0.1"`); trailing zeros need not be preserved. Format display amounts separately. Keep money as decimal strings or integer minor units (cents in an `int64` field). Never round-trip through floats.
- What a type can do depends on the connector. For example, the tested PostgreSQL source rejected creating `uint64` fields.

## Item endpoints (workspace-scoped)

| Purpose | Method + path | Body |
| --- | --- | --- |
| List | `GET /api/<ws>/items/<collection>` | none |
| Read one | `GET /api/<ws>/items/<collection>/<key>` | none |
| Create | `POST /api/<ws>/items/<collection>` | object or array; the response is always a `data` array |
| Update one | `PATCH /api/<ws>/items/<collection>/<key>` | partial object |
| Update by filter | `PATCH /api/<ws>/items/<collection>?filter…` | partial object |
| Delete one | `DELETE /api/<ws>/items/<collection>/<key>?fields=id` | none |
| Delete by filter | `DELETE /api/<ws>/items/<collection>?filter…&fields=id` | none |

**Deletes need a selection.** On the audited engine a delete without `fields` or `include` returns **422 and the row stays**. With `?fields=id` it returns the deleted rows in `data`. After any delete, confirm with a read of the same key or filter (expect 404 or an empty list).

`/items` only serves user collections. Built-in system collections return 422, so use the routes in [bootstrap-and-schema.md](bootstrap-and-schema.md).

## Errors

Errors are bare JSON: `{ "message": string, "code"?: string, "meta"?: object, "source"?: <nested error> }`. The top-level message is often generic ("Failed to execute query"). **Follow `source` down the chain** to the specific cause (for example `Empty selection` → `Query validation failed at …`, code `4010`).

| Status | Usually means |
| --- | --- |
| 400 | malformed request, or more than one credential source (for example bearer plus a stale session cookie) |
| 401 | missing, invalid, expired, or revoked token |
| 402 | licensed hard limit reached (`code` 6001…, `meta.violations`); see [bootstrap-and-schema.md](bootstrap-and-schema.md#1-preflight-the-instance) |
| 403 | the public or authenticated subject lacks the permission or entitlement; 403 does not prove a credential was sent |
| 404 | no item with that key, or no such route or workspace; read `message` |
| 422 | validation: bad payload or type, empty selection, unknown field, system collection via `/items` |

## OpenAPI: useful, not a route catalog

`GET /api/<ws>/openapi` (needs `openApiSchema:read`) and `GET /api/system/openapi` are OpenAPI 3.1 documents generated from the live schema. They carry the `x-monospace-mappings` extension used by codegen. Use the workspace document for **item** request and response shapes and as codegen input. It does not list the schema, structure, manifest, or many management routes. Some management operations in the system document are wrong (workspace create is documented as an array; the real body is a single object). For anything outside item CRUD, use the recipes in these references and the error `message`s.
