FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/jfinder ./cmd/jfinder

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata wget su-exec && adduser -D -u 10001 app
WORKDIR /app
COPY --from=build /out/jfinder /app/jfinder
COPY templates /app/templates
COPY static /app/static
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /app/downloads && chown -R app:app /app
ENV HOST=0.0.0.0 PORT=3000 DOWNLOAD_DIR=/app/downloads
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
