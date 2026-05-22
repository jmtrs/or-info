# Changelog

## [0.3.1] – 2026-05-22

### Fixed
- `rankModels` null-safe: guard `allElo` parameter with `?.` to prevent crash on missing ELO category.

### Changed
- `manifest.json` synced with `mcp/server.mjs`: `models.top` and `best_for_task` now include `pricing` field and `premium` task enum.
- Eliminated duplicated name-matching logic: `scorer.mjs` now imports `match`/`buildIndex` from `lmarena.mjs` (17 lines removed).
- `lmarena.mjs` leaderboard loading uses promise-based gate to prevent concurrent fetches in HTTP MCP mode.
- `clearAll` now removes stale `.tmp` cache files in addition to `.json`.

## [0.3.0] – 2026-05

### Added
- `compare` now accepts `--task` (coding, reasoning, general) for task-specific ELO.
- `price --json` now includes `elo` field.

## [0.2.19] – 2026-05

### Fixed
- CLI edge tests: `price` command uses `id` field (not `model`).
- CLI edge tests: benchmark/compare/top suites warm up LMArena cache before running.
- CLI/MCP edge tests: all tests hitting LMArena now skip gracefully on 429 instead of failing.
- MCP edge tests: `best_for_task` with empty ELO data skips instead of asserting.
- `parseJson` test helper now tolerates informational text before JSON output (e.g. compare same-model warning).

## [0.2.18] – 2026-05

### Added
- Security policy (`SECURITY.md`) with private vulnerability reporting.
- Issue templates: bug report and feature request.
- Pull request template with checklist.
- `CODEOWNERS` file for default review ownership.
- Custom labels: `mcp`, `cli`, `models`, `dependencies`, `semver:patch`, `semver:minor`, `semver:major`.
- Repository topics: `openrouter`, `mcp`, `cli`, `llm`, `pricing`, `benchmarks`, `ai-models`.
- GitHub Discussions enabled.
- Branch protection on `main` (1 review, stale dismissal, conversation resolution).
- Auto-merge and delete-branch-on-merge enabled.
- Secret scanning with push protection enabled.

### Changed
- Release section in README replaced with link to `CHANGELOG.md`.
- Full release process moved to `RELEASE.local.md` (gitignored).
- Wiki and Projects disabled (unused).

### Fixed
- `isFree()` now only returns `true` for models with the `:free` suffix or
  `openrouter/free`. OpenRouter's API reports `pricing="0"` for some
  non-free models (e.g. `z-ai/glm-5.1`) — these are no longer listed as
  free in `--free` / `free_only` filters.
- `price` detail view shows a `⚠ reported free — may incur charges` warning
  for models with zero pricing that lack the `:free` suffix.
- Models table shows a `⚠` marker next to IDs with suspicious zero pricing.
- Online smoke tests now skip gracefully on transient network errors (429, 502,
  timeout, etc.) instead of hard-failing. Affects `benchmark`, `compare`,
  `top`, and `refresh` CLI tests and the MCP `refresh_cache` test.
- `warmUpBenchmarksCache` now falls back to `or-info refresh` when no local
  cache exists (the CI case), so HuggingFace is hit once per suite instead of
  once per test — reduces 429 throttling on CI.

## [0.2.15] – 2026-05

### Fixed
- ELO/LMArena failures are now non-fatal in the MCP server: `getElo` and
  `getAllElo` errors are caught and return `null`/`{}` instead of propagating
  `isError: true` to the caller. Tools still return model data with
  `lmarena_elo: null` when HuggingFace is unavailable (e.g. CI 429 throttling).
- Online smoke tests: `best_for_task` assertions skip gracefully when ELO data
  is unavailable rather than failing the test run.

## [0.2.14] – 2026-05

### Added
- `--pricing <mode>` flag for `top` command (`standard`, `cheap`, `premium`).
  Decouples the price-penalty strategy from the task type, so combinations like
  `top --task coding --pricing premium` (best coder regardless of price) now work.
- `pricing` parameter in `models.top` MCP tool with the same three values.
- Second deduplication pass in `rankModels`: when multiple OpenRouter models
  match the same LMArena entry, only the highest-scoring one is kept.

### Changed
- `scoreForTask` and `rankModels` accept an explicit `pricing` argument that
  overrides the default derived from the task name. Task names `cheap` and
  `premium` still set their respective modes as before (backwards-compatible).

## [0.2.13] – 2026-05

### Added
- New `premium` task type for `top --task premium` and `models.top`: ranks
  purely by LMArena ELO, ignoring price. Useful when quality is the only
  constraint.
- Context window bonus in the scorer: models with ≥128k context get a small
  multiplier vs. smaller-context models, reflecting their practical advantage
  on long inputs.

### Changed
- ELO normalisation range widened from [1050–1500] to [1000–1600] to better
  spread current frontier model scores.
- `cheap` task now uses a steeper logarithmic penalty curve that more
  aggressively favours free/near-free models over expensive ones.
- `coding` task no longer hard-filters out models that lack tool-call support;
  those models now receive a 0.85 soft penalty instead of being excluded.
  This surfaces capable no-tools models while still ranking them lower.
- `rankModels` deduplicates `:free` and paid variants of the same base model,
  keeping only the highest-scoring variant per base ID.

## [0.2.12] – 2026-05

### Fixed
- `findModel` now resolves dot/hyphen variants in version numbers, so
  `anthropic/claude-sonnet-4-5` correctly finds `anthropic/claude-sonnet-4.5`.
  Exact match is tried first; the normalised fallback only runs on miss.

## [0.2.11] – 2026-05

### Fixed
- `top --task coding` and `top --task reasoning` now use task-specific LMArena
  ELO categories (`coding` and `math` respectively) instead of always ranking
  by 'overall'. Results for these tasks will differ from `general`.
- LMArena fetcher downloads only the three categories the app uses (`overall`,
  `coding`, `math`) — roughly 12 pages instead of ~89 — reducing HuggingFace
  429 errors significantly.
- Cache schema migration: old `entries`-keyed cache is silently ignored on first
  load and rebuilt under the new `byCategory` schema.
- `compare <a> <b>` now prints a warning when both IDs resolve to the same model.
- Test suite: `warmUpBenchmarksCache` helper copies the real local cache into
  each isolated test env so most online tests skip the HuggingFace download;
  `refresh` test is 429-tolerant.

## [0.2.10] – 2026-05

### Fixed
- `top --task vision` was returning non-vision models when the capability filter
  interacted with the scorer; filter is now applied before scoring.
- MCP server race condition: parallel tool calls on a cold cache could each
  trigger a separate network fetch; serialised behind a single in-flight promise.
- `price --json` output field renamed `model` → `id` to match `models --json`.

## [0.2.9] – 2026-05

### Added
- HTTP transport (Streamable HTTP) via `startHttpMcp()` in `mcp/server.mjs`.
  Reads `PORT` env var (default 8000), stateless sessions, bridges
  `api_key`/`API_KEY` → `OPENROUTER_API_KEY` for external hosters.

### Changed
- Version read dynamically from `package.json` in both `mcp/server.mjs`
  and `bin/or-info.mjs` (was hardcoded `0.1.5`).

## [0.2.8] – 2026-05

### Changed
- MCP tools renamed to dot-notation: `models.get`, `models.list`, `models.compare`,
  `models.top`, `benchmarks.get`, `cache.refresh`. Forms a navigable tree as
  expected by registries (Smithery).
- Old flat names (`get_model_info`, `list_models`, `get_benchmarks`,
  `compare_models`, `best_for_task`, `refresh_cache`) stay advertised in
  `tools/list` as deprecated aliases (same schemas, prefixed `[Deprecated]`
  description and annotation title) and continue to work via `tools/call`.

## [0.2.7] – 2026-05

### Added
- `outputSchema` and `annotations` (readOnlyHint, idempotentHint, openWorldHint,
  title) for every MCP tool. Tool results now also return `structuredContent`
  so clients that validate against the output schema get a typed payload, not
  just the JSON text block.

## [0.2.6] – 2026-05

### Added
- `manifest.json` now declares the 6 MCP tools with full `inputSchema` and an
  `icon.png` (rendered from `logo.svg`). Lifts Smithery's Capability Quality
  score from 0/40.

### Changed
- `build:mcpb` packs with `zip` instead of `mcpb pack`. Reason: the MCPB v0.3
  validator rejects `inputSchema` inside `tools[]`, but Smithery requires it.
  The `.mcpb` format is a plain zip, so we skip the validator.

## [0.2.5] – 2026-05

### Changed
- Smithery publish switched from URL-based scanning to **MCPB bundle** upload.
  Adds root `manifest.json` (MCPB v0.3) and `npm run build:mcpb` script. The
  publish workflow now builds `or-info.mcpb`, attaches it as a GitHub release
  asset and calls `smithery mcp publish ./or-info.mcpb -n aggc/or-info`.

### Removed
- `smithery.yaml` (URL-stdio flow, caused 422/405 on publish).
- `.well-known/mcp/server-card.json` and `pages.yml` workflow (server-card
  advertise only applies to HTTP servers on the same host).

## [0.2.4] – 2026-05

### Fixed
- Smithery publish: revert source URL to GitHub repo (stdio mode); GitHub Pages
  URL was treated as HTTP/SSE and broke the commandFunction flow.

## [0.2.3] – 2026-05

### Fixed
- Smithery publish now runs after GitHub Pages is live; server-card.json accessible.

## [0.2.2] – 2026-05

### Fixed
- Add `/.well-known/mcp/server-card.json` served via GitHub Pages so Smithery
  can skip the MCP server scan (which fails due to startup time in their sandbox).
- Pass `--config-schema` explicitly in the Smithery CLI publish command.
- Revert `smithery.yaml` to correct top-level format for `configSchema` and
  `commandFunction`.

## [0.2.1] – 2026-05

### Fixed
- `smithery.yaml`: `configSchema` and `commandFunction` must be nested under
  `startCommand`, not at the root level.

## [0.2.0] – 2026-05

### Added
- Publish to [Smithery](https://smithery.ai/servers/aggc/or-info) on every release:
  `smithery.yaml` config and `logo.svg` added; workflow extended with a Smithery
  publish step (non-blocking via `continue-on-error`).

## [0.1.5] – 2026-05

### Fixed
- `User-Agent` headers in `openrouter.mjs` and `lmarena.mjs` were hardcoded to
  `0.1.2` and never updated on release. They now read the version from
  `package.json` at runtime via a shared `lib/version.mjs` module.

## [0.1.4] – 2026-05

### Fixed
- Correct `get_benchmarks` tool description: it returns LMArena ELO data only,
  not MMLU / HumanEval / MATH / speed / latency as the old description stated.

## [0.1.3] – 2026-05

### Fixed
- Correct Claude Code MCP registration instructions: `mcpServers` is not a valid
  field in `settings.json`; document `claude mcp add` and the `.mcp.json` project
  file instead.
- Add Codex `~/.codex/config.toml` registration section.

## [0.1.2] – 2026-05

### Fixed
- Align CLI, MCP server and HTTP user-agent version strings with the published
  package version.

## [0.1.1] – 2026-05

### Changed
- Document npm installation under the `@aggc/or-info` package name and clarify that
  the installed executable is `or-info`.
- Document the automated release flow, `NPM_TOKEN` requirement and future Trusted
  Publishing migration.
- Normalize the package `bin` path used for npm publishing.

## [0.1.0] – 2026-05

### Added
- `or-info models` — list all OpenRouter models with pricing, sorting and filtering
- `or-info price <model-id>` — detailed pricing, context, features and LMArena ELO for a model
- `or-info benchmark <model-id>` — LMArena ELO, rank, vote count and confidence interval
- `or-info compare <a> <b>` — side-by-side comparison including ELO
- `or-info top --task --budget` — models ranked by ELO × price ratio for a given task
- `or-info refresh` — force-refresh OpenRouter catalog + LMArena ELO
- `or-info status` — show cache freshness for each data source
- `--mcp` flag to start as MCP server (stdio transport) with 6 tools:
  `get_model_info`, `list_models`, `get_benchmarks`, `compare_models`,
  `best_for_task`, `refresh_cache`
- Live ELO data from [LMArena](https://lmarena.ai) via HuggingFace Datasets Server —
  ~350 models, no API key required, auto-refreshed every 24 h
- Local cache in `~/.config/or-info/` (30 min TTL for models, 24 h for ELO)
- API key via `OPENROUTER_API_KEY` env var or `~/.config/or-info/.env`
