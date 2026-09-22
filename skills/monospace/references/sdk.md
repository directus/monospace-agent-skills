# Monospace SDK (`@monospace/sdk`)

The typed TypeScript client. The reliable path: generate a client from your instance, import `createClient` from the **generated output** (typed to your schema), and let TypeScript **infer** result types from your field selections. Do not hand-write result types.

## Get up and running

Mirrors the official quickstart (docs: `/developer/sdk`, `/developer/sdk/client-setup`).

1. **Install** — first check `package.json`; a Monospace project often already depends on it. Only if missing:
   ```bash
   npm install @monospace/sdk
   ```
   Requires TypeScript with `"strict": true`.
2. **Create the config** — `npx @monospace/sdk init` writes `monospace.config.ts`:
   ```ts
   import { defineConfig } from '@monospace/sdk/config';

   export default defineConfig({
     url: 'https://example.monospace.io',
     workspace: 'blog',
     output: './src/generated/monospace', // default — set to your project's layout
   });
   ```
3. **Authenticate the generator** — set `MONOSPACE_API_KEY` (e.g. in `.env`) or run `npx @monospace/sdk login` (OS keychain). Create the key in the Studio: **Account → Access → API Keys**.
4. **Generate** — `npx @monospace/sdk generate` reads your instance's OpenAPI and writes `<output>/index.ts`.
5. **Create the client** — import from the **generated output**, not `@monospace/sdk`:
   ```ts
   import { createClient } from './generated/monospace'; // adjust to your `output` path / tsconfig alias

   const client = createClient({
     url: 'https://example.monospace.io',
     workspace: 'blog',
     apiKey: process.env.MONOSPACE_API_KEY,
   });
   ```
6. Re-run `generate` whenever the schema or engine/SDK version changes.

> The import path is illustrative. **Match it to the project:** whatever `output` is set in `monospace.config.ts` and however the project's `tsconfig` resolves paths (a relative import, or an alias like `~/` or `@/`). Don't blindly paste `./src/generated/monospace`.

Haven't generated yet? `@monospace/sdk` exports a generic `createClient` with the same config, but it is **not** typed to your schema — generate and import from the output instead.

## Construct the client

`createClient({ url, workspace, apiKey })` — base URL becomes `${url}/api/${workspace}`. Auth modes:
- **Static bearer** — pass `apiKey`; sent as `Authorization: Bearer <apiKey>`.
- **Cookie / session** — browser apps; the client sends credentials instead of a bearer.
- **Custom headers** — supply your own header map.

The SDK does **not** implement login/refresh — obtain a token out of band (an API key from the Studio, or a user access token) and pass it.

## Typed delegate API

`createClient` returns a proxy with one delegate per collection, **cased as the collection is named** (`client.Articles`, not `client.articles`). Every method takes a **single options object** — there are no positional `id` arguments:

```ts
await client.Articles.readMany({ fields: ['id', 'title'], filter: { status: { _eq: 'published' } }, sort: [{ created_at: { direction: 'desc' } }], limit: 20 });
await client.Articles.readOne({ key: 1, fields: ['id', 'title'], include: { author: { fields: ['name'] } } });
await client.Articles.createOne({ data: { title: 'Hello', status: 'draft' }, fields: ['id'] });
await client.Articles.createMany({ data: [{ title: 'A' }, { title: 'B' }], fields: ['id'] });
await client.Articles.updateOne({ key: 1, data: { status: 'published' }, fields: ['id', 'status'] });
await client.Articles.updateMany({ filter: { status: { _eq: 'draft' } }, data: { status: 'archived' }, fields: ['id'] });
await client.Articles.deleteOne({ key: 1 });
await client.Articles.deleteMany({ filter: { status: { _eq: 'archived' } } });
```

- `key` = primary key; `data` = payload (single object for `createOne`/`updateOne`, array for `createMany`); `fields` and `include` select what comes back from reads, creates, updates, and deletes when provided.
- CRUD methods are present per collection based on its capabilities. Fields also have operation-specific read/write/filter/sort capabilities; follow the generated types, not just the field's scalar type.
- `$`-prefixed untyped variants are an escape hatch when you have no generated types (e.g. `client.$readMany('collection', options)`).

Query options are flat in the method's parameter object: `fields` (scalar names), `include` (relation queries), `filter` (underscore operators), `sort` (object form), `limit`, `offset`. Operator table: [rest-api.md](rest-api.md).

## Relations and aliases

```ts
const articles = await client.Articles.readMany({
  fields: ['id', 'headline:title'],
  include: {
    'writer:author': { fields: ['name'] },
    comments: {
      fields: ['id', 'body'],
      filter: { approved: { _eq: true } },
      sort: [{ created_at: { direction: 'desc' } }],
      limit: 5,
      include: { author: { fields: ['name'] } },
    },
  },
});
// Each article has headline, writer?.name, and comments?.data.
```

Every `include` value is a nested query. To-many relations accept `filter`, `sort`,
`limit`, and `offset`; nullable to-one relations accept `filter`; required to-one
relations accept selection only. Nested filters affect the included rows, while a
top-level relation filter affects which parents are returned. Nested pagination is
per parent.

`include: { author: {} }` selects the relation's default scalar fields. Omitting
`fields` defaults to all scalars at each level; relations always require `include`.
Use `fields: []` with an `include` for a relation-only selection. An include value
of `undefined` is omitted and yields an optional result property.

Aliases use `responseName:sourceField` in `fields` or as an `include` key and are
inferred in the result type. Each relation alias can have its own query. With a
wildcard, an explicit scalar alias replaces its source unless the original name is
also explicitly selected. Do not use dotted paths, nested objects inside `fields`,
or `deep`; see the [REST query guide](rest-api.md#query-engine).

## Use inferred types — don't hand-roll

The generated client **infers** result types from your `fields` and `include` selections. Never declare your own interfaces for query results (docs: `/developer/sdk/type-system`).

- **Just use the result** — already typed and narrowed to the fields you selected:
  ```ts
  const articles = await client.Articles.readMany({ fields: ['id', 'title', 'status'] });
  // articles: { id: string | null; title: string | null; status: string | null }[]
  ```
  Under the default `strictNull: true` every field is `| null`. Omitting `fields` returns all scalar fields; use `include` for relations.
- **Relations follow cardinality** — to-one → `T | null` (access directly); to-many → `{ data: T[] }` (the envelope), e.g. `comments.data`.
- **Name a result type** (component props, return values) → import generated result types instead of writing an interface:
  ```ts
  import type { ArticleReadManyResultItem } from './generated/monospace';
  type ArticleCard = ArticleReadManyResultItem<{ fields: ['id', 'title'] }>;
  ```
  `{Collection}{Op}Result` = full result (array for `readMany`); `{Collection}{Op}ResultItem` = single-item shape.
- **Reusable query params** → `satisfies {Collection}{Op}Parameters` with `as const`. Do NOT use a `: Type` annotation — it widens `fields` to `string[]` and kills inference:
  ```ts
  import type { ArticleReadManyParameters } from './generated/monospace';
  const publishedArticles = {
    fields: ['id', 'title'],
    include: { author: { fields: ['name'] } },
    filter: { status: { _eq: 'published' } },
  } as const satisfies ArticleReadManyParameters;
  const list = await client.Articles.readMany(publishedArticles); // still fully inferred
  ```
- **Typed function args** → preserve the caller's inference with a const generic:
  ```ts
  async function fetchArticles<const P extends ArticleReadManyParameters>(params: P) {
    return client.Articles.readMany(params);
  }
  ```
- **Inputs and keys** → use the generated `ArticleCreateOneInput`, `ArticleUpdateOneInput`, `ArticleKey` (string or number per your PK) — not hand-typed shapes.

Two type families per operation: `{Collection}{Op}Parameters` (query params only) and `{Collection}{Op}Args` (full args incl. `data`/`key`; what the methods accept). Prefer `Args`; use `Parameters` for reusable query fragments.

## Traps that bite SDK callers

- **Methods take one options object, not positional args** — `readOne({ key })`, never `readOne(id)`.
- **Collections are cased as named** — `client.Articles`, not `client.articles`.
- The top-level `{ data }` envelope is stripped for you, but **nested to-many relations stay enveloped** — read `item.<relation>.data` (to-one is direct).
- **`createOne` takes a single object under `data`** (`createMany` takes an array under `data`).
- **Deletes return no content unless `fields` or `include` is provided** — call `deleteOne({ key })` or `deleteMany({ filter })` for void deletes; pass a selection when you need deleted rows back.
- **`fields` omitted → all scalar fields** — select relations with `include`.
- **Link relations with `_connect`, not a raw id** — a bare `author: <id>` is rejected. The payload shape depends on *both* context and cardinality: on create, to-one is a singular object (`author: { _connect: { key: { id } } }`) and to-many an array (`tags: [{ _connect: { keys: [{ id }] } }]`); on update **every** relation is array-wrapped, to-one included (`author: [{ _connect: { key: { id } } }]`). Array-wrapping a to-one on create is an error. `_connect` takes `key` (object) for to-one, `keys` (array) for to-many. Create allows only `_connect` / `_create`; update adds `_disconnect` / `_update` / `_delete`. Details: [relational data](/developer/api/relational-data).

## Errors

The SDK maps engine errors to typed exceptions: `MonospaceError` (base, carries `status`), `MonospaceNotFoundError`, `MonospaceAuthError` (401), `MonospacePermissionError` (403), `MonospaceValidationError`. Use `instanceof` to branch. `MonospaceNotFoundError` is raised for 404s that carry collection context (a typed `readOne`); a bare transport-level 404 surfaces as a generic `MonospaceError`, so check `status` when handling not-found generically.

## Codegen reference

- **CLI** (bin is `monospace`; `npx @monospace/sdk <cmd>` runs it without a global install): `init`, `generate`, `login`, `logout`, `validate`.
- **Config** (`monospace.config.ts` / `.js`, discovered via jiti):
  - **Remote mode** — `generate` fetches `GET /api/<workspace>/openapi` (auth required) via your keyring token or `MONOSPACE_API_KEY`.
  - **Local mode** — set `input` to a saved OpenAPI JSON file; no network. (Hand-authored; `init` scaffolds remote only.)
  - `output` — where `index.ts` is written (default `./src/generated/monospace`).
- The generator consumes the `x-monospace-mappings` OpenAPI extension to map operations to typed collection delegates; the emitted `index.ts` exports a `createClient` already bound to your `Schema`, plus the per-collection type aliases above.
- **CLI auth**: credentials stored in the OS keyring (service `monospace-cli`, keyed by URL origin). Header priority `--api-key` / `MONOSPACE_API_KEY` first, then the keyring token (auto-refreshed, retried once on 401/403).

## See also (docs)

- Type System — `/developer/sdk/type-system` (inference, result/param/input types, `satisfies`)
- Client Setup — `/developer/sdk/client-setup` (install, `strictNull`)
- Field Selection / Relational Data — `/developer/api/field-selection`, `/developer/api/relational-data`
