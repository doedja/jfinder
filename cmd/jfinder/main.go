package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/doedja/jfinder/internal/config"
	"github.com/doedja/jfinder/internal/download"
	"github.com/doedja/jfinder/internal/llm"
	"github.com/doedja/jfinder/internal/proxy"
	"github.com/doedja/jfinder/internal/search"
	"github.com/doedja/jfinder/internal/tasks"
	"github.com/doedja/jfinder/internal/util"
	"github.com/doedja/jfinder/internal/web"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		os.Stderr.WriteString("config: " + err.Error() + "\n")
		os.Exit(2)
	}

	log := util.New()
	limiter := util.NewLimiter()
	proxySvc := proxy.NewService(cfg)
	provider := search.ChooseProvider(cfg)
	openAlex := search.NewOpenAlex(cfg)
	llmClient := llm.New(cfg)
	engine := download.NewEngine(cfg, proxySvc)

	dlMgr := tasks.NewDownloadManager(cfg, log)
	gapMgr := tasks.NewGapManager(cfg, log)
	processor := tasks.NewProcessor(cfg, dlMgr, provider, llmClient, engine)
	gapProc := tasks.NewGapProcessor(cfg, gapMgr, provider, llmClient)

	renderer, err := web.LoadRenderer(cfg, "templates")
	if err != nil {
		os.Stderr.WriteString("renderer: " + err.Error() + "\n")
		os.Exit(2)
	}

	deps := &web.Deps{
		Cfg: cfg, Logger: log, Limiter: limiter,
		DownloadMgr: dlMgr, GapMgr: gapMgr,
		Processor: processor, GapProcessor: gapProc,
		Provider: provider, OpenAlex: openAlex,
		LLM: llmClient, Engine: engine,
		Renderer: renderer,
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(securityHeaders)
	r.Use(middleware.Compress(5, "text/html", "text/css", "application/json", "text/plain", "application/xml", "image/svg+xml", "application/javascript", "text/markdown"))
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(120 * time.Second))

	// Static files
	fs := http.FileServer(http.Dir("static"))
	r.Handle("/static/*", http.StripPrefix("/static/", fs))
	r.Get("/favicon.ico", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "static/favicon.svg")
	})
	r.Get("/manifest.webmanifest", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/manifest+json")
		http.ServeFile(w, r, "static/manifest.webmanifest")
	})

	// App routes (pages + api)
	web.Mount(r, deps)

	addr := cfg.Host + ":" + cfg.Port
	srv := &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      0, // SSE; rely on middleware.Timeout context
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}

	log.Info("server starting", "addr", addr, "provider", provider.Name(), "llm", cfg.LLMProvider, "model", cfg.LLMModel)

	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Info("server error", "err", err.Error())
			os.Exit(1)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh
	log.Info("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Info("shutdown error", "err", err.Error())
	}
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
		h.Set("X-Frame-Options", "SAMEORIGIN")
		// CSP. Allow inline scripts (htmx hooks + our small inline scripts), self for everything else,
		// plus the configured Umami host if any.
		h.Set("Content-Security-Policy",
			"default-src 'self'; "+
				"img-src 'self' data: https:; "+
				"style-src 'self' 'unsafe-inline'; "+
				"script-src 'self' 'unsafe-inline' https://umami.doedja.com; "+
				"connect-src 'self' https://api.openalex.org https://api.unpaywall.org https://umami.doedja.com; "+
				"font-src 'self' data:; "+
				"frame-ancestors 'self'")
		next.ServeHTTP(w, r)
	})
}
