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

# Create non-root user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs astro

# Copy built assets
COPY --from=build --chown=astro:nodejs /app/dist ./dist
COPY --from=build --chown=astro:nodejs /app/node_modules ./node_modules

# Create downloads directory
RUN mkdir -p /app/downloads && chown astro:nodejs /app/downloads

# Set environment variables
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NODE_ENV=production
ENV DOWNLOAD_DIR=/app/downloads

# Switch to non-root user
USER astro

# Expose port
EXPOSE 3000

# Health check using bun fetch
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Start the server
CMD ["bun", "run", "./dist/server/entry.mjs"]
