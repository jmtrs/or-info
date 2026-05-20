# or-info

> CLI + MCP server to query OpenRouter model info: prices, ELO rankings, context and comparisons.

Any person or AI agent (Claude Code, Cursor, pi, etc.) can install it and use it
to make informed decisions about which model to use.

[![npm version](https://img.shields.io/npm/v/@aggc/or-info.svg)](https://www.npmjs.com/package/@aggc/or-info)
[![CI](https://github.com/jmtrs/or-info/actions/workflows/ci.yml/badge.svg)](https://github.com/jmtrs/or-info/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Install

```bash
npm install -g @aggc/or-info
or-info --version
```

The npm package is published as `@aggc/or-info`, but the installed executable is
`or-info`.

You can also run it without a global install:

```bash
npx -y @aggc/or-info models --limit 5
```

Requires Node.js 22 or later.

Supported runtimes and platforms:

- Node.js 22+
- macOS, Linux, Windows

## Config and cache paths

`or-info` resolves config and cache natively per platform:

| Platform | Config directory | Cache directory |
|----------|------------------|-----------------|
| macOS / Linux | `$XDG_CONFIG_HOME/or-info` or `~/.config/or-info` | `$XDG_CACHE_HOME/or-info` or `~/.cache/or-info` |
| Windows | `%APPDATA%\\or-info` | `%LOCALAPPDATA%\\or-info` |
| Any platform | `OR_INFO_CONFIG_DIR` override | `OR_INFO_CACHE_DIR` override |

Files of interest:

- Config file: `<config-dir>/.env`
- Model cache: `<cache-dir>/models.json`
- LMArena cache: `<cache-dir>/benchmarks.json`

## API key (optional)

Without an API key the CLI works with OpenRouter's public catalog.
With a key you also see private/pay-gated models.

### Bash / Zsh

```bash
export OPENROUTER_API_KEY=sk-or-...
```

### PowerShell

```powershell
$env:OPENROUTER_API_KEY = "sk-or-..."
```

### CMD

```cmd
set OPENROUTER_API_KEY=sk-or-...
```

### Config file

macOS / Linux:

```bash
mkdir -p ~/.config/or-info
echo 'OPENROUTER_API_KEY=sk-or-...' >> ~/.config/or-info/.env
```

Windows PowerShell:

```powershell
New-Item -ItemType Directory -Force "$env:APPDATA\or-info" | Out-Null
Add-Content -Path "$env:APPDATA\or-info\.env" -Value "OPENROUTER_API_KEY=sk-or-..."
```

Windows CMD:

```cmd
if not exist "%APPDATA%\or-info" mkdir "%APPDATA%\or-info"
echo OPENROUTER_API_KEY=sk-or-...>> "%APPDATA%\or-info\.env"
```

For tests and debugging you can redirect storage without touching your real machine state:

```bash
OR_INFO_CONFIG_DIR=/tmp/or-info-config OR_INFO_CACHE_DIR=/tmp/or-info-cache or-info status
```

## CLI usage

### List models

```bash
or-info models                        # All models sorted by name
or-info models --sort price           # Cheapest output first
or-info models --sort context         # Largest context first
or-info models --filter coding        # Models whose ID/name contains "coding"
or-info models --free                 # Free models only
or-info models --limit 20             # Limit the number of results
or-info models --tags                 # Show feature tags (vision, tools, reasoning…)
or-info models --json                 # Raw JSON
```

### Pricing and details

```bash
or-info price anthropic/claude-sonnet-4.5
or-info price google/gemini-2.5-flash --json
```

### ELO ranking (LMArena)

```bash
or-info benchmark openai/gpt-4o
or-info benchmark deepseek/deepseek-r1 --json
```

Shows the model's ELO score from [LMArena](https://lmarena.ai) (human preference votes),
confidence interval, global rank and vote count. Data is fetched live from HuggingFace
and cached locally for 24 hours — no API key required.

### Compare two models

```bash
or-info compare anthropic/claude-sonnet-4.5 google/gemini-2.5-flash
or-info compare openai/gpt-4o deepseek/deepseek-chat-v3-0324 --json
```

### Top models for a task

```bash
or-info top --task coding             # Best coding models
or-info top --task reasoning          # Best reasoning models
or-info top --task general            # Best all-rounders
or-info top --task vision             # Best vision models
or-info top --task cheap              # Best value for money
or-info top --task coding --budget 2  # Best coders under $2/M output
or-info top --task general --limit 10
```

Ranking combines LMArena ELO with price. `--task vision` and `--task coding` additionally
filter for models that support the required capability (image input / tool use).

### Cache management

```bash
or-info status          # Show cache age and TTL for each data source
or-info refresh         # Force-refresh OpenRouter catalog + LMArena ELO
```

## MCP server

`or-info` can run as an MCP server for AI agents.

### Tools available

| Tool | Description |
|------|-------------|
| `get_model_info` | Pricing, context, architecture, features and LMArena ELO for a model |
| `list_models` | List models with optional filter, sort and limit |
| `get_benchmarks` | LMArena ELO, rank, votes and confidence interval for a model |
| `compare_models` | Side-by-side comparison of two models |
| `best_for_task` | Ranked top models for coding/reasoning/general/vision/cheap |
| `refresh_cache` | Force-refresh OpenRouter catalog + LMArena ELO |

### Register in Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "or-info": {
      "command": "or-info",
      "args": ["--mcp"],
      "env": {
        "OPENROUTER_API_KEY": "sk-or-..."
      }
    }
  }
}
```

Windows global install:

```json
{
  "mcpServers": {
    "or-info": {
      "command": "or-info.cmd",
      "args": ["--mcp"],
      "env": {
        "OPENROUTER_API_KEY": "sk-or-..."
      }
    }
  }
}
```

If you installed via `npx` (without global install) on macOS/Linux:

```json
{
  "mcpServers": {
    "or-info": {
      "command": "npx",
      "args": ["-y", "@aggc/or-info", "--mcp"]
    }
  }
}
```

If you installed via `npx` on Windows:

```json
{
  "mcpServers": {
    "or-info": {
      "command": "npx.cmd",
      "args": ["-y", "@aggc/or-info", "--mcp"]
    }
  }
}
```

Then verify:

```bash
claude mcp list
```

### Use from Pi

Pi does not use an `mcpServers` settings schema. The recommended integration is a Pi skill
that calls the installed `or-info` CLI, for example `~/.pi/agent/skills/or-info/SKILL.md`.

### Test the MCP server

macOS / Linux:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | or-info --mcp
```

Windows PowerShell:

```powershell
'{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | or-info.cmd --mcp
```

Windows CMD:

```cmd
echo {"jsonrpc":"2.0","id":1,"method":"tools/list"} | or-info.cmd --mcp
```

## Data sources

| Data | Source | Refresh |
|------|--------|---------|
| Model catalog and pricing | [OpenRouter API](https://openrouter.ai/api/v1/models) | Every 30 min |
| ELO rankings | [LMArena](https://lmarena.ai) via [HuggingFace dataset](https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset) | Every 24 h |

ELO data is fetched directly from the `lmarena-ai/leaderboard-dataset` dataset on HuggingFace
using their public Datasets Server API — no API key required. Coverage: ~350 models
including all major commercial and open-source models tracked by LMArena.

## Testing

```bash
npm test
```

`npm test` runs the deterministic local suite and is the release gate used before publishing.
Live integration tests are available separately because they depend on OpenRouter and
HuggingFace availability and can occasionally hit third-party rate limits.

Additional entry points:

- `npm run test:local` for deterministic no-network coverage
- `npm run test:online:smoke` for the live smoke subset used by CI as a non-blocking signal
- `npm run test:online` for the full live CLI/MCP suite, including edge cases

## Release

Releases are published automatically to npm from GitHub Actions when a version tag is pushed.
The package is public under the `@aggc` npm scope.

Release checklist:

1. Update `CHANGELOG.md`.
2. Bump `version` in `package.json`.
3. Run `npm test`.
4. Commit and push to `main`.
5. Create and push a matching tag:

```bash
git tag v0.x.0
git push origin v0.x.0
```

The publish workflow runs `npm ci`, `npm run test:local`, then
`npm publish --provenance --access public`.

Repository release requirements:

- GitHub secret `NPM_TOKEN` must exist for `jmtrs/or-info`.
- The token must have npm publish permission for `@aggc/or-info`.
- `id-token: write` is enabled so npm provenance is attached to published versions.

After the initial package bootstrap, prefer migrating to npm Trusted Publishing and then
remove `NPM_TOKEN` from the repository secrets.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — adding new CLI commands or new MCP tools.

## License

[MIT](LICENSE)
