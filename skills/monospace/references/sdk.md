# Monospace SDK (`@monospace/sdk`)

The typed TypeScript client. Best path: generate types from your instance, then write fully-typed queries against the generated `createClient`.

## Install + construct the client

```bash
npm i @monospace/sdk
```

**Recommended:** import `createClient` from your **generated** client (typed to *your* instance's schema), not from `@monospace/sdk` directly. Generate it first (see [codegen](#generate-instance-correct-types-codegen) below).

```ts
import { createClient } from '~/generated/monospace'; // your generated output dir; `/index.ts` is implied

const client = createClient({
  url: 'https://YOUR_HOST',   // engine base URL (no /api)
  project: 'YOUR_PROJECT',    // project slug
  apiKey: process.env.MONOSPACE_API_KEY, // JWT: API key or user access token
});
// Base URL becomes `${url}/api/${project}`.
```

Haven't generated types yet? `@monospace/sdk` exports a generic `createClient` with the same config, but it is **not** typed to your schema — prefer the generated import above:

```ts
import { createClient } from '@monospace/sdk'; // generic; not schema-typed
```

**Auth modes:**
- **Static bearer** — pass `apiKey`; it is sent as `Authorization: Bearer <apiKey>`.
- **Cookie / session** — for browser apps; the client sends credentials with the request instead of a bearer.
- **Custom headers** — supply your own header map for advanced cases.

The SDK does **not** implement login/refresh — obtain a token out of band (create an API key in the Studio under Account → Access → API Keys, or log in via the provider endpoint) and hand it to `createClient`.

## Typed delegate API

`createClient` returns a proxy with one delegate per collection. Methods are typed by the (generated) schema:

```ts
await client.articles.readMany({ filter: { status: { _eq: 'published' } }, limit: 20 });
await client.articles.readOne(id, { fields: ['id', 'title', { author: ['name'] }] });
await client.articles.readFirst({ sort: [{ created_at: { direction: 'desc' } }] });
await client.articles.createOne({ title: 'Hello' });
await client.articles.createMany([{ title: 'A' }, { title: 'B' }]);
await client.articles.updateOne(id, { title: 'Updated' });
await client.articles.updateMany({ filter: { … } }, { status: 'archived' });
await client.articles.deleteOne(id, { fields: ['id'] });
await client.articles.deleteMany({ filter: { … }, fields: ['id'] });
```
CRUD methods are conditionally present per collection based on its capabilities. For collections you don't have generated types for, `$`-prefixed untyped variants exist as an escape hatch (e.g. `client.$readMany('collection', options)`).

Query options mirror the REST query engine: `fields` (array, nested selection via objects), `filter` (the underscore operators), `sort` (object form), `limit`, `offset`. See [rest-api.md](rest-api.md) for the operator table.

## Traps that bite SDK callers

- The top-level `{ data }` envelope is stripped for you, but **nested to-many relations stay enveloped** — read `item.<relation>.data`.
- `createOne` is batch-oriented under the hood; pass a single object (don't pre-wrap in an array).
- **Deletes require `fields`.** A delete with no `fields` fails — always pass `fields` (e.g. the key); the selected fields are what comes back.
- `fields` defaults to top-level primitives; select nested fields to get relations.

## Errors

The SDK maps engine errors to typed exceptions: `MonospaceError` (base, carries `status`), `MonospaceNotFoundError`, `MonospaceAuthError` (401), `MonospacePermissionError` (403), `MonospaceValidationError`. Use `instanceof` to branch. `MonospaceNotFoundError` is raised for 404s that carry collection context (e.g. a typed `readOne`); a bare transport-level 404 surfaces as a generic `MonospaceError`, so check `status` when handling not-found generically.

## Generate instance-correct types (codegen)

The `monospace` CLI turns the live OpenAPI doc into a typed client matching your instance's schema. Prefer this over hand-writing shapes.

```bash
monospace init       # scaffold monospace.config.ts (remote mode)
monospace login      # email/password → stored in OS keyring (or set MONOSPACE_API_KEY)
monospace generate   # fetch live OpenAPI → write generated/monospace/index.ts
monospace validate   # connectivity/auth check
monospace logout
```

**Config** (`monospace.config.ts` / `.js`, discovered via jiti):
- **Remote mode** — generate fetches `GET /api/<project>/openapi` (auth required) using your stored credentials or `MONOSPACE_API_KEY`.
- **Local mode** — set `input` to a saved OpenAPI JSON file; no network. (Local configs are hand-authored; `init` scaffolds remote only.)
- Output is written to your config's `output` dir as `index.ts`. Recommended: set `output` to `generated/monospace`, then import from `~/generated/monospace`.

The generator consumes the `x-monospace-mappings` extension in the OpenAPI doc to map operations to typed collection delegates, and the emitted `index.ts` exports a `createClient` already bound to your schema.

**Auth for the CLI:** credentials are stored in the OS keyring (service `monospace-cli`, keyed by URL origin). Header priority is `--api-key` / `MONOSPACE_API_KEY` first, then the keyring token (auto-refreshed and retried once on 401/403). The only env var the SDK/CLI reads is `MONOSPACE_API_KEY`.

### Zero to typed client

```bash
# 1. point at your instance
monospace init                      # answer prompts: host, project
# 2. authenticate
monospace login                     # or: export MONOSPACE_API_KEY=<jwt>
# 3. generate
monospace generate                  # writes generated/monospace/index.ts
```
```ts
// 4. use the generated, fully-typed client (NOT @monospace/sdk)
import { createClient } from '~/generated/monospace';
const client = createClient({ url, project, apiKey: process.env.MONOSPACE_API_KEY });
const { /* typed */ } = await client.articles.readMany({ /* typed options */ });
```
