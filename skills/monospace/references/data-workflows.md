# Monospace data workflows

Known-good recipes for reading and writing data, with the traps annotated inline. Examples use the typed SDK; the REST equivalents follow the same query shape ([rest-api.md](rest-api.md)). Always read back after a write to verify.

## Read: filter, select, sort, paginate

```ts
// Filter + nested selection. Request relations explicitly — fields defaults to
// top-level primitives, so `author` would be omitted without selecting it.
const { /* items */ } = await client.articles.readMany({
  filter: { status: { _eq: 'published' }, views: { _gte: 100 } },
  fields: ['id', 'title', { author: ['id', 'name'] }],
  sort: [{ created_at: { direction: 'desc' } }],
  limit: 20,
  offset: 0,
});

// Read a relation off an item: nested to-many relations stay enveloped.
const article = await client.articles.readOne(id, { fields: ['id', { comments: ['id', 'body'] }] });
const comments = article.comments.data; // NOT article.comments
```

Pagination is manual — there is no `page` param:
```ts
const pageSize = 25;
const page = 3;
await client.articles.readMany({ limit: pageSize, offset: (page - 1) * pageSize });
```

## Filter cheat sheet

```ts
{ title: { _icontains: 'monospace' } }                       // case-insensitive contains
{ status: { _in: ['draft', 'review'] } }                      // set membership
{ published_at: { _null: false } }                            // not null (nullable fields only)
{ _and: [ { views: { _gte: 100 } }, { featured: { _eq: true } } ] }
{ _or: [ { status: { _eq: 'published' } }, { author: { _eq: meId } } ] }
{ comments: { _some: { approved: { _eq: true } } } }          // to-many quantifier
```
`-field` sort is rejected — always the object form. `_null` only on nullable fields. No `search`; use `_icontains` / `_contains` for text matching.

## Create

```ts
// Single — pass an object (createOne is batch-oriented internally; do NOT pre-wrap in [] yourself).
const created = await client.articles.createOne({ title: 'Hello', status: 'draft' });

// Many
await client.articles.createMany([{ title: 'A' }, { title: 'B' }]);
```

## Update

```ts
await client.articles.updateOne(id, { status: 'published' });
await client.articles.updateMany({ filter: { status: { _eq: 'draft' } } }, { status: 'archived' });
```

## Delete

```ts
// Returns undefined by default — pass `fields` if you need the deleted row back.
await client.articles.deleteOne(id);
const removed = await client.articles.deleteOne(id, { fields: ['id', 'title'] });
await client.articles.deleteMany({ filter: { status: { _eq: 'archived' } } });
```

## Inspect schema before mutating

Before creating collections/fields or writing into an unfamiliar collection, inspect the schema (via the MCP `read_schema` tool, or the OpenAPI doc) so field names and types are real, not assumed. Then write, then read back to verify.

## Error handling

```ts
import { MonospacePermissionError, MonospaceValidationError } from '@monospace/sdk';
try {
  await client.articles.createOne({ /* … */ });
} catch (err) {
  if (err instanceof MonospaceValidationError) { /* fix payload */ }
  else if (err instanceof MonospacePermissionError) { /* lacks RBAC */ }
  else throw err;
}
```
For 404s, a typed read with collection context yields `MonospaceNotFoundError`; a raw transport-level 404 comes back as a generic `MonospaceError` (check `status`). See [sdk.md](sdk.md).
