# JFinder

A smart research paper finder and downloader. AI-powered discovery meets automated retrieval.

## Features

- **Smart Search** - AI-powered query generation using LLM to find relevant papers
- **Multi-Source Downloads** - Downloads from Sci-Hub and Anna's Archive with fallback
- **Bulk Processing** - Upload DOI lists to process multiple papers at once
- **Auto-Broadening** - Automatically expands search when results are limited
- **Rich Metadata** - Captures authors, journals, years, and DOIs
- **Real-time Progress** - Server-Sent Events for live progress updates

## Tech Stack

- **Framework**: [Astro](https://astro.build/) with SSR
- **Runtime**: [Bun](https://bun.sh/)
- **Language**: TypeScript
- **APIs**: Scopus (search), OpenRouter (LLM)

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- [Scopus API Key](https://dev.elsevier.com/)
- [OpenRouter API Key](https://openrouter.ai/keys)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/jfinder.git
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
   SCOPUS_API_KEY=your_scopus_key
   OPENROUTER_API_KEY=sk-or-v1-your_key
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
  -e SCOPUS_API_KEY=your_key \
  -e OPENROUTER_API_KEY=your_key \
  jfinder
```

## Coolify Deployment

1. Connect your GitHub repository to Coolify
2. Select "Docker" as build method
3. Add environment variables in Coolify UI:
   - `SCOPUS_API_KEY`
   - `OPENROUTER_API_KEY`
   - Other optional variables from `.env.example`
4. Configure persistent storage for `/app/downloads`
5. Deploy

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/search` | POST | Start a search task |
| `/api/progress/[taskId]` | GET | SSE stream for progress |
| `/api/download/[taskId]/[type]` | GET | Download results (zip/metadata) |
| `/api/metadata/[taskId]` | GET | Get search metadata |

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SCOPUS_API_KEY` | Yes | - | Elsevier Scopus API key |
| `OPENROUTER_API_KEY` | Yes | - | OpenRouter API key |
| `OPENROUTER_MODEL` | No | `meta-llama/llama-3.3-70b-instruct` | LLM model to use |
| `PROXY_URL` | No | - | WebShare.io proxy list URL |
| `DOWNLOAD_DIR` | No | `./downloads` | Directory for downloads |
| `TASK_TTL_MS` | No | `3600000` | Task cleanup time (1 hour) |
| `MAX_UPLOAD_SIZE` | No | `16777216` | Max upload size (16MB) |

## License

MIT License - see [LICENSE](LICENSE) for details.

## Disclaimer

This tool is intended for legitimate academic research purposes. Users are responsible for complying with the terms of service of any sources used and applicable copyright laws in their jurisdiction.
