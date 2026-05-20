# Changelog

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
