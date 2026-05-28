package download

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/doedja/jfinder/internal/config"
	"github.com/doedja/jfinder/internal/proxy"
	"github.com/doedja/jfinder/internal/types"
	"github.com/doedja/jfinder/internal/util"
)

var defaultSourcesOrder = []types.DownloadSource{
	types.SourceUnpaywall,
	types.SourceOpenAlexOA,
	types.SourceScihub,
	types.SourceLibgen,
}

func EnabledSources(cfg *config.Config) []types.DownloadSource {
	sources := make([]types.DownloadSource, 0, 5)
	sources = append(sources, defaultSourcesOrder...)
	if cfg.HasAnnas() {
		sources = append(sources, types.SourceAnnasArch)
	}
	return sources
}

type Engine struct {
	cfg             *config.Config
	scihub          *ScihubService
	libgen          *LibgenService
	annas           *AnnasService
	unpaywall       *UnpaywallService
	openalexFetcher *OpenAlexOAFetcher
	logger          *util.Logger
}

func NewEngine(cfg *config.Config, p *proxy.Service) *Engine {
	return &Engine{
		cfg:             cfg,
		scihub:          NewScihub(p),
		libgen:          NewLibgen(),
		annas:           NewAnnas(),
		unpaywall:       NewUnpaywall(cfg.ContactEmail),
		openalexFetcher: NewOpenAlexOAFetcher(),
		logger:          util.Default,
	}
}

func (e *Engine) Download(ctx context.Context, paper types.Paper) (data []byte, src types.DownloadSource, ok bool) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	type attemptResult struct {
		data []byte
		src  types.DownloadSource
	}
	results := make(chan attemptResult, 1)

	sources := EnabledSources(e.cfg)
	filtered := make([]types.DownloadSource, 0, len(sources))
	for _, s := range sources {
		if s == types.SourceOpenAlexOA && paper.OpenAccessURL == "" {
			continue
		}
		filtered = append(filtered, s)
	}

	for _, src := range filtered {
		src := src
		go func() {
			var d []byte
			switch src {
			case types.SourceScihub:
				d = e.scihub.Download(ctx, paper.DOI)
			case types.SourceLibgen:
				d = e.libgen.Download(ctx, paper.DOI)
			case types.SourceAnnasArch:
				d = e.annas.Download(ctx, paper.DOI)
			case types.SourceUnpaywall:
				d = e.unpaywall.Download(ctx, paper.DOI)
			case types.SourceOpenAlexOA:
				d = e.openalexFetcher.Download(ctx, paper)
			}
			if d != nil {
				select {
				case results <- attemptResult{data: d, src: src}:
				default:
				}
			}
		}()
	}

	select {
	case <-ctx.Done():
		return nil, "", false
	case r := <-results:
		cancel()
		return r.data, r.src, true
	case <-time.After(60 * time.Second):
		return nil, "", false
	}
}

func (e *Engine) DownloadAndSave(ctx context.Context, paper types.Paper, outputDir string) types.DownloadResult {
	data, src, ok := e.Download(ctx, paper)
	if !ok {
		return types.DownloadResult{Success: false, Source: src, Error: "all sources failed", FilePath: ""}
	}
	safeName := util.CreateSafeFilename(paper.Title, 100) + ".pdf"
	filePath := filepath.Join(outputDir, safeName)
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return types.DownloadResult{Success: false, Source: src, Error: err.Error()}
	}
	return types.DownloadResult{Success: true, Source: src, FilePath: filePath}
}

// DownloadBatch downloads papers concurrently. onStart fires before each
// paper's race begins; onProgress fires after each paper resolves. Both
// callbacks are per-call so concurrent batches never share callback state.
func (e *Engine) DownloadBatch(ctx context.Context, papers []types.Paper, taskDir string,
	onStart func(current, total int, paper types.Paper),
	onProgress func(current, total int, p types.Paper, success bool)) ([]string, []types.FailedDownload) {

	papersDir := filepath.Join(taskDir, "papers")
	os.MkdirAll(papersDir, 0755)

	total := len(papers)
	workers := 3
	if total < workers {
		workers = total
	}

	type job struct {
		idx   int
		paper types.Paper
	}

	jobs := make(chan job)
	var mu sync.Mutex
	var successful []string
	var failed []types.FailedDownload
	processed := 0

	var wg sync.WaitGroup
	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				select {
				case <-ctx.Done():
					return
				default:
				}

				if onStart != nil {
					onStart(j.idx+1, total, j.paper)
				}

				if j.paper.DOI == "" {
					mu.Lock()
					failed = append(failed, types.FailedDownload{
						Paper:            j.paper,
						Error:            "no DOI",
						AttemptedSources: nil,
					})
					processed++
					done := processed
					mu.Unlock()
					if onProgress != nil {
						onProgress(done, total, j.paper, false)
					}
					continue
				}

				result := e.DownloadAndSave(ctx, j.paper, papersDir)
				mu.Lock()
				if result.Success {
					successful = append(successful, result.FilePath)
				} else {
					failed = append(failed, types.FailedDownload{
						Paper:            j.paper,
						Error:            result.Error,
						AttemptedSources: nil,
					})
				}
				processed++
				done := processed
				mu.Unlock()
				if onProgress != nil {
					onProgress(done, total, j.paper, result.Success)
				}
			}
		}()
	}

	for i, paper := range papers {
		select {
		case <-ctx.Done():
			close(jobs)
			wg.Wait()
			return successful, failed
		case jobs <- job{idx: i, paper: paper}:
		}
	}
	close(jobs)
	wg.Wait()

	return successful, failed
}
