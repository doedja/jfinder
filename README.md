# JFinder

Research paper finder and gap analysis tool. Search OpenAlex or Scopus, download legally available PDFs from racing sources, and let an LLM map gaps and directions in the literature.

Live: https://jfinder.doedja.com

## What it does

Two modes on one page.

**Paper Finder.** Generates Scopus-style queries from a topic via LLM, searches OpenAlex (or Scopus when a key is set), deduplicates by DOI, then for every paper races OpenAlex OA, Unpaywall, Sci-Hub, LibGen, and (optionally) Anna's Archive in parallel. First valid PDF wins. Bundles results into a ZIP.

**Gap Analysis.** Collects N papers on a topic and runs algorithmic + LLM analysis to produce research gaps, methodology comparisons, contradictions, clusters, trends, and recommended research directions. Outputs a JSON result + Markdown report. Optional one-click download of the analyzed PDFs.

## Stack

- Go 1.26 single binary (~14 MB)
- chi router, html/template, htmx + SSE for the UI
- In-memory task lifecycle with TTL cleanup (no database)
- Stdlib HTTP + goquery for HTML parsing
- LLM client switchable between DeepSeek (default) and OpenRouter

The DeepSeek client is designed for high KV cache hit rate: each task type has a stable system message and a stable instruction header; only the variable payload (topic, papers, gap titles) is appended at the tail. Cache stats are logged via the `prompt_cache_hit_tokens` field.

## Run locally

```bash
cp .env.example .env
# fill LLM_API_KEY (DeepSeek by default)

go build -o bin/jfinder ./cmd/jfinder
./bin/jfinder
```

Open http://localhost:3000.

## Tests

```bash
go test ./...
```

17 integration tests cover page rendering, validation, SSE, exports, and the suggest endpoint.

## Deploy (Coolify / Docker)

```bash
docker compose up -d --build
```

Or via Coolify: point at this repo, the included `Dockerfile` builds a multi-stage image (golang:1.26-alpine builder, alpine runtime, non-root user, healthcheck on `/healthz`). Set the env vars in the Coolify UI.

## Environment

Required:

| Var | Notes |
|---|---|
| `LLM_API_KEY` | DeepSeek or OpenRouter key |

Optional with defaults:

| Var | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `deepseek` | `deepseek` or `openrouter` |
| `LLM_MODEL` | provider default | `deepseek-chat` or `qwen/qwen-2.5-72b-instruct` |
| `SCOPUS_API_KEY` | (empty, uses OpenAlex) | falls back to OpenAlex when unset |
| `PROXY_URL` | (empty) | WebShare-format proxy list URL |
| `ANNAS_API_KEY` / `RAPIDAPI_KEY` | (empty) | either enables Anna's Archive |
| `DOWNLOAD_DIR` | `./downloads` | task output root |
| `TASK_TTL_MS` | 3600000 | task TTL (ms) before cleanup |
| `MAX_UPLOAD_SIZE` | 16777216 | DOI list upload cap (bytes) |
| `BASE_URL` | `https://jfinder.doedja.com` | canonical + sitemap |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | bind |
| `UMAMI_WEBSITE_ID` / `UMAMI_SRC` | (empty) | analytics |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/search` | topic or DOI file. Returns `{taskId}`. |
| POST | `/api/analyze-gaps` | starts a gap analysis. Returns `{taskId}`. |
| POST | `/api/download-gap-papers/{taskId}` | spawns a download task for a completed gap analysis. |
| GET | `/api/progress/{taskId}` | SSE stream for download tasks. |
| GET | `/api/gap-progress/{taskId}` | SSE stream for gap analysis tasks. |
| GET | `/api/papers/{taskId}` | list downloaded papers. |
| GET | `/api/metadata/{taskId}` | `details.txt` for a task. |
| GET | `/api/download/{taskId}/{zip,metadata}` | task ZIP or metadata file. |
| GET | `/api/preview/{taskId}/{filename}` | inline PDF preview. |
| GET | `/api/export/{taskId}/{bibtex,ris}` | citation export (gap tasks). |
| GET | `/api/gap-results/{taskId}` | raw JSON result. |
| GET | `/api/gap-report/{taskId}?format=md\|json` | Markdown report. |
| GET | `/api/suggest?q=` | OpenAlex topic autocomplete. |
| GET | `/api/related-papers/{doi}` | citations and references. |
| GET | `/healthz` | liveness. |

Per-IP rate limiting (10 req/min, 3 concurrent tasks). Tasks are in-memory with TTL cleanup.

## Project layout

```
cmd/jfinder/main.go        binary entrypoint
internal/
  config/                  env loading
  types/                   shared domain types
  util/                    logger, retry, files, citations, zip, rate limiter
  proxy/                   WebShare proxy pool
  search/                  OpenAlex + Scopus
  download/                Sci-Hub, LibGen, Unpaywall, Anna's, OA, race engine
  gap/                     algorithmic gap analysis
  llm/                     KV-cache friendly LLM client (DeepSeek / OpenRouter)
  tasks/                   in-memory managers + processors
  web/                     chi router, handlers, SSE, html/template renderer
templates/                 base layout + index + features + partials
static/                    css, htmx, og image, manifest, favicon
```

## Acknowledgements

OpenAlex polite-pool friendly. Unpaywall email identification included. Default user-agent identifies as a browser to satisfy mirror access requirements.

## License

MIT. See `LICENSE`.
