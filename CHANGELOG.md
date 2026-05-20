# Changelog

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
