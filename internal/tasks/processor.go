package tasks

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/doedja/jfinder/internal/config"
	"github.com/doedja/jfinder/internal/download"
	"github.com/doedja/jfinder/internal/llm"
	"github.com/doedja/jfinder/internal/search"
	"github.com/doedja/jfinder/internal/types"
	"github.com/doedja/jfinder/internal/util"
)

// TopicSearchParams holds parameters for a topic-based search task.
type TopicSearchParams struct {
	TaskID       string
	Topic        string
	Cycles       int
	Papers       int
	YearFilter   *types.YearFilter
	DownloadType types.DownloadType
}

// DOIListParams holds parameters for a DOI list task.
type DOIListParams struct {
	TaskID       string
	DOIs         []string
	DownloadType types.DownloadType
}

// GapDownloadParams holds parameters for downloading papers from a gap analysis.
type GapDownloadParams struct {
	TaskID string
	Papers []types.Paper
}

// Processor handles download tasks (topic search, DOI list, gap download).
type Processor struct {
	cfg      *config.Config
	manager  *DownloadManager
	provider search.Provider
	llm      *llm.Client
	engine   *download.Engine
	logger   *util.Logger
}

// NewProcessor creates a new Processor.
func NewProcessor(cfg *config.Config, mgr *DownloadManager, provider search.Provider, llmc *llm.Client, eng *download.Engine) *Processor {
	return &Processor{
		cfg:      cfg,
		manager:  mgr,
		provider: provider,
		llm:      llmc,
		engine:   eng,
		logger:   util.Default.Child("processor"),
	}
}

// ProcessTopicSearch executes a multi-cycle topic search and download.
func (p *Processor) ProcessTopicSearch(ctx context.Context, params TopicSearchParams) {
	taskDir, err := util.GetTaskDir(p.cfg.DownloadDir, params.TaskID)
	if err != nil {
		p.manager.Fail(params.TaskID, "failed to get task directory")
		return
	}
	if err := util.EnsureDir(taskDir); err != nil {
		p.manager.Fail(params.TaskID, "failed to create task directory")
		return
	}

	p.manager.StartProcessing(params.TaskID, "Generating search queries...")

	queries := p.llm.GenerateSearchQueries(ctx, params.Topic, params.Cycles, nil)

	var allPapers []types.Paper
	seenDois := make(map[string]bool)
	processedQueries := 0

	for i, q := range queries {
		select {
		case <-ctx.Done():
			p.manager.Fail(params.TaskID, "context cancelled")
			return
		default:
		}

		if len(allPapers) >= params.Papers {
			break
		}

		cycleNum := i + 1
		p.manager.UpdateCycleProgress(params.TaskID,
			fmt.Sprintf("Cycle %d/%d: Searching %s...", cycleNum, params.Cycles, p.provider.Name()),
			cycleNum, len(allPapers))

		startYear := 0
		endYear := 0
		if params.YearFilter != nil {
			startYear = params.YearFilter.StartYear
			endYear = params.YearFilter.EndYear
		}
		results := p.provider.Search(ctx, search.SearchParams{
			Query:     q,
			StartYear: startYear,
			EndYear:   endYear,
			Count:     params.Papers,
		})

		for _, paper := range results {
			if paper.DOI == "" {
				continue
			}
			doiClean, ok := util.CleanDOI(paper.DOI)
			if !ok {
				continue
			}
			if seenDois[doiClean] {
				continue
			}
			seenDois[doiClean] = true
			allPapers = append(allPapers, paper)
		}
		processedQueries++

		// Broaden at halfway point if needed
		if i == params.Cycles/2-1 && len(allPapers) < int(0.8*float64(params.Papers)) {
			additional := p.llm.GenerateSearchQueries(ctx, params.Topic, params.Cycles-processedQueries, allPapers)
			queries = append(queries[:i+1], additional...)
			p.manager.Update(params.TaskID, func(t *types.TaskStatus) {
				t.Message = fmt.Sprintf("Broadening search, generated %d new queries", len(additional))
			})
		}

		time.Sleep(1 * time.Second)
	}

	if len(allPapers) == 0 {
		p.manager.Fail(params.TaskID, "No papers found")
		return
	}

	p.manager.Update(params.TaskID, func(t *types.TaskStatus) {
		t.PapersFound = len(allPapers)
		t.Message = fmt.Sprintf("Found %d papers, preparing to download...", len(allPapers))
	})

	queriesStr := make([]string, len(queries))
	for i, q := range queries {
		queriesStr[i] = q
	}
	p.processResults(ctx, params.TaskID, taskDir, allPapers, queriesStr, params.DownloadType)
}

// ProcessDOIList processes a list of DOIs and downloads papers.
func (p *Processor) ProcessDOIList(ctx context.Context, params DOIListParams) {
	taskDir, err := util.GetTaskDir(p.cfg.DownloadDir, params.TaskID)
	if err != nil {
		p.manager.Fail(params.TaskID, "failed to get task directory")
		return
	}
	if err := util.EnsureDir(taskDir); err != nil {
		p.manager.Fail(params.TaskID, "failed to create task directory")
		return
	}

	p.manager.StartProcessing(params.TaskID, "Processing DOI list...")

	totalDOIs := len(params.DOIs)
	allPapers := p.provider.ProcessDOIList(ctx, params.DOIs, func(current, total int) {
		p.manager.Update(params.TaskID, func(t *types.TaskStatus) {
			t.PapersFound = current
			t.Message = fmt.Sprintf("Processing DOI %d/%d", current, total)
			progress := int(float64(current)/float64(totalDOIs)*40) + 5
			if progress < 5 {
				progress = 5
			} else if progress > 45 {
				progress = 45
			}
			t.Progress = progress
		})
	})

	if len(allPapers) == 0 {
		p.manager.Fail(params.TaskID, "No papers found from DOI list")
		return
	}

	p.manager.Update(params.TaskID, func(t *types.TaskStatus) {
		t.PapersFound = len(allPapers)
		t.Message = fmt.Sprintf("Found %d papers, preparing to download...", len(allPapers))
	})

	queries := []string{fmt.Sprintf("DOI list (%d DOIs)", totalDOIs)}
	p.processResults(ctx, params.TaskID, taskDir, allPapers, queries, params.DownloadType)
}

// ProcessGapDownload downloads papers for a gap analysis result.
func (p *Processor) ProcessGapDownload(ctx context.Context, params GapDownloadParams) {
	taskDir, err := util.GetTaskDir(p.cfg.DownloadDir, params.TaskID)
	if err != nil {
		p.manager.Fail(params.TaskID, "failed to get task directory")
		return
	}
	if err := util.EnsureDir(taskDir); err != nil {
		p.manager.Fail(params.TaskID, "failed to create task directory")
		return
	}

	p.manager.StartProcessing(params.TaskID, "Preparing to download papers...")
	p.manager.Update(params.TaskID, func(t *types.TaskStatus) {
		t.PapersFound = len(params.Papers)
	})

	queries := []string{fmt.Sprintf("Gap analysis papers (%d papers)", len(params.Papers))}
	p.processResults(ctx, params.TaskID, taskDir, params.Papers, queries, types.DownloadFull)
}

// processResults handles the common download, metadata, and zip steps.
func (p *Processor) processResults(ctx context.Context, taskID, taskDir string, papers []types.Paper, queries []string, dlType types.DownloadType) {
	var failedDownloads []types.FailedDownload

	if dlType == types.DownloadFull {
		p.manager.Update(taskID, func(t *types.TaskStatus) {
			t.Message = "Downloading papers..."
			t.Progress = 50
		})

		onStart := func(current, total int, paper types.Paper) {
			p.manager.StartPaperDownload(taskID, current, total, paper.Title)
		}
		_, failed := p.engine.DownloadBatch(ctx, papers, taskDir, onStart, func(current, total int, paper types.Paper, success bool) {
			p.manager.UpdateDownloadProgress(taskID, current, total)
			if !success {
				p.logger.Warn("download failed", "doi", paper.DOI, "title", paper.Title)
			}
		})
		failedDownloads = failed
	}

	p.manager.Update(taskID, func(t *types.TaskStatus) {
		t.Message = "Generating metadata..."
		t.Progress = 95
	})

	metadata := download.GenerateMetadata(papers, queries, failedDownloads)
	detailsPath := filepath.Join(taskDir, "details.txt")
	if err := os.WriteFile(detailsPath, []byte(metadata), 0644); err != nil {
		p.logger.Error("failed to write metadata", "err", err)
	}

	if len(failedDownloads) > 0 {
		var sb strings.Builder
		sb.WriteString("Failed Downloads:\n\n")
		for _, f := range failedDownloads {
			sb.WriteString(fmt.Sprintf("Title: %s\nDOI: %s\nError: %s\nSources: %v\n\n", f.Paper.Title, f.Paper.DOI, f.Error, f.AttemptedSources))
		}
		failedPath := filepath.Join(taskDir, "failed_downloads.txt")
		if err := os.WriteFile(failedPath, []byte(sb.String()), 0644); err != nil {
			p.logger.Error("failed to write failed downloads log", "err", err)
		}
	}

	if dlType == types.DownloadFull {
		p.manager.Update(taskID, func(t *types.TaskStatus) {
			t.Message = "Creating ZIP archive..."
			t.Progress = 98
		})
		zipPath, err := util.CreateTaskZip(taskDir, taskID)
		if err != nil {
			p.logger.Error("failed to create zip", "err", err)
		} else {
			p.logger.Info("created zip", "path", zipPath)
		}
	}

	downloadURL := ""
	metadataURL := fmt.Sprintf("/api/download/%s/metadata", taskID)
	if dlType == types.DownloadFull {
		downloadURL = fmt.Sprintf("/api/download/%s/zip", taskID)
	}

	p.manager.Complete(taskID, downloadURL, metadataURL)
}
