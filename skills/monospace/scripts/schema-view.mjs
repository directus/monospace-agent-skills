#!/usr/bin/env node
// Schema manifest v1, verified against directus/monospace 4f6f48c.
// Reference: Studio's decode-schema-manifest.ts and query-schema.ts.
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const HELP = `Usage: node schema-view.mjs <schema.json|-> [--collection <apiName>] [--query] [--system]

Read a saved GET /api/<workspace>/schema response, or JSON from stdin (-).
Default: compact user-collection summary. --collection: fields, keys, relations,
and per-operation capabilities. --query adds the reachable, decoded query graph
(requires --collection). --system includes system collections in the summary.
Output is JSON. This tool makes no network requests and needs no dependencies.
API capabilities describe schema support, not the caller's permissions.
Type refs use i/o/e/p for input/output/enum/primitive, [] for lists, ? for
nullable. Primitive/enum details are inline; --query resolves object refs.
`;

function fail(message) { throw new Error(message); }
function array(value, label) {
  if (!Array.isArray(value)) fail(`${label}: expected an array`);
  return value;
}
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}: expected an object`);
  for (const key of ['isSystem', 'isNullable', 'isList', 'isReadonly', 'isForward', 'optional', 'hasDefault']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') fail(`${label}.${key}: expected a boolean`);
  }
  return value;
}
function at(pool, index, label) {
  if (!Number.isSafeInteger(index) || index < 0 || index >= pool.length) fail(`${label}: invalid reference ${index}`);
  return pool[index];
}

export function schemaView(document, { collection, query = false, system = false } = {}) {
  object(document, 'manifest');
  if (document.formatVersion !== 1) fail(`Unsupported schema manifest formatVersion ${document.formatVersion}; supported: 1`);
  if (query && !collection) fail('--query requires --collection');
  const strings = array(document.strings, 'strings');
  strings.forEach((value, i) => { if (typeof value !== 'string') fail(`strings[${i}]: expected a string`); });
  const str = (index) => at(strings, index, 'string');
  const primitives = array(document.primitiveTypes, 'primitiveTypes');
  const model = object(document.monospaceSchema, 'monospaceSchema');
  const sources = array(model.sources, 'sources');
  const namespaces = array(model.namespaces, 'namespaces');
  const collections = array(model.collections, 'collections');
  const graph = object(document.querySchema, 'querySchema');
  const pools = { p: primitives, i: array(graph.inputObjectTypes, 'inputObjectTypes'), o: array(graph.outputObjectTypes, 'outputObjectTypes'), e: array(graph.enumTypes, 'enumTypes') };
  const inputs = array(graph.inputFields, 'inputFields');
  const outputs = array(graph.outputFields, 'outputFields');
  const operations = array(graph.operations, 'operations');

  // Parse wrappers rather than expanding types: query graphs may contain cycles.
  function typeRef(ref) {
    if (typeof ref !== 'string') fail(`Invalid type reference ${ref}`);
    let cursor = 0;
    function parse() {
      let base;
      if (ref[cursor] === '[') {
        cursor++;
        base = parse();
        if (ref[cursor++] !== ']') fail(`Invalid type reference ${ref}`);
      } else {
        const match = /^[ioep](0|[1-9][0-9]*)/.exec(ref.slice(cursor));
        if (!match) fail(`Invalid type reference ${ref}`);
        base = match[0];
        cursor += base.length;
        at(pools[base[0]], Number(base.slice(1)), `type ${base[0]}`);
      }
      if (ref[cursor] === '?') cursor++;
      return base;
    }
    const base = parse();
    if (cursor !== ref.length) fail(`Invalid type reference ${ref}`);
    return base;
  }
  function pairs(type, pool) {
    const fields = array(object(type, 'query object').fields, 'query object fields');
    if (fields.length % 2) fail('query object fields: expected stride-2 name/field pairs');
    const result = [];
    const seen = new Set();
    for (let i = 0; i < fields.length; i += 2) {
      const name = str(fields[i]);
      if (seen.has(name)) fail(`Duplicate query field ${name}`);
      seen.add(name);
      result.push([name, at(pool, fields[i + 1], 'query field')]);
    }
    return result;
  }
  function inputFields(ref) {
    const base = typeRef(ref);
    return base[0] === 'i' ? pairs(pools.i[Number(base.slice(1))], inputs) : [];
  }
  function constraints(ref) {
    const base = typeRef(ref);
    return base[0] === 'i' ? (pools.i[Number(base.slice(1))].constraints ?? []).map(str) : [];
  }
  function typeShape(ref) {
    const base = typeRef(ref);
    const value = pools[base[0]][Number(base.slice(1))];
    return { type: ref, nullable: ref.endsWith('?'), list: ref.startsWith('['),
      ...(base[0] === 'p' ? { primitive: value } : {}),
      ...(base[0] === 'e' ? { values: value.map(str) } : {}),
    };
  }
  function fieldShape(field) {
    return { ...typeShape(field.type), optional: field.optional ?? false,
      ...(field.kind === undefined ? {} : { kind: field.kind }),
      ...(field.aliasOf === undefined ? {} : { aliasOf: str(field.aliasOf) }),
      ...(field.secondaryTypes === undefined ? {} : { secondaryTypes: field.secondaryTypes }),
      ...(field.hasDefault === undefined ? {} : { hasDefault: field.hasDefault }) };
  }

  // Validate all references, including pools hidden by a collection selection.
  primitives.forEach((p) => object(p, 'primitive type'));
  sources.forEach((s) => { object(s, 'source'); str(s.name); str(s.provider); });
  namespaces.forEach((n) => { object(n, 'namespace'); str(n.dbName); at(sources, n.source, 'namespace source'); });
  const names = new Set();
  collections.forEach((c) => {
    object(c, 'collection');
    const name = str(c.apiName);
    if (names.has(name)) fail(`Duplicate collection ${name}`);
    names.add(name);
    if (c.dbName !== undefined) str(c.dbName);
    at(sources, c.source, 'collection source');
    if (c.namespace !== undefined) at(namespaces, c.namespace, 'collection namespace');
    array(c.primitiveFields, 'primitiveFields').forEach((f) => {
      object(f, 'primitive field');
      str(f.apiName);
      if (f.dbName !== undefined) str(f.dbName);
      at(primitives, f.type, 'primitive type');
    });
    array(c.relationFields, 'relationFields').forEach((r) => {
      object(r, 'relation field');
      str(r.apiName);
      const target = at(collections, r.oppositeCollection, 'opposite collection');
      at(array(target.relationFields, 'opposite relationFields'), r.oppositeField, 'opposite field');
      array(r.linkingFields, 'linkingFields').forEach((pair) => {
        if (!Array.isArray(pair) || pair.length !== 2) fail('linkingFields: expected pairs');
        at(c.primitiveFields, pair[0], 'local linking field');
        at(array(target.primitiveFields, 'target primitiveFields'), pair[1], 'target linking field');
      });
      if (r.constraint) str(r.constraint.dbName);
    });
    array(c.indexes ?? [], 'indexes').forEach((idx) => {
      object(idx, 'index');
      str(idx.dbName);
      array(idx.fields, 'index fields').forEach((f) => at(c.primitiveFields, f, 'index field'));
    });
  });
  inputs.forEach((f) => {
    object(f, 'input field'); typeRef(f.type);
    if (f.aliasOf !== undefined) str(f.aliasOf);
    array(f.secondaryTypes ?? [], 'secondaryTypes').forEach(typeRef);
  });
  outputs.forEach((f) => {
    object(f, 'output field'); typeRef(f.type);
    if (f.arguments !== undefined) at(pools.i, f.arguments, 'output arguments');
  });
  pools.i.forEach((t) => {
    pairs(t, inputs);
    array(t.constraints ?? [], 'constraints').forEach(str);
  });
  pools.o.forEach((t) => pairs(t, outputs));
  pools.e.forEach((e) => array(e, 'enum').forEach(str));
  operations.forEach((op) => {
    if (!Array.isArray(op) || op.length !== 4 || typeof op[0] !== 'string') fail('Invalid operation tuple');
    str(op[1]); at(pools.i, op[2], 'operation arguments'); typeRef(op[3]);
  });

  const opsFor = (name) => operations.filter((op) => str(op[1]) === name);
  const header = { formatVersion: 1, capabilitiesArePermissions: false };
  if (collection === undefined) {
    return { ...header, collections: collections.filter((c) => system || !c.isSystem).map((c) => ({
      name: str(c.apiName), fields: c.primitiveFields.length, relations: c.relationFields.length,
      operations: opsFor(str(c.apiName)).map((op) => op[0]),
    })) };
  }
  const c = collections.find((c) => str(c.apiName) === collection);
  if (!c) fail(`Unknown collection ${JSON.stringify(collection)}; run without --collection to list user collections, or add --system`);
  const selectedOps = opsFor(collection);
  const capabilities = selectedOps.map(([kind, , args, output]) => {
    const fields = pairs(pools.i[args], inputs);
    const get = (name) => fields.find(([n]) => n === name)?.[1];
    const filter = get('filter');
    const data = get('data');
    const sort = get('sort');
    const meta = get('meta');
    return {
      operation: kind, arguments: Object.fromEntries(fields.map(([n, f]) => [n, fieldShape(f)])),
      argumentConstraints: constraints(`i${args}`), output,
      outputFields: typeRef(output)[0] === 'o' ? Object.fromEntries(pairs(pools.o[Number(typeRef(output).slice(1))], outputs).map(([n, f]) => [n, {
        ...typeShape(f.type), ...(f.arguments === undefined ? {} : {
          arguments: Object.fromEntries(pairs(pools.i[f.arguments], inputs).map(([n, a]) => [n, fieldShape(a)])),
          argumentConstraints: constraints(`i${f.arguments}`),
        }),
      }])) : {},
      ...(filter ? { filterConstraints: constraints(filter.type), filter: Object.fromEntries(inputFields(filter.type).map(([n, f]) => [n, {
        ...fieldShape(f), constraints: constraints(f.type), members: inputFields(f.type).map(([name]) => name),
      }])) } : {}),
      ...(sort ? { sortConstraints: constraints(sort.type), sorting: Object.fromEntries(inputFields(sort.type).map(([n, f]) => [n, {
        constraints: constraints(f.type), arguments: Object.fromEntries(inputFields(f.type).map(([n, a]) => [n, fieldShape(a)])),
      }])) } : {}),
      ...(meta ? { meta: inputFields(meta.type).map(([n]) => n) } : {}),
      ...(data ? { writeConstraints: constraints(data.type), writableFields: Object.fromEntries(inputFields(data.type).map(([n, f]) => [n, {
        ...fieldShape(f), ...(f.kind === 'relation' ? { constraints: constraints(f.type), operations: inputFields(f.type).map(([name]) => name) } : {}),
      }])) } : {}),
    };
  });
  const result = { ...header, collection: {
    id: c.id, name: collection, dbName: str(c.dbName ?? c.apiName), isSystem: c.isSystem ?? false,
    source: { id: sources[c.source].id, name: str(sources[c.source].name), provider: str(sources[c.source].provider) },
    namespace: c.namespace === undefined ? null : { id: namespaces[c.namespace].id, dbName: str(namespaces[c.namespace].dbName) },
    fields: c.primitiveFields.map((f) => ({
      id: f.id, name: str(f.apiName), dbName: str(f.dbName ?? f.apiName), type: primitives[f.type],
      nullable: f.isNullable ?? false, list: f.isList ?? false, readOnly: f.isReadonly ?? false,
      ...(f.defaultValue === undefined ? {} : { defaultValue: f.defaultValue }),
    })),
    primaryKey: c.indexes?.find((idx) => idx.kind === 'primary')?.fields.map((i) => str(c.primitiveFields[i].apiName)) ?? null,
    indexes: (c.indexes ?? []).map((idx) => ({ id: idx.id, name: str(idx.dbName), kind: idx.kind, fields: idx.fields.map((i) => str(c.primitiveFields[i].apiName)) })),
    relations: c.relationFields.map((r) => {
      const target = collections[r.oppositeCollection];
      return { id: r.id, name: str(r.apiName), target: str(target.apiName), oppositeField: str(target.relationFields[r.oppositeField].apiName),
        list: r.isList ?? false, nullable: r.isNullable ?? false, forward: r.isForward ?? false,
        linkingFields: r.linkingFields.map(([local, opposite]) => ({ local: str(c.primitiveFields[local].apiName), target: str(target.primitiveFields[opposite].apiName) })),
        ...(r.constraint ? { constraint: { ...r.constraint, dbName: str(r.constraint.dbName) } } : {}),
      };
    }),
    capabilities,
  } };

  if (query) {
    // Keep stable pool refs and decode each reachable node once, even with cycles.
    const types = {};
    const pending = selectedOps.flatMap((op) => [`i${op[2]}`, op[3]]);
    const enqueue = (ref) => { pending.push(ref); return ref; };
    for (let index = 0; index < pending.length; index++) {
      const base = typeRef(pending[index]);
      if (Object.hasOwn(types, base)) continue;
      const value = pools[base[0]][Number(base.slice(1))];
      if (base[0] === 'p') types[base] = { kind: 'primitive', ...value };
      else if (base[0] === 'e') types[base] = { kind: 'enum', values: value.map(str) };
      else {
        types[base] = { kind: base[0] === 'i' ? 'input' : 'output',
          fields: Object.fromEntries(pairs(value, base[0] === 'i' ? inputs : outputs).map(([name, f]) => {
            enqueue(f.type);
            const decoded = base[0] === 'i' ? fieldShape(f) : typeShape(f.type);
            f.secondaryTypes?.forEach(enqueue);
            if (f.arguments !== undefined) decoded.arguments = enqueue(`i${f.arguments}`);
            return [name, decoded];
          })),
          ...(value.constraints ? { constraints: value.constraints.map(str) } : {}),
        };
      }
    }
    result.queryTypes = types;
  }
  return result;
}

export function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) { process.stdout.write(HELP); return; }
  let file;
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--collection') {
      if (options.collection !== undefined || !argv[i + 1] || argv[i + 1].startsWith('--')) fail('--collection requires one apiName');
      options.collection = argv[++i];
    } else if (arg === '--query') options.query = true;
    else if (arg === '--system') options.system = true;
    else if (arg.startsWith('-') && arg !== '-') fail(`Unknown option ${arg}`);
    else if (file !== undefined) fail('Expected one input file');
    else file = arg;
  }
  if (!file) fail('Expected a schema.json file or - for stdin. Use --help for usage.');
  const result = schemaView(JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8')), options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.stdout.on('error', (error) => {
    if (error.code === 'EPIPE') process.exit(0);
    process.stderr.write(`schema-view: ${error.message}\n`); process.exit(1);
  });
  try { main(); }
  catch (error) { process.stderr.write(`schema-view: ${error.message}\n`); process.exitCode = 1; }
}
