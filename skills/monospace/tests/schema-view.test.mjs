import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { schemaView } from '../scripts/schema-view.mjs';

const script = fileURLToPath(new URL('../scripts/schema-view.mjs', import.meta.url));

// Independent wire-format fixture: no engine, network, or SDK installation required.
function fixture() {
  const strings = [];
  const s = (name) => { let i = strings.indexOf(name); if (i < 0) i = strings.push(name) - 1; return i; };
  const g = { operations: [], inputFields: [], outputFields: [], inputObjectTypes: [], outputObjectTypes: [], enumTypes: [] };
  const input = (fields, constraints) => {
    const index = g.inputObjectTypes.length;
    g.inputObjectTypes.push({ fields: Object.entries(fields).flatMap(([name, value]) => [s(name), g.inputFields.push(value) - 1]),
      ...(constraints ? { constraints: constraints.map(s) } : {}) });
    return `i${index}`;
  };
  const eq = input({ _eq: { type: 'p0' }, _in: { type: '[p0]' } });
  const filter = input({ id: { type: eq, kind: 'primitive', optional: true }, _and: { type: '[i1]', optional: true } });
  const connect = input({ key: { type: 'p0', aliasOf: s('id') } });
  const rel = input({ _connect: { type: connect } }, ['atMostOneField']);
  const data = input({ id: { type: 'p0', kind: 'primitive', optional: true, hasDefault: true }, children: { type: `[${rel}]`, kind: 'relation', optional: true } });
  const read = input({ filter: { type: filter, optional: true }, limit: { type: 'p0', optional: true } });
  const create = input({ data: { type: `[${data}]`, secondaryTypes: [data] } });
  g.outputFields.push({ type: 'p0' }, { type: '[o0]', arguments: Number(read.slice(1)) });
  g.outputObjectTypes.push({ fields: [s('id'), 0, s('children'), 1] });
  g.operations.push(['readMany', s('Node'), Number(read.slice(1)), '[o0]'], ['create', s('Node'), Number(create.slice(1)), '[o0]']);
  return {
    formatVersion: 1, strings, primitiveTypes: [{ name: 'int64' }], querySchema: g,
    monospaceSchema: {
      sources: [{ id: 'source', name: s('db'), provider: s('postgres') }],
      namespaces: [{ id: 'ns', dbName: s('public'), source: 0 }],
      collections: [
        { id: 'nodes', apiName: s('Node'), source: 0, namespace: 0,
          primitiveFields: [{ id: 'id', apiName: s('id'), type: 0, defaultValue: { source: 'literal', value: '9007199254740993' } }],
          relationFields: [{ id: 'children', apiName: s('children'), oppositeCollection: 0, oppositeField: 0, isList: true, linkingFields: [[0, 0]] }],
          indexes: [{ id: 'pk', dbName: s('Node_pk'), kind: 'primary', fields: [0] }] },
        { id: 'system', apiName: s('MonospaceInternal'), source: 0, isSystem: true, primitiveFields: [], relationFields: [] },
      ],
    },
  };
}

test('summary excludes system collections unless requested', () => {
  assert.deepEqual(schemaView(fixture()).collections, [{ name: 'Node', fields: 1, relations: 1, operations: ['readMany', 'create'] }]);
  assert.equal(schemaView(fixture(), { system: true }).collections.length, 2);
});

test('detail resolves types, keys, defaults, relation targets and operation capabilities', () => {
  const { collection: c } = schemaView(fixture(), { collection: 'Node' });
  assert.equal(c.source.provider, 'postgres');
  assert.equal(c.namespace.dbName, 'public');
  assert.equal(c.fields[0].defaultValue.value, '9007199254740993');
  assert.deepEqual(c.fields[0].type, { name: 'int64' });
  assert.deepEqual(c.indexes[0].fields, ['id']);
  assert.deepEqual(c.primaryKey, ['id']);
  assert.deepEqual(c.capabilities[0].arguments.limit.primitive, { name: 'int64' });
  assert.equal(c.capabilities[0].arguments.limit.nullable, false);
  assert.deepEqual(c.capabilities[1].writableFields.children.constraints, ['atMostOneField']);
  assert.equal(c.relations[0].target, 'Node');
  assert.deepEqual(c.relations[0].linkingFields, [{ local: 'id', target: 'id' }]);
  assert.deepEqual(c.capabilities[0].filter.id.members, ['_eq', '_in']);
  assert.deepEqual(c.capabilities[1].writableFields.children.operations, ['_connect']);
  assert.equal(c.capabilities[1].writableFields.id.hasDefault, true);
});

test('query view terminates on cycles and includes secondary types and relation arguments', () => {
  const view = schemaView(fixture(), { collection: 'Node', query: true });
  assert.equal(view.queryTypes.o0.fields.children.type, '[o0]');
  assert.equal(view.queryTypes.i1.fields._and.type, '[i1]');
  assert.deepEqual(view.queryTypes.i3.constraints, ['atMostOneField']);
  assert.equal(view.queryTypes.i2.fields.key.aliasOf, 'id');
  assert.equal(Object.keys(view.queryTypes).length, 9);
});

for (const [name, mutate, expected] of [
  ['bad boolean', (d) => { d.monospaceSchema.collections[0].isSystem = 'false'; }, /expected a boolean/],
  ['null collection', (d) => { d.monospaceSchema.collections[0] = null; }, /expected an object/],
  ['future format', (d) => { d.formatVersion = 2; }, /Unsupported.*formatVersion/],
  ['bad string', (d) => { d.monospaceSchema.sources[0].name = 999; }, /invalid reference/],
  ['fractional index', (d) => { d.monospaceSchema.collections[0].primitiveFields[0].type = 0.5; }, /invalid reference/],
  ['dangling relation', (d) => { d.monospaceSchema.collections[0].relationFields[0].oppositeField = 99; }, /invalid reference/],
  ['bad hidden query ref', (d) => { d.querySchema.inputFields.push({ type: 'i999' }); }, /invalid reference/],
  ['invalid grammar', (d) => { d.querySchema.inputFields[0].type = '[p0??]'; }, /Invalid type reference/],
  ['odd tuple stride', (d) => { d.querySchema.inputObjectTypes[0].fields.pop(); }, /stride-2/],
]) test(`rejects ${name} without partial output`, () => {
  const d = fixture(); mutate(d);
  assert.throws(() => schemaView(d), expected);
});

test('handles prototype-like schema names as data', () => {
  const d = fixture(); d.strings[d.strings.indexOf('id')] = '__proto__';
  const view = schemaView(d, { collection: 'Node', query: true });
  assert.ok(Object.hasOwn(view.queryTypes.o0.fields, '__proto__'));
  assert.equal(view.collection.capabilities[0].filter.__proto__.kind, 'primitive');
});

test('CLI supports stdin and emits errors to stderr with a failing status', () => {
  const ok = spawnSync(process.execPath, [script, '-', '--collection', 'Node'], { input: JSON.stringify(fixture()), encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).collection.name, 'Node');
  for (const [args, input] of [[['-'], '{bad'], [['-', '--collection', 'Absent'], JSON.stringify(fixture())], [['-', '--query'], JSON.stringify(fixture())], [['--wat'], '']]) {
    const bad = spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout, '');
    assert.match(bad.stderr, /schema-view:/);
  }
});


test('shows operation-specific outputs, filter constraints and restricted sort directions', () => {
  const d = fixture();
  const g = d.querySchema;
  const s = (name) => { let i = d.strings.indexOf(name); if (i < 0) i = d.strings.push(name) - 1; return i; };
  g.outputObjectTypes.push({ fields: [s('id'), 0] });
  g.operations.push(['readOne', s('Node'), 5, 'o1']);
  g.inputObjectTypes[0].constraints = [s('atMostOneField')];
  g.inputObjectTypes[1].constraints = [s('atMostOneField')];
  g.enumTypes.push([s('desc')]);
  const direction = g.inputFields.push({ type: 'e0' }) - 1;
  const sortItem = g.inputObjectTypes.push({ fields: [s('direction'), direction] }) - 1;
  const sortField = g.inputFields.push({ type: `i${sortItem}` }) - 1;
  const sortType = g.inputObjectTypes.push({ fields: [s('id'), sortField], constraints: [s('atMostOneField')] }) - 1;
  const sortArg = g.inputFields.push({ type: `[i${sortType}]`, optional: true }) - 1;
  g.inputObjectTypes[5].fields.push(s('sort'), sortArg);
  const ops = schemaView(d, { collection: 'Node' }).collection.capabilities;
  const read = ops.find((o) => o.operation === 'readMany');
  assert.deepEqual(Object.keys(read.outputFields), ['id', 'children']);
  assert.deepEqual(Object.keys(ops.find((o) => o.operation === 'readOne').outputFields), ['id']);
  assert.deepEqual(read.filterConstraints, ['atMostOneField']);
  assert.deepEqual(read.filter.id.constraints, ['atMostOneField']);
  assert.deepEqual(read.sortConstraints, ['atMostOneField']);
  assert.deepEqual(read.sorting.id.arguments.direction.values, ['desc']);
  assert.equal(read.sorting.id.arguments.direction.optional, false);
});

test('runs when installed through a symlink', () => {
  const dir = mkdtempSync(join(tmpdir(), 'schema-view-'));
  try {
    const link = join(dir, 'schema-view.mjs');
    symlinkSync(script, link);
    const run = spawnSync(process.execPath, [link, '--help'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /Usage:/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
