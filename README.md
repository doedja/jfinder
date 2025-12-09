# JFinder

A smart research tool with two powerful modes: **Paper Finder** for discovering and downloading research papers, and **Gap Analysis** for identifying unexplored research opportunities.

## Features

### Paper Finder Mode
- **Smart Search** - AI-powered query generation using LLM to find relevant papers
- **Multi-Source Downloads** - Parallel downloads from OpenAlex, Unpaywall, Sci-Hub, and LibGen
- **Bulk Processing** - Upload DOI lists to process multiple papers at once
- **Auto-Broadening** - Automatically expands search when results are limited
- **Rich Metadata** - Captures authors, journals, years, and DOIs

### Gap Analysis Mode
- **Research Gap Detection** - AI identifies unexplored areas in your field
- **Literature Comparison** - Analyzes existing research to find opportunities
- **Smart Recommendations** - Suggests potential research directions
- **Exportable Reports** - Download comprehensive gap analysis reports

## Tech Stack

- **Framework**: [Astro](https://astro.build/) with SSR
- **Runtime**: [Bun](https://bun.sh/) / Node.js
- **Language**: TypeScript
- **APIs**: OpenAlex (free), Scopus (optional), OpenRouter (LLM)

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.0+ or Node.js
- [OpenRouter API Key](https://openrouter.ai/keys) (required)
- [Scopus API Key](https://dev.elsevier.com/) (optional - falls back to OpenAlex)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/doedja/jfinder.git
   cd jfinder
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Create environment file:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` and add your API keys:
   ```env
   OPENROUTER_API_KEY=sk-or-v1-your_key
   # Optional: SCOPUS_API_KEY=your_scopus_key
   ```

5. Start development server:
   ```bash
   bun run dev
   ```

6. Open http://localhost:3000

### Production Build

```bash
bun run build
bun run start
```

## Docker Deployment

### Using Docker Compose

```bash
# Create .env file with your API keys
cp .env.example .env

# Build and run
docker-compose up -d
```

### Using Docker directly

```bash
docker build -t jfinder .
docker run -d -p 3000:3000 \
  -e OPENROUTER_API_KEY=your_key \
  jfinder
```

## Coolify Deployment

1. Connect your GitHub repository to Coolify
2. Select "Docker" as build method
3. Add environment variables in Coolify UI:
   - `OPENROUTER_API_KEY` (required)
   - `SCOPUS_API_KEY` (optional)
   - Other optional variables from `.env.example`
4. Configure persistent storage for `/app/downloads`
5. Deploy

## API Endpoints

### Paper Finder
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/search` | POST | Start a search task |
| `/api/progress/[taskId]` | GET | SSE stream for progress |
| `/api/download/[taskId]/[type]` | GET | Download results (zip/metadata) |
| `/api/metadata/[taskId]` | GET | Get search metadata |

### Gap Analysis
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/analyze-gaps` | POST | Start gap analysis |
| `/api/gap-progress/[taskId]` | GET | SSE stream for gap analysis |
| `/api/gap-results/[taskId]` | GET | Get gap analysis results |
| `/api/gap-report/[taskId]` | GET | Download gap analysis report |

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | Yes | - | OpenRouter API key for LLM |
| `OPENROUTER_MODEL` | No | `meta-llama/llama-3.3-70b-instruct` | LLM model to use |
| `SCOPUS_API_KEY` | No | - | Elsevier Scopus API key (falls back to OpenAlex) |
| `ANNAS_API_KEY` | No | - | Anna's Archive API key (adds extra download source) |
| `RAPIDAPI_KEY` | No | - | RapidAPI key for Anna's Archive |
| `PROXY_URL` | No | - | WebShare.io proxy list URL |
| `DOWNLOAD_DIR` | No | `./downloads` | Directory for downloads |
| `TASK_TTL_MS` | No | `3600000` | Task cleanup time (1 hour) |
| `MAX_UPLOAD_SIZE` | No | `16777216` | Max upload size (16MB) |
| `UMAMI_WEBSITE_ID` | No | - | Umami analytics website ID |
| `UMAMI_SRC` | No | - | Umami analytics script URL |

## Download Sources

Papers are downloaded from multiple sources in parallel for speed and reliability:

- **OpenAlex** - Open Access URLs (free, no key)
- **Unpaywall** - Legal OA links (free, no key)
- **Sci-Hub** - Research papers (free, no key)
- **LibGen** - Library Genesis (free, no key)
- **Anna's Archive** - Optional, requires API key

## License

MIT License - see [LICENSE](LICENSE) for details.

## Disclaimer

This tool is intended for legitimate academic research purposes. Users are responsible for complying with the terms of service of any sources used and applicable copyright laws in their jurisdiction.
