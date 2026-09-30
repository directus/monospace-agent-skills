<p align="center">
  <picture style="display:block;">
    <source width="400" media="(prefers-color-scheme: light)" srcset="https://github.com/user-attachments/assets/27299ab8-c2a3-45d8-bf65-e830adefb454">
    <source width="400" media="(prefers-color-scheme: dark)" srcset="https://github.com/user-attachments/assets/fd1b456b-ca81-4ce1-a9a3-3285e16d7088">
    <img alt="Monospace" src="https://github.com/user-attachments/assets/fd1b456b-ca81-4ce1-a9a3-3285e16d7088">
  </picture>
</p>

<h1 align="center">Monospace Agent Skills</h1>

<p align="center">
  Teach your AI coding agent to drive Monospace — its REST API, typed SDK, and MCP server.
</p>

<p align="center">
  <a href="https://monospace.io">Website</a> • <a href="https://docs.monospace.io">Documentation</a> • <a href="https://agentskills.io">Agent Skills standard</a>
</p>

---

## Overview

**Monospace Agent Skills** is the official [Agent Skills](https://agentskills.io) bundle for [Monospace](https://monospace.io). It gives AI coding agents what they need to work with a real Monospace instance: query and mutate data through the REST API or the typed `@monospace/sdk`, generate a client typed to *your* instance's schema with `@monospace/cli`, bootstrap workspaces and discover schema, and connect to the Monospace MCP server.

This bundle documents the query engine, per-endpoint response envelopes, real auth and management routes, the traps that fail quietly, and the CLI path to fully typed SDK calls.

> [!NOTE]
> Monospace is currently in **_early access_**. APIs and developer workflows may change between releases. The current guidance was verified against engine source `4f6f48c` (reports `0.7.0`) with `@monospace/sdk` `0.8.0` and `@monospace/cli` `0.1.0` from continuous build `31d52d0`. The engine and package versions are independent, so pin the SDK/CLI pair you have tested against your engine.

Relation queries use recursive `include` objects, while `fields` selects scalars.
See the [query guide](skills/monospace/references/rest-api.md#query-engine) for selection, filtering, and pagination.

## What it covers

- **REST API**: the query engine (scalar fields, recursive includes, filters, sort, pagination, aliases), response envelopes by endpoint, value encoding (64-bit integers as strings), and error and status codes.
- **SDK + CLI**: `createClient`, the typed per-collection delegate API, pagination with a total count, browser auth, and **codegen** with `monospace sdk generate`, so every query is type-checked against your real schema.
- **Data workflows**: copy-pasteable read / create / update / delete recipes, relation writes, and read-back verification, with the traps called out.
- **Bootstrap and schema**: instance and license preflight, workspace creation, and schema discovery routes that OpenAPI doesn't list.
- **Auth and MCP**: login, API-key authority, the MCP server's tools, and how to diagnose connection problems.

## Install

### Claude Code (plugin marketplace)

```bash
claude plugin marketplace add directus/monospace-agent-skills
claude plugin install monospace@monospace-agent-skills
```

### Other agents (via the skills CLI)

```bash
npx skills add directus/monospace-agent-skills
```

### Manually

Copy `skills/monospace/` into your agent's skills directory — for Claude Code that's `.claude/skills/` (project) or `~/.claude/skills/` (global). On claude.ai, zip the `skills/monospace/` folder and upload it under **Settings → Skills**.

## Connect the Monospace MCP server

The Monospace MCP server is served **by your own engine, per workspace**, so the URL is instance-specific. Point your agent at it:

```jsonc
// .mcp.json (project root)
{
  "mcpServers": {
    "monospace": {
      "type": "http",
      "url": "https://YOUR_HOST/api/YOUR_WORKSPACE/mcp",
      "headers": { "Authorization": "Bearer ${MONOSPACE_API_KEY}" }
    }
  }
}
```

1. Create an API key in the Monospace Studio under **Account → Access → API Keys**, or use a user access token. An API key acts as the user it belongs to: it has exactly that user's permissions and has no separate scope.
2. Put it in `MONOSPACE_API_KEY` so it isn't committed.
3. Make sure that user has the `ai:mcp` entitlement in the workspace. Every tool call is then checked against the user's permissions. A tool appearing in the list doesn't mean the user can run it.

For Codex, use the commented template in [`.codex/config.toml`](.codex/config.toml). The skill includes the full tool list and an `initialize`-based troubleshooting guide: see [`skills/monospace/references/mcp-and-auth.md`](skills/monospace/references/mcp-and-auth.md).

## What's inside

```
skills/monospace/
  SKILL.md                    # entry point: principles, traps, MCP setup, codegen
  references/
    sdk.md                    # packages/pins, CLI codegen, createClient, browser auth, types, errors
    data-workflows.md         # CRUD + relation-write recipes with the traps annotated
    rest-api.md               # query engine, envelopes, value encoding, item routes, status codes
    bootstrap-and-schema.md   # info/license preflight, workspaces, schema discovery, migrations
    mcp-and-auth.md           # login, API-key authority, license preflight, MCP tools + diagnostics
.mcp.json                  # per-instance MCP config template
.codex/config.toml         # Codex MCP server config template
.claude-plugin/            # Claude Code plugin marketplace manifest
```

Built on the [Agent Skills open standard](https://agentskills.io): a `SKILL.md` whose description triggers it at the right moment, a concise body that routes to reference files loaded on demand, and the critical traps kept inline so an agent never misses them.

## Compatibility

Authored for Claude Code and the [Agent Skills open standard](https://agentskills.io), so it also works with other agents that support the standard. The `npx skills add` command installs across agents that the [skills CLI](https://agentskills.io) supports.

## Contributing

Issues and PRs welcome. Keep `SKILL.md` lean (it loads on every trigger), put depth in `references/`, and ground every claim in the actual Monospace API or SDK rather than memory.

## License

[MIT](LICENSE) © Monospace Inc.
