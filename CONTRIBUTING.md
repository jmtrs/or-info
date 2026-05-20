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
- `npm run test:online:smoke` for the live smoke suite used by `npm test`
- `npm run test:online` for the full OpenRouter/HuggingFace integration suite

`npm test` is intentionally not hermetic: it keeps real online validation for CLI and MCP,
while isolating each suite with `OR_INFO_CONFIG_DIR` and `OR_INFO_CACHE_DIR` so prior machine
state does not create false greens. The heavier edge-case online suite is split out so CI can
keep at least one live smoke run per platform without amplifying third-party rate limits.

Tests use Node.js built-in `node:test` — no extra test runner needed.

## Release process

1. Update `CHANGELOG.md`.
2. Bump version in `package.json`.
3. Commit and push.
4. Create a tag: `git tag v0.x.0 && git push --tags`.
5. GitHub Actions publishes to npm automatically.
