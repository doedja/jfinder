# JFinder

Research paper finder and gap analysis tool.

## Tech Stack
- **Language**: Go 1.26
- **Router**: chi (`github.com/go-chi/chi/v5`)
- **Templates**: stdlib `html/template`
- **Frontend**: htmx + SSE extension, vanilla CSS
- **HTML parsing**: goquery (`github.com/PuerkitoBio/goquery`)
- **UUIDs**: `github.com/google/uuid`
- **No database**: in-memory task lifecycle with TTL cleanup
- **Build**: single static binary via `go build`

## Architecture

Two-mode page: **Paper Finder** (search + download) and **Gap Analysis** (LLM-powered).

### Layout
- `cmd/jfinder/main.go`: binary entrypoint, wires deps, mounts chi router with middleware (compress, security headers, recover, timeout)
- `internal/config`: env loading, validation, defaults (Zod-style fail-fast at boot)
- `internal/types`: shared domain types (Paper, TaskStatus, GapTaskStatus, gap analysis result types)
- `internal/util`: logger (JSON lines), retry with jitter, file ops, citation export (BibTeX/RIS), ZIP creation, in-memory rate limiter
- `internal/proxy`: WebShare proxy pool (refresh every 5 min)
- `internal/search`: OpenAlex (default, free) + Scopus, behind a `Provider` interface
- `internal/download`: Sci-Hub, LibGen, Unpaywall, Anna's Archive, OpenAlex OA, race engine via `Promise.any`-style goroutines + ctx cancel
- `internal/gap`: algorithmic gap detection, methodology comparison, recommendation
- `internal/llm`: provider-agnostic chat client (DeepSeek + OpenRouter), with prompts engineered for high DeepSeek KV cache hit rate
- `internal/tasks`: in-memory managers (`DownloadManager`, `GapManager`) + processors (topic search, DOI list, gap analysis, gap-papers download)
- `internal/web`: chi handlers, SSE progress streamer, html/template renderer with page caches

### Frontend
- `templates/base.html`: shared layout with SEO meta, OG, Twitter card, JSON-LD, theme-color, manifest, htmx + SSE extension
- `templates/index.html`: hero + two-mode tab switch (Paper Finder, Gap Analysis) + capability strip
- `templates/features.html`: feature breakdown
- `templates/partials/`: `finder_started`, `gap_started`, `error` partials returned by htmx POSTs
- `static/css/main.css`: warm monochrome editorial palette, light/dark via `[data-theme]`
- `static/js/`: htmx core + SSE extension (vendored, served from `/static/js/`)

### Key patterns
- **SSE**: `WriteProgressStream` in `internal/web/sse.go` polls task manager every 1s, writes `data: <json>\n\n`, terminates on `complete`/`error` or ctx cancel
- **Task validation**: handlers call `util.IsValidTaskID` + manager `Get`; helper `jsonErr`/`jsonResp` for consistent JSON output
- **Download race**: `download.Engine.Download` fans out goroutines, first non-nil PDF wins, ctx cancel kills losers
- **Background processing**: POST handlers create task synchronously, spawn goroutine for `Processor.*`/`GapProcessor.Process`, return `{taskId}` immediately
- **LLM KV cache**: each task type has a stable system message + stable instruction header; only the variable payload (topic, papers, gaps) is appended at the tail. Cache hit ratio logged via `prompt_cache_hit_tokens`.
- **HTML/JSON dual response**: `prefersHTML(r)` detects htmx (`HX-Request: true`) or browser (`Accept: text/html`) and swaps to partial; JSON otherwise

## Conventions
- Use `util.Default.Child("svc","name")` for scoped loggers
- Use `util.IsValidTaskID` before any task lookup (path traversal guard)
- Env variables must go through `config.Load()`. Do not read `os.Getenv` ad-hoc except inside `internal/config`.
- No database. All task state is in-memory; results stored under `<DOWNLOAD_DIR>/<taskId>/`
- LLM provider switch: `LLM_PROVIDER=deepseek|openrouter`; both use OpenAI-compatible chat completions endpoints

## Commands
- `go build -o bin/jfinder ./cmd/jfinder`: production build
- `./bin/jfinder`: run server (reads `.env` from CWD)
- `go test ./...`: run integration tests (17 currently)
- `docker compose up -d --build`: container deploy

## Deployment
- `Dockerfile`: multi-stage (golang:1.26-alpine build, alpine runtime, non-root user, healthcheck on `/healthz`)
- `docker-compose.yml`: env passthrough, volume for `/app/downloads`
- Coolify: point at repo root, expose port 3000, set env in UI
