# JFinder Dockerfile
# Build stage
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Build stage
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# Production stage
FROM base AS runtime

# Copy built assets
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

# Copy and setup entrypoint
COPY docker-entrypoint.sh /app/
RUN chmod +x /app/docker-entrypoint.sh

# Create downloads directory
RUN mkdir -p /app/downloads

# Set environment variables
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NODE_ENV=production
ENV DOWNLOAD_DIR=/app/downloads

# Expose port
EXPOSE 3000

# Health check using bun fetch
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start via entrypoint
ENTRYPOINT ["/app/docker-entrypoint.sh"]
