# Monospace data workflows

Known-good recipes for reading and writing data, with the traps annotated inline. Examples use the typed SDK (every method takes a single options object; collections are cased as named). REST equivalents follow the same query shape ([rest-api.md](rest-api.md)). Let TypeScript infer result types — don't hand-roll them ([sdk.md](sdk.md)). Read back after a write to verify.

## Read: filter, select, sort, paginate

```ts
// Filter + nested selection. Select relations explicitly — with `fields` omitted you
// get scalar fields only, so `author` would be missing without selecting it.
const articles = await client.Articles.readMany({
  filter: { status: { _eq: 'published' }, views: { _gte: 100 } },
  fields: ['id', 'title', { author: ['id', 'name'] }],
  sort: [{ created_at: { direction: 'desc' } }],
  limit: 20,
  offset: 0,
});
// `articles` is fully typed and narrowed to the selected fields — no interface needed.

// Read a single item by key. To-one relations are accessed directly...
const article = await client.Articles.readOne({ key: 1, fields: ['id', { author: ['name'] }] });
const authorName = article.author?.name; // to-one → T | null, direct access

// ...to-many relations stay enveloped under `.data`:
const withComments = await client.Articles.readOne({ key: 1, fields: ['id', { comments: ['id', 'body'] }] });
const comments = withComments.comments?.data; // NOT withComments.comments
```

Pagination is manual — there is no `page` param:
```ts
const pageSize = 25;
const page = 3;
await client.Articles.readMany({ fields: ['id', 'title'], limit: pageSize, offset: (page - 1) * pageSize });
```

## Filter cheat sheet

```ts
{ title: { _icontains: 'monospace' } }                       // case-insensitive contains
{ status: { _in: ['draft', 'review'] } }                      // set membership
{ published_at: { _null: false } }                            // not null (nullable fields only)
{ _and: [ { views: { _gte: 100 } }, { featured: { _eq: true } } ] }
{ _or: [ { status: { _eq: 'published' } }, { author_id: { _eq: meId } } ] }
{ comments: { _some: { approved: { _eq: true } } } }          // to-many quantifier
```
`-field` sort is rejected — always the object form. `_null` only on nullable fields. No `search`; use `_icontains` / `_contains` for text matching.

## Create

```ts
// createOne — payload under `data` (a single object); `fields` selects what comes back.
const created = await client.Articles.createOne({
  data: { title: 'Hello', status: 'draft' },
  fields: ['id', 'title'],
});

// createMany — `data` is an array.
await client.Articles.createMany({ data: [{ title: 'A' }, { title: 'B' }], fields: ['id'] });

// Link an existing related item by primary key with `_connect` — pass a connect
// operation, not the raw id. A to-one relation in create context is a singular object:
const withAuthor = await client.Articles.createOne({
  data: { title: 'Hello', author: { _connect: { key: { id: 7 } } } },
  fields: ['id', { author: ['name'] }],
});
```

## Update

```ts
await client.Articles.updateOne({ key: 1, data: { status: 'published' }, fields: ['id', 'status'] });
await client.Articles.updateMany({ filter: { status: { _eq: 'draft' } }, data: { status: 'archived' }, fields: ['id'] });

// Relations wrap the operation in an array in update context (create context is a singular object):
await client.Articles.updateOne({ key: 1, data: { author: [{ _connect: { key: { id: 7 } } }] }, fields: ['id'] });
```
Update inputs make every field optional — include only what you want to change. Beyond `_connect`, update context also supports `_create` / `_disconnect` / `_update` / `_delete` — see [relational data](/developer/api/relational-data).

## Delete

```ts
// Deletes return no content unless you pass `fields` to return deleted rows.
await client.Articles.deleteOne({ key: 1 });
await client.Articles.deleteMany({ filter: { status: { _eq: 'archived' } } });
```

## Inspect schema before mutating

Before creating collections/fields or writing into an unfamiliar collection, inspect the schema (via the MCP `read_schema` tool, or the OpenAPI doc) so field names and types are real, not assumed. Then write, then read back to verify.

## Error handling

```ts
import { MonospacePermissionError, MonospaceValidationError } from '@monospace/sdk';
try {
  await client.Articles.createOne({ data: { /* … */ }, fields: ['id'] });
} catch (err) {
  if (err instanceof MonospaceValidationError) { /* fix payload */ }
  else if (err instanceof MonospacePermissionError) { /* lacks RBAC */ }
  else throw err;
}
```
For 404s, a typed read with collection context yields `MonospaceNotFoundError`; a raw transport-level 404 comes back as a generic `MonospaceError` (check `status`). See [sdk.md](sdk.md).
