# Bootstrap, workspaces, and schema discovery

Getting from "I have a host and credentials" to "I know the workspace and its collections". These management and schema routes are **not reliably described by OpenAPI**: some are missing, and at least one is documented with the wrong body shape. Use the recipes here. Placeholders: `YOUR_HOST`, `YOUR_WORKSPACE`; `$TOKEN` is a user access token or API key (see [mcp-and-auth.md](mcp-and-auth.md#log-in-over-http) to get one).

## 1. Preflight the instance

```bash
curl --globoff -sS "https://YOUR_HOST/api/system/info" -H "Authorization: Bearer $TOKEN"
```

The response is a **bare object** (no `data` envelope). `onboarding` appears only while setup is incomplete (`requireCreateUser`, `requireAcceptTerms`). Authenticated callers also get `now`, `license`, and `authenticated.{version, revision}`. Two things to check:

- `onboarding.requireAcceptTerms: true` means the organization has not accepted the terms yet. Surface the pending Studio onboarding step to the operator; successful login does not imply terms acceptance. API login and ordinary reads can still work while it is pending.
- `authenticated.version` identifies the engine only. It does not tell you which SDK/CLI release matches it (see [sdk.md](sdk.md#packages-and-versions)).

Before proposing a design that needs extra workspaces, custom roles, custom policies, or service accounts, check the license:

```bash
curl --globoff -sS "https://YOUR_HOST/api/system/license" -H "Authorization: Bearer $TOKEN"
curl --globoff -sS "https://YOUR_HOST/api/YOUR_WORKSPACE/license" -H "Authorization: Bearer $TOKEN"
```

The workspace response lists `usage` and `entitlements`; limits are under entries such as `entitlements.custom_roles.limit`. The keyless **Starter** profile tested for this skill allows `workspaces: 1`, `custom_roles: 0`, `custom_policies: 0`, `service_accounts: 0` (seats: 3). Exceeding a hard limit returns **402** with a code (`6001` workspaces, `6002` service accounts, `6005` custom roles, `6007` custom policies) and a `meta.violations` list. A 402 is a license constraint, not a permission bug. Adapt the design to the available capabilities, or use an instance licensed for the required features.

## 2. Find or create the workspace

```bash
# List (enveloped: { "data": [ { "id": "…", "apiName": "…" } ] })
curl --globoff -sS "https://YOUR_HOST/api/system/workspaces?fields=id,apiName" -H "Authorization: Bearer $TOKEN"

# Create: send ONE object, not an array
curl --globoff -sS -X POST "https://YOUR_HOST/api/system/workspaces" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"apiName":"YOUR_WORKSPACE","displayName":"Your workspace"}'
# -> { "data": { "id": "<uuid>" } }
```

System OpenAPI describes this POST as an array of `MonospaceWorkspaceCreateInput` with required `id`. That is wrong: an array body returns 422, and the handler accepts only `apiName` plus optional `displayName` (unknown keys are rejected). On Starter a second workspace returns 402/`6001`, so reuse the existing workspace unless the user has a larger license.

The `apiName` is the `<workspace>` segment in every workspace-scoped URL (`/api/<workspace>/...`).

## 3. Discover the schema

Workspace-scoped schema routes: `dataModel:read` grants schema and model-metadata reads. The `sources` routes instead use `dataSource:read` for the requested sources.

| Route | Returns |
| --- | --- |
| `GET /api/<ws>/schema/structure/sources` | data sources |
| `GET /api/<ws>/schema/structure/namespaces` | namespaces |
| `GET /api/<ws>/schema/structure/collections` | collections |
| `GET /api/<ws>/schema/structure/fields/primitive` | scalar fields |
| `GET /api/<ws>/schema/structure/fields/single-relation` | relation fields |
| `GET /api/<ws>/schema/structure/<kind>/<id>` | one entry of the above |
| `GET /api/<ws>/schema` | compact schema manifest (see below) |

The structure routes are ordinary enveloped list reads that accept `filter`, `sort`, `limit`, `offset`, and `meta`. **Always pass explicit `fields`**. Omitting it returns 422 (`Empty selection`, nested under `source`).

```bash
curl --globoff -sS "https://YOUR_HOST/api/YOUR_WORKSPACE/schema/structure/sources?fields=id,apiName" -H "Authorization: Bearer $TOKEN"
curl --globoff -sS "https://YOUR_HOST/api/YOUR_WORKSPACE/schema/structure/collections?fields=id,apiName,isSystem&filter[isSystem][_eq]=false&meta=totalCount" \
  -H "Authorization: Bearer $TOKEN"
```

To discover metadata columns, request `?fields=*&limit=1`, then narrow the selection. For example, `/schema/structure/fields/primitive?fields=*&limit=1` exposes scalar-field metadata including `apiName`, `collectionId`, `dbName`, `defaultValue`, `isList`, `isNullable`, `queryCapabilities`, and `type`.

**System collections are not item collections.** `GET /api/<ws>/items/MonospaceDataSource` (or another built-in system collection) returns 422 `System collection … is not available through /items`. Use the structure routes instead. Some older scripts still use the `/items` form, and it now fails.

Other discovery paths:
- **MCP `read_schema`**: the easiest option inside an agent session ([mcp-and-auth.md](mcp-and-auth.md#tools-7)).
- **Workspace OpenAPI** (`GET /api/<ws>/openapi`, needs `openApiSchema:read`): the generated contract for **item** routes (`/items/<collection>`), with request/response shapes per collection and `x-monospace-mappings` for codegen. It is the right input for `monospace sdk generate` and for item payload shapes. It does **not** list the schema, structure, manifest, or most management routes.
- **Schema manifest** `GET /api/<ws>/schema`: a bare, compact, machine-oriented document (`formatVersion`, `strings`, `primitiveTypes`, `monospaceSchema`, `querySchema`) that needs a decoder. Prefer the structure routes for agent discovery. The manifest sends a weak `ETag`, and a matching `If-None-Match` returns **304**. Use that only to revalidate a cached manifest. It is not a concurrency token: schema migrations do not require `If-Match`.

## 4. Change the schema

Prefer the MCP `mutate_schema` tool or the Studio for schema changes. Read the schema first. Apply changes within the user's authorized scope; clarify destructive effects outside that scope before proceeding. For raw HTTP, `POST /api/<ws>/schema/migrate` takes `{ "operations": [...] }` and returns 200 with an empty body. This shape worked on the audited engine. Adapt names and types, and take `sourceId` from the sources route instead of hard-coding it:

```jsonc
{ "operations": [ { "kind": "createCollection", "data": {
  "id": "<new uuid>", "sourceId": "<source id>", "dbName": "Products",
  "operations": [
    { "kind": "createPrimitiveField", "data": { "id": "<uuid-a>", "dbName": "id", "type": { "name": "int32" },
      "isNullable": false, "isList": false, "defaultValue": { "source": "connectorManaged", "isAutoincrement": true } } },
    { "kind": "createPrimitiveField", "data": { "id": "<uuid-b>", "dbName": "name",
      "type": { "name": "string", "params": { "length": "unlimited" } }, "isNullable": false, "isList": false } },
    { "kind": "createPrimitiveField", "data": { "id": "<uuid-c>", "dbName": "price",
      "type": { "name": "decimal", "params": { "kind": "constrained", "precision": 12, "scale": 2 } }, "isNullable": false, "isList": false } },
    { "kind": "createIndex", "data": { "id": "<uuid-d>", "dbName": "Products_pk", "fieldIds": ["<uuid-a>"], "kind": "primary" } }
  ] } } ] }
```

Relations are a separate operation that references ids you already created. In this example, a many-to-one `order` on `OrderLines` (foreign-key field `orderId`) is paired with a to-many `lines` on `Orders`:

```jsonc
{ "operations": [ { "kind": "createRelationFieldPair", "data": { "kind": "single", "data": {
  "relationName": "OrderLinesOrder",
  "firstField":  { "id": "<new uuid>", "apiName": "order", "isList": false, "isConstrained": true,
                   "collectionId": "<OrderLines id>", "fieldIds": ["<OrderLines.orderId field id>"] },
  "secondField": { "id": "<new uuid>", "apiName": "lines", "isList": true, "isConstrained": false,
                   "collectionId": "<Orders id>", "fieldIds": ["<Orders.id field id>"] }
} } } ] }
```

Type support depends on the connector: on the tested PostgreSQL source, creating a `uint64` field failed with "Unsigned integers not supported". After a migration, re-read the structure routes and regenerate SDK types.
