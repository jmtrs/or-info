# Contributing to or-info

## Data sources

ELO ranking data is fetched automatically from
[lmarena-ai/leaderboard-dataset](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset)
on HuggingFace. There is no manually maintained benchmark file — if a model is missing from
the rankings it means LMArena hasn't tracked it yet.

## Adding MCP tools

1. Add the tool definition to the `TOOLS` array in `mcp/server.mjs`.
2. Add the handler branch inside `handleTool()`.
3. Add a test in `test/`.
4. Document the new tool in `README.md`.

The Smithery MCPB bundle does **not** declare tools in `manifest.json` — Smithery
discovers them at scan time by launching the bundle. Just adding them to
`mcp/server.mjs` is enough.

## Adding CLI commands

1. Add a `.command()` call in `bin/or-info.mjs`.
2. If the command needs a new data source, add a module in `lib/`.
3. Add tests in `test/`.

## Adding a new live data source

`lib/lmarena.mjs` is the reference implementation for a live data source:

- Fetch from a public HTTP endpoint (no auth required preferred)
- Resolve config/cache paths through `lib/paths.mjs`
- Cache in the native cache directory for the current OS using the helpers in `lib/cache.mjs`
- Export a `getX(orModelId)` function that returns `null` when the model is not found
- Write unit tests that mock the network call

## Running tests

```bash
npm test
```

Useful variants:

- `npm run test:local` for deterministic local coverage
- `npm run test:online:smoke` for the live smoke suite used by CI as a non-blocking signal
- `npm run test:online` for the full OpenRouter/HuggingFace integration suite

`npm test` intentionally runs only deterministic local tests. Live online validation is split
out because it depends on OpenRouter and HuggingFace availability and can hit third-party
rate limits. Online suites isolate state with `OR_INFO_CONFIG_DIR` and `OR_INFO_CACHE_DIR`.

Tests use Node.js built-in `node:test` — no extra test runner needed.

## Release process

The package is published as `@aggc/or-info`; the installed executable is `or-info`.

1. Update `CHANGELOG.md`.
2. Bump `version` in `package.json` **and** `manifest.json` (they must match).
3. Run `npm test`.
4. Commit and push to `main`.
5. Create and push a version tag: `git tag v0.x.0 && git push origin v0.x.0`.
6. GitHub Actions publishes to npm with provenance, builds the MCPB bundle and
   publishes it to Smithery.

Release automation requires two repository secrets:

- `NPM_TOKEN` — publish permission for `@aggc/or-info` (after bootstrap, prefer
  npm Trusted Publishing and remove this secret).
- `SMITHERY_API_KEY` — API key from https://smithery.ai (used by
  `@smithery/cli mcp publish`).

## Smithery MCPB bundle

Local build:

```bash
npm run build:mcpb
```

Outputs `or-info.mcpb` (~3 MB) at the repo root. Contents: `manifest.json`,
`bin/`, `lib/`, `mcp/`, production-only `node_modules/`. The script stages files
in `.mcpb-build/` so devDependencies and `test/` never make it into the bundle.

Both the staging dir and the bundle itself are gitignored.

Manual publish (only needed when bootstrapping Smithery, not per release):

```bash
SMITHERY_API_KEY=... \
  npx --yes --package=@smithery/cli@latest \
  smithery mcp publish ./or-info.mcpb -n aggc/or-info
```
