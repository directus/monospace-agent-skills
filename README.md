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

**Monospace Agent Skills** is the official [Agent Skills](https://agentskills.io) bundle for [Monospace](https://monospace.io). It gives AI coding agents the knowledge to work with a real Monospace instance: query and mutate data through the REST API or the typed `@monospace/sdk`, generate a client typed to *your* instance's schema, and connect to the Monospace MCP server — correctly, from the first try.

Agents don't have Monospace in their training data, so left alone they guess. This bundle gives them the ground truth: the query engine, the `{ data }` response shape, the real auth and endpoints, the silent-failure traps, and the one-command path to fully-typed SDK calls.

> [!NOTE]
> Monospace is currently in **_early access_**. APIs and developer workflows may change between releases, and this bundle tracks them. Pin a version if you need stability.

## What it covers

- **REST API** — the query engine (fields, filters, sort, pagination, deep relations), the response envelope, auth, and error shapes.
- **SDK** — `createClient`, the typed per-collection delegate API, and **codegen**: generate types from your instance's live OpenAPI so every query is type-checked against your real schema.
- **Data workflows** — copy-pasteable read / create / update / delete recipes, with the easy-to-miss traps called out.
- **MCP** — how to connect an agent to your instance's MCP server, the tools it exposes, and how to authenticate.

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

The Monospace MCP server is served **by your own engine, per project**, so the URL is instance-specific. Point your agent at it:

```jsonc
// .mcp.json (project root)
{
  "mcpServers": {
    "monospace": {
      "type": "http",
      "url": "https://YOUR_HOST/api/YOUR_PROJECT/mcp",
      "headers": { "Authorization": "Bearer ${MONOSPACE_API_KEY}" }
    }
  }
}
```

1. Create an API key in the Monospace Studio under **Account → Access → API Keys** (`/account/access#api-keys`) — or use a user access token. Both are JWTs.
2. Put it in `MONOSPACE_API_KEY` so it isn't committed.
3. Ensure the project has the `ai:mcp` entitlement; tools then run under the key's permissions.

The skill includes the full tool list and a troubleshooting guide — see [`skills/monospace/references/mcp-and-auth.md`](skills/monospace/references/mcp-and-auth.md).

## What's inside

```
skills/monospace/
  SKILL.md                 # entry point: principles, traps, MCP setup, codegen
  references/
    rest-api.md            # query engine, envelope, endpoints, errors
    sdk.md                 # createClient, typed delegates, codegen workflow
    data-workflows.md      # CRUD recipes with the traps annotated
    mcp-and-auth.md        # MCP tools, API keys, auth modes, .mcp.json
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
