# Monospace data workflows

Known-good recipes for reading and writing item data with the typed SDK, followed by raw REST equivalents. Collections and fields (`Articles`, `comments`, `author`, `tags`) are illustrative, so adapt names and types to your generated schema. Client setup, pagination with a total count, and error classes are in [sdk.md](sdk.md). Query semantics are in [rest-api.md](rest-api.md#query-engine).

## Workflow

1. **Inspect** the collection's fields and relations first (generated types, MCP `read_schema`, or [schema discovery](bootstrap-and-schema.md#3-discover-the-schema)).
2. **Write** with an explicit `fields` selection so the response confirms what changed.
3. **Verify** with a read-back that uses the same key or the user's exact filter. For bulk operations, keep the user's filter as given: don't widen it to make a call succeed, and don't treat a 200 as proof. Reread and compare.

## Read: filter, select, sort, paginate

```ts
const articles = await client.Articles.readMany({
	filter: { status: { _eq: 'published' }, views: { _gte: 100 } },
	fields: ['id', 'title'],                          // scalars
	include: { author: { fields: ['id', 'name'] } },  // relations
	sort: [{ created_at: { direction: 'desc' } }],
	limit: 20,
	offset: 0,
});

const article = await client.Articles.readOne({ key: 1, fields: ['id'], include: { author: { fields: ['name'] } } });
const authorName = article.author?.name;              // to-one → object | null, direct

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
const comments = withComments.comments?.data;        // to-many stays enveloped: `.data`
```

The `comments` filter above narrows only the included comments. To return only articles that *have* an approved comment, filter at the top level: `filter: { comments: { _some: { approved: { _eq: true } } } }`. Nested arguments are written `filter`/`limit`, not `_filter`/`_limit`, while operators like `_eq` keep their underscore.

Paginate with `limit` + `offset` and a stable `sort`, since there is no `page` or cursor. When you need the total, follow [the pagination recipe](sdk.md#pagination-with-a-total-count).

## Filter cheat sheet

```ts
{ title: { _icontains: 'monospace' } }                       // case-insensitive contains (there is no `search`)
{ status: { _in: ['draft', 'review'] } }                      // set membership
{ published_at: { _null: false } }                            // not null (nullable fields only)
{ _and: [ { views: { _gte: 100 } }, { featured: { _eq: true } } ] }
{ _or: [ { status: { _eq: 'published' } }, { author_id: { _eq: meId } } ] }
{ comments: { _some: { approved: { _eq: true } } } }          // to-many quantifier (_some/_every/_none)
```
Use the explicit object sort form, because `-field` is rejected. Aggregates don't exist yet: count with `meta: { totalCount: true }`, and compute anything else client-side or in your backend.

## Create

```ts
const created = await client.Articles.createOne({
	data: { title: 'Hello', status: 'draft' },       // one object under `data`
	fields: ['id', 'title'],
});
await client.Articles.createMany({ data: [{ title: 'A' }, { title: 'B' }], fields: ['id'] }); // array under `data`
```

## Relations on write

Link related rows with operations, never a bare id (`author: 7` is rejected). The shape depends on **context and cardinality**:

| | Create context | Update context |
| --- | --- | --- |
| to-one | single object: `author: { _connect: { key: { id: 7 } } }` | **array**: `author: [{ _connect: { key: { id: 7 } } }]` |
| to-many | array: `tags: [{ _connect: { keys: [{ id: 1 }, { id: 3 }] } }]` | array |
| operations | `_connect`, `_create` | also `_update`; `_disconnect` and `_delete` require nullable to-one relations |

`_connect` takes `key` (object) for to-one and `keys` (array) for to-many. Wrapping a to-one in an array on create is rejected. Update operations run in array order. Available operations also depend on generated field capabilities.

```ts
// Create a parent, link an existing row, and create children in one call.
const order = await client.Orders.createOne({
	data: {
		customer: { _connect: { key: { id: customerId } } },
		status: 'draft',
		lines: [{ _create: { data: [
			{ product: { _connect: { key: { id: productId } } }, quantity: 2 },
		] } }],
	},
	fields: ['id'],
	include: { lines: { fields: ['id', 'quantity'] } },
});
// If any nested item is invalid, the whole create fails and no parent row is written.

await client.Articles.updateOne({
	key: 1,
	data: {
		author: [{ _disconnect: {} }, { _connect: { key: { id: 7 } } }],
		tags: [{ _connect: { keys: [{ id: 5 }] } }],
	},
	fields: ['id'],
	include: { author: { fields: ['id'] }, tags: { fields: ['id'] } }, // return the links
});
```

## Update

```ts
await client.Articles.updateOne({ key: 1, data: { status: 'published' }, fields: ['id', 'status'] });
const archived = await client.Articles.updateMany({
	filter: { status: { _eq: 'draft' } },              // the user's filter, unchanged
	data: { status: 'archived' },
	fields: ['id', 'status'],
});
```
Update inputs make every field optional, so send only what changes.

## Delete

```ts
// Always pass a selection. Without one, the audited engine returns 422 and deletes nothing.
const removed = await client.Articles.deleteOne({ key: 1, fields: ['id'] });
const removedMany = await client.Articles.deleteMany({ filter: { status: { _eq: 'archived' } }, fields: ['id'] });

// Verify with the same filter.
const left = await client.Articles.readMany({ fields: ['id'], filter: { status: { _eq: 'archived' } } });
```
If related rows block the delete, inspect the dependency. Remove or disconnect them only when that is part of the requested operation; otherwise report the blocker. Each related delete also needs `fields`.

## Money and large integers

- 64-bit integer fields come back as **strings**. Store integer cents in them and pass values as strings when they may exceed the safe integer range: `priceCents: '9007199254740993'`. Sum with `BigInt`, not `Number`.
- Decimal fields come back as strings (for example `'0.1'`); trailing zeros need not be preserved. Format display amounts separately. Keep values as strings or parse them with a decimal library.
- Choose one representation per field (decimal amount *or* integer minor units) and don't mix them. Type and operator support also varies by connector.

## Raw REST equivalents

```bash
H=(-H "Authorization: Bearer $MONOSPACE_API_KEY" -H "Content-Type: application/json")
B="https://YOUR_HOST/api/YOUR_WORKSPACE/items/Articles"

curl --globoff -sS "${H[@]}" "$B?fields=id,title&filter[status][_eq]=published&sort[0][id][direction]=asc&limit=20&meta=totalCount"
curl --globoff -sS "${H[@]}" -X POST "$B?fields=id" -d '{"title":"Hello"}'                  # → { "data": [ { "id": … } ] }
curl --globoff -sS "${H[@]}" -X PATCH "$B/1?fields=id,status" -d '{"status":"published"}'   # → { "data": { … } }
curl --globoff -sS "${H[@]}" -X DELETE "$B/1?fields=id"                                     # selection required
curl --globoff -sS "${H[@]}" "$B/1?fields=id"                                               # verify: expect 404
```
