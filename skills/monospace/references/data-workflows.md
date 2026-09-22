# Monospace data workflows

Known-good recipes for reading and writing data, with the traps annotated inline. Examples use the typed SDK (every method takes a single options object; collections are cased as named). REST equivalents follow the same query shape ([rest-api.md](rest-api.md)). Let TypeScript infer result types — don't hand-roll them ([sdk.md](sdk.md)). Read back after a write to verify.

## Read: filter, select, sort, paginate

```ts
// `fields` selects scalars; `include` selects relations.
const articles = await client.Articles.readMany({
  filter: { status: { _eq: 'published' }, views: { _gte: 100 } },
  fields: ['id', 'title'],
  include: { author: { fields: ['id', 'name'] } },
  sort: [{ created_at: { direction: 'desc' } }],
  limit: 20,
  offset: 0,
});
// `articles` is fully typed and narrowed to the selected fields — no interface needed.

// Read a single item by key. To-one relations are accessed directly...
const article = await client.Articles.readOne({ key: 1, fields: ['id'], include: { author: { fields: ['name'] } } });
const authorName = article.author?.name; // to-one → T | null, direct access

// ...to-many relations stay enveloped under `.data`:
const withComments = await client.Articles.readOne({
  key: 1,
  fields: ['id'],
  include: {
    comments: {
      fields: ['id', 'body'],
      filter: { approved: { _eq: true } },
      sort: [{ created_at: { direction: 'desc' } }],
      limit: 5,
      include: { author: { fields: ['name'] } },
    },
  },
});
const comments = withComments.comments?.data; // NOT withComments.comments
```

The comment filter only narrows the included comments. To return only articles with
an approved comment, add `filter: { comments: { _some: { approved: { _eq: true } } } }`
at the top level. Nested arguments use `filter`/`limit`, not `_filter`/`_limit`;
operators such as `_eq` keep their underscores. Use another `include` at each depth.

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

// Link existing related items with `_connect` — pass an operation, never a raw id.
// In create context a to-one relation is a singular object, a to-many is an array of operations.
const withAuthor = await client.Articles.createOne({
  data: {
    title: 'Hello',
    author: { _connect: { key: { id: 7 } } },                // to-one  → object, singular `key`
    tags: [{ _connect: { keys: [{ id: 1 }, { id: 3 }] } }],  // to-many → array, plural `keys`
  },
  fields: ['id'],
  include: { author: { fields: ['name'] } },
});
```
Array-wrapping a to-one on create is rejected. Create context offers only `_connect` and `_create` — there is nothing yet to disconnect, update, or delete.

## Update

```ts
await client.Articles.updateOne({ key: 1, data: { status: 'published' }, fields: ['id', 'status'] });
await client.Articles.updateMany({ filter: { status: { _eq: 'draft' } }, data: { status: 'archived' }, fields: ['id'] });

// Update context wraps *every* relation in an array — to-one included, unlike create.
// That is what lets you sequence operations on one field; they run in array order.
await client.Articles.updateOne({
  key: 1,
  data: {
    author: [{ _disconnect: {} }, { _connect: { key: { id: 7 } } }],  // to-one  → still an array
    tags: [{ _connect: { keys: [{ id: 5 }] } }],                      // to-many → array
  },
  fields: ['id'],
});
```
Update inputs make every field optional — include only what you want to change. Beyond `_connect` / `_create`, update context adds `_disconnect` / `_update` / `_delete`; on a to-one, `_disconnect` and `_delete` exist only if the relation is nullable. `_connect` always takes `key` (object) for to-one and `keys` (array) for to-many, in both contexts — see [relational data](/developer/api/relational-data).

## Delete

```ts
// Deletes return no content unless you pass `fields` or `include` to return deleted rows.
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
