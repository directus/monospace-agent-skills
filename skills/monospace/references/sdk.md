# Monospace SDK (`@monospace/sdk`) and CLI (`@monospace/cli`)

The reliable path: generate a client from your instance with the CLI, import `createClient` from the **generated output**, and let TypeScript infer result types from your selections. Examples use illustrative collections (`Articles`, `comments`, `author`), so adapt names and types to your generated schema.

## Packages and versions

- **`@monospace/sdk`**: the runtime client (`createClient`, error classes) and config types (`@monospace/sdk/config`). It has **no executable**, so `npx @monospace/sdk init|login|generate` fails ("could not determine executable").
- **`@monospace/cli`**: the `monospace` binary, with `login`, `logout`, `whoami`, `sdk init`, `sdk generate`, and `extension create|build`. There is no `validate` command.

Keep an established project's compatible package pins. For a new project targeting the audited engine, install this exact continuous-build pair; the CLI is a dev dependency:
```bash
npm install https://pkg.pr.new/directus/monospace/@monospace/sdk@31d52d0
npm install --save-dev https://pkg.pr.new/directus/monospace/@monospace/cli@31d52d0
```
Then run `npx monospace …`. With other package managers use `pnpm exec monospace`, `yarn monospace`, or `bunx monospace`. For one-off use without installing, `npx @monospace/cli …` works.

**The engine, SDK, and CLI are versioned independently.** The combination verified for this skill was engine source `4f6f48c` (reports `0.7.0`) with SDK `0.8.0` and CLI `0.1.0`, both from continuous build `31d52d0`. The published releases also use those package version numbers, but this audit verified the continuous artifacts above. Do not identify the tested code by version number alone. A later engine may need a different pair. The resulting pins belong in these sections:
```jsonc
// package.json: merge these entries into the existing sections.
{
  "dependencies": {
    "@monospace/sdk": "https://pkg.pr.new/directus/monospace/@monospace/sdk@31d52d0"
  },
  "devDependencies": {
    "@monospace/cli": "https://pkg.pr.new/directus/monospace/@monospace/cli@31d52d0"
  }
}
```
Otherwise use whatever pair the project already has. Regenerate against the target instance, then typecheck, whenever the engine or packages change.

## Generate types with the CLI

```bash
npx monospace sdk init --url https://YOUR_HOST --workspace YOUR_WORKSPACE --dir ./src/generated/monospace
npx monospace login --url https://YOUR_HOST     # API key or email/password → OS keyring
npx monospace sdk generate                       # fetches /api/YOUR_WORKSPACE/openapi → <output>/index.ts
```

`sdk init` (prompts for anything you don't pass; `--yes` confirms overwriting an existing config) writes `monospace.config.ts`:
```ts
import type { MonospaceConfig } from '@monospace/sdk/config';

export default {
	url: 'https://YOUR_HOST',
	workspace: 'YOUR_WORKSPACE',
	output: './src/generated/monospace',
} satisfies MonospaceConfig;
```
`defineConfig` from `@monospace/sdk/config` is an equivalent helper. **Local mode:** set `input: './openapi.json'` (plus `output`) to generate from a saved OpenAPI file with no network or login; `url`/`workspace` are then ignored. Never put credentials in the config file, because the CLI rejects configs that contain them.

- **Target resolution:** URL and workspace are each taken from the first of: `--url`/`--workspace` flags, `MONOSPACE_URL`/`MONOSPACE_WORKSPACE` env vars, or the config file. A `.env` in the working directory is loaded, but real env vars win over it.
- **Credential priority** (`sdk generate`, `whoami`): `--api-key` flag, then `MONOSPACE_API_KEY`, then the keyring entry for that instance URL. A stored login session is refreshed once on 401/403. A rejected flag or env key is not retried: fix or unset it, because it overrides the keyring.
- **Permissions:** remote generation reads `GET /api/<ws>/openapi`, which needs `openApiSchema:read`.
- **Automation:** `--no-input` turns prompts into errors (prompts are also off without a TTY or when `CI` is set). `--json` prints one JSON result on stdout and exits 1 on failure. For a non-interactive login use `echo "$MONOSPACE_KEY" | npx monospace login --url https://YOUR_HOST --api-key-stdin`, or skip login and set `MONOSPACE_API_KEY`.
- `npx monospace whoami --url https://YOUR_HOST` shows the resolved target and identity. For `sdk init` and `sdk generate`, `--config <path>` selects another config file.

Re-run `sdk generate` whenever the schema or the packages change.

## Create the client

```ts
import { createClient } from './generated/monospace'; // match `output` and the project's tsconfig paths/aliases

const client = createClient({
	url: process.env.MONOSPACE_URL!,          // e.g. https://YOUR_HOST
	workspace: process.env.MONOSPACE_WORKSPACE!,
	apiKey: process.env.MONOSPACE_API_KEY,     // any bearer token: API key or user access token
});
```

The config accepts `url`, `workspace`, `apiKey?`, `unwrapEnvelope?` (default `true`), `strictNull?` (default `true`, which makes every field `| null`), and `http?` (a custom transport). Requests go to `${url}/api/${workspace}`. The default transport sends `Authorization: Bearer <apiKey>` with fetch `credentials: 'same-origin'` when `apiKey` is set, and with no `apiKey` it sends cookies (`credentials: 'include'`). `@monospace/sdk` also exports an untyped `createClient`. Use it only before you have generated types.

**The SDK has no login or refresh.** Get tokens from the CLI, the Studio, or the auth routes ([mcp-and-auth.md](mcp-and-auth.md#log-in-over-http)).

### Browser apps

Never ship an administrator login or API key in frontend code (`VITE_*`, `NEXT_PUBLIC_*`, and similar variables are public). Pick one of these:

1. **Session cookies:** the user signs in through session-mode login (`POST /api/auth/providers/local/password/login` with `credentials: 'include'` and no `mode`). Then create the client **without** `apiKey`, and cookies authenticate each request. Serve the app and `/api` from one origin (for example a dev-server or reverse proxy), because the cookies are `SameSite=Lax` and scoped to `/api`. Refresh with `POST /api/auth/refresh` (body `{}`) before `expires`, or after a 401.
2. **Backend-for-frontend:** keep API keys or service credentials on your server, and have the server enforce per-user scoping.
3. **In-memory bearer user token** (JSON-mode login): never combine it with cookies. A bearer token plus a stale `monospace_session` cookie returns **400**, and the default transport's `same-origin` setting sends that cookie through a same-origin proxy. Strip the cookie at the proxy, or use a transport with `credentials: 'omit'`:

```ts
import { mapEngineError, type ClientConfig } from '@monospace/sdk';
import { createClient } from './generated/monospace';

type Query = Record<string, unknown>;

// The SDK passes a flat query object (keys like 'filter[status][_eq]') and expects the raw JSON body back.
function bearerOnlyHttp(getToken: () => string | Promise<string>): NonNullable<ClientConfig['http']> {
	return ({ url, workspace }) => {
		async function send<T>(method: string, path: string, options?: { body?: Query; query?: Query }): Promise<T> {
			const target = new URL(`${url}/api/${encodeURIComponent(workspace)}${path}`, globalThis.location?.href);
			for (const [key, value] of Object.entries(options?.query ?? {})) target.searchParams.set(key, String(value));
			const response = await fetch(target, {
				method,
				credentials: 'omit',
				headers: { Authorization: `Bearer ${await getToken()}`, ...(options?.body ? { 'Content-Type': 'application/json' } : {}) },
				body: options?.body ? JSON.stringify(options.body) : undefined,
			});
			const text = await response.text();
			let body: unknown;
			try { body = text ? JSON.parse(text) : undefined; }
			catch (error) { if (response.ok) throw error; } // preserve status for non-JSON proxy errors
			if (!response.ok) {
				throw mapEngineError(body && typeof body === 'object' && 'message' in body ? (body as { message: string }) : { message: text || 'Request failed' }, response.status);
			}
			return body as T;
		}
		return {
			get: <T>(path: string, options?: { query?: Query }) => send<T>('GET', path, options),
			post: <T>(path: string, options?: { body?: Query; query?: Query }) => send<T>('POST', path, options),
			patch: <T>(path: string, options?: { body?: Query; query?: Query }) => send<T>('PATCH', path, options),
			delete: <T>(path: string, options?: { query?: Query }) => send<T>('DELETE', path, options),
		};
	};
}

// getAccessToken: your in-memory user token (from JSON-mode login/refresh), never an admin/API key.
const client = createClient({ url: '', workspace: 'YOUR_WORKSPACE', http: bearerOnlyHttp(getAccessToken) });
```
`url: ''` targets the current origin (behind a proxy that forwards `/api`). `createHttp` is not exported, so a custom transport has to implement `get`/`post`/`patch`/`delete` itself, as above. Keep the access token in memory and refresh it with the stored refresh token before it expires.

## Typed delegate API

`client.<Collection>` has one delegate per collection, **cased as the collection is named** (`client.Articles`, not `client.articles`). Every method takes:
1. a **parameters object** (`key`, `data`, `fields`, `include`, `filter`, `sort`, `limit`, `offset`, `meta`). There is no positional `readOne(id)`.
2. an optional **query-options object**, `{ unwrapEnvelope?: boolean }`, which controls this call's result shape.

```ts
await client.Articles.readMany({ fields: ['id', 'title'], filter: { status: { _eq: 'published' } }, sort: [{ created_at: { direction: 'desc' } }], limit: 20 });
await client.Articles.readFirst({ fields: ['id'], filter: { slug: { _eq: 'hello' } } }); // item or null
await client.Articles.readOne({ key: 1, fields: ['id', 'title'], include: { author: { fields: ['name'] } } });
await client.Articles.createOne({ data: { title: 'Hello', status: 'draft' }, fields: ['id'] });
await client.Articles.createMany({ data: [{ title: 'A' }, { title: 'B' }], fields: ['id'] });
await client.Articles.updateOne({ key: 1, data: { status: 'published' }, fields: ['id', 'status'] });
await client.Articles.updateMany({ filter: { status: { _eq: 'draft' } }, data: { status: 'archived' }, fields: ['id'] });
await client.Articles.deleteOne({ key: 1, fields: ['id'] });                                  // selection required
await client.Articles.deleteMany({ filter: { status: { _eq: 'archived' } }, fields: ['id'] }); // selection required
```

- Reads, creates, and updates default to `fields: ['*']` (all scalars). **Deletes send no selection by default, and the audited engine rejects that with 422 and keeps the row**, so always pass `fields` (for example `['id']`) to deletes.
- Which methods and fields exist, and which fields can be filtered, sorted, or written, follows the generated types, not just a field's scalar type.
- The `$`-prefixed untyped methods (`client.$readMany('Articles', params, options)`) are for collections with no generated types.
- Top-level `{ data }` is unwrapped for you. **Nested to-many relations stay enveloped** (`item.comments.data`), and to-one relations are direct (`item.author?.name`).

Relation writes (`_connect`, `_create`, …) are covered in [data-workflows.md](data-workflows.md#relations-on-write).

## Pagination with a total count

Unwrapping drops `meta`. Request the count and keep the envelope for that call:
```ts
import type { ArticlesReadManyParameters } from './generated/monospace';

const pageSize = 25;
const query = {
	fields: ['id', 'title'],
	filter: { status: { _eq: 'published' } },
	sort: [{ id: { direction: 'asc' } }], // stable order across pages
} as const satisfies ArticlesReadManyParameters;

async function readPage(page: number) {
	const { data, meta } = await client.Articles.readMany(
		{ ...query, limit: pageSize, offset: (page - 1) * pageSize, meta: { totalCount: true } },
		{ unwrapEnvelope: false },
	);
	return { items: data, totalCount: meta.totalCount, pageCount: Math.ceil(meta.totalCount / pageSize) };
}
```
With `meta: { totalCount: true }` and `unwrapEnvelope: false`, the result is typed `{ data: Item[]; meta: { totalCount: number } }`. Setting `unwrapEnvelope: false` in `createClient` applies it to every call.

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
// Each article has headline, writer?.name, and comments?.data[].author?.name.
```

Every `include` value is a nested query. To-many relations accept `filter`, `sort`, `limit`, and `offset`. Nullable to-one relations accept `filter`, and required to-one relations accept selection only. A nested filter narrows the included rows, while a top-level relation filter (`filter: { comments: { _some: … } }`) narrows the parents. Nested pagination is per parent. `include: { author: {} }` selects the relation's default scalars. Use `fields: []` together with an `include` for a relation-only selection. Aliases (`responseName:sourceField`) work in `fields` and as include keys, and are inferred in the result type. Do not use dotted paths, nested objects in `fields`, or `deep`. Query semantics are in [rest-api.md](rest-api.md#query-engine).

## Use inferred types, don't hand-roll

Result types are inferred from `fields` and `include`, including nested include chains (`order.lines.data[].product?.sku`). Unselected fields are type errors. Don't declare your own result interfaces.

Generated aliases are named `{Collection}{Op}…`, using the collection name exactly as it appears (`Articles` → `ArticlesReadManyParameters`).

- **Name a result type:** `type ArticleCard = ArticlesReadManyResultItem<{ fields: ['id', 'title'] }>;`. `{Collection}{Op}Result` is the whole result and `{Collection}{Op}ResultItem` is one item.
- **Reusable query params:** `as const satisfies {Collection}{Op}Parameters`. A `: Type` annotation widens `fields` to `string[]` and breaks inference.
- **Typed wrapper functions:** keep inference with a const generic: `async function fetchArticles<const P extends ArticlesReadManyParameters>(params: P) { return client.Articles.readMany(params); }`
- **Inputs and keys:** use generated `{Collection}CreateOneInput`, `{Collection}UpdateOneInput`, `{Collection}Key`. `{Collection}{Op}Args` is the full argument type (with `data`/`key`), and `{Collection}{Op}Parameters` covers query parameters only.

**Numbers:** 64-bit integer fields are typed `Int64` = `string` on output and `Int64Input` = `string | number` on input. Pass large values as strings, because values outside the safe integer range can round before transmission. Decimal fields are strings. Use `BigInt(value)` for integer strings and a decimal library for decimal amounts; avoid floating-point conversion of money.

## Errors

| Class | Thrown for |
| --- | --- |
| `MonospaceAuthError` | 401 |
| `MonospacePermissionError` | 403 |
| `MonospaceError` (base, `.status`, `.meta`, `.source`) | everything else: **400/422 validation**, 402 license limit, 404, 5xx |
| `MonospaceNotFoundError` | only when a transport passes collection context to `mapEngineError`. The built-in transport doesn't, so 404s arrive as base `MonospaceError` with `status === 404` |
| `MonospaceValidationError` | exported but **not currently thrown** by the built-in transport. Don't rely on it |

```ts
import { MonospaceAuthError, MonospaceError, MonospacePermissionError } from '@monospace/sdk';

function describe(err: MonospaceError): string {
	const messages: string[] = [];
	for (let e: MonospaceError | undefined = err; e; e = e.source) messages.push(e.message);
	return messages.join(' → '); // the nested `source` chain holds the specific cause
}

try {
	await client.Articles.createOne({ data: { title: 'Hello' }, fields: ['id'] });
} catch (err) {
	if (err instanceof MonospaceAuthError) { /* 401: missing/expired/revoked token */ }
	else if (err instanceof MonospacePermissionError) { /* 403: the token's subject lacks permission */ }
	else if (err instanceof MonospaceError && (err.status === 400 || err.status === 422)) { /* fix payload: describe(err) */ }
	else if (err instanceof MonospaceError && err.status === 402) { /* license limit: tell the user */ }
	else if (err instanceof MonospaceError && err.status === 404) { /* missing item/route */ }
	else throw err;
}
```
A rejected nested create (for example `_create` with an invalid `_connect` key) fails as a whole and leaves no parent row.
