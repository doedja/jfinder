package web

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/doedja/jfinder/internal/config"
	"github.com/doedja/jfinder/internal/download"
	"github.com/doedja/jfinder/internal/llm"
	"github.com/doedja/jfinder/internal/search"
	"github.com/doedja/jfinder/internal/tasks"
	"github.com/doedja/jfinder/internal/types"
	"github.com/doedja/jfinder/internal/util"
)

// Deps wires everything the web layer needs.
type Deps struct {
	Cfg          *config.Config
	Logger       *util.Logger
	Limiter      *util.Limiter
	DownloadMgr  *tasks.DownloadManager
	GapMgr       *tasks.GapManager
	Processor    *tasks.Processor
	GapProcessor *tasks.GapProcessor
	Provider     search.Provider
	OpenAlex     *search.OpenAlexService
	LLM          *llm.Client
	Engine       *download.Engine
	Renderer     *Renderer
}

// requestTimeout caps how long a normal (non-streaming) handler may run before
// its context is cancelled. SSE progress streams are deliberately excluded:
// they are long-lived and a timeout would kill the stream before the background
// task finishes, freezing the UI with no completion event.
const requestTimeout = 120 * time.Second

// Mount wires all routes.
func Mount(r chi.Router, d *Deps) {
	timeout := middleware.Timeout(requestTimeout)

	// Page routes: standard request timeout.
	r.Group(func(r chi.Router) {
		r.Use(timeout)
		r.Get("/", d.handleIndex)
		r.Get("/features", d.handleFeatures)
		r.Get("/sitemap.xml", d.handleSitemap)
		r.Get("/robots.txt", d.handleRobots)
		r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("ok")) })
	})

	r.Route("/api", func(r chi.Router) {
		// SSE streaming endpoints: long-lived, must NOT have a request timeout.
		// middleware.Timeout cancels r.Context() after the deadline, which would
		// terminate the progress stream mid-task (the download keeps running on
		// context.Background but the client never receives the completion event).
		r.Get("/progress/{taskId}", d.handleProgress)
		r.Get("/gap-progress/{taskId}", d.handleGapProgress)

		// Everything else: standard request timeout.
		r.Group(func(r chi.Router) {
			r.Use(timeout)
			r.Post("/search", d.handlePostSearch)
			r.Post("/analyze-gaps", d.handlePostAnalyzeGaps)
			r.Post("/download-gap-papers/{taskId}", d.handlePostDownloadGapPapers)
			r.Get("/papers/{taskId}", d.handleListPapers)
			r.Get("/metadata/{taskId}", d.handleMetadata)
			r.Get("/download/{taskId}/{type}", d.handleDownloadType)
			r.Get("/preview/{taskId}/{filename}", d.handlePreview)
			r.Get("/export/{taskId}/{format}", d.handleExport)
			r.Get("/gap-results/{taskId}", d.handleGapResults)
			r.Get("/gap-report/{taskId}", d.handleGapReport)
			r.Get("/suggest", d.handleSuggest)
			r.Get("/related-papers/{doi}", d.handleRelatedPapers)
		})
	})
}

func jsonResp(w http.ResponseWriter, code int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(payload)
}

func jsonErr(w http.ResponseWriter, code int, msg string) {
	jsonResp(w, code, map[string]string{"error": msg})
}

func prefersHTML(r *http.Request) bool {
	if r.Header.Get("HX-Request") == "true" {
		return true
	}
	return strings.Contains(r.Header.Get("Accept"), "text/html")
}

// =========================================================================
// Page handlers
// =========================================================================

func (d *Deps) handleIndex(w http.ResponseWriter, r *http.Request) {
	jsonld, _ := json.Marshal(map[string]any{
		"@context":            "https://schema.org",
		"@type":               "WebApplication",
		"name":                "JFinder",
		"description":         "Research paper finder and gap analysis tool. Search OpenAlex or Scopus, download legally available PDFs from racing sources, and map literature gaps with an LLM.",
		"url":                 d.Cfg.BaseURL,
		"applicationCategory": "Education",
		"operatingSystem":     "Any",
		"offers": map[string]any{
			"@type": "Offer", "price": "0", "priceCurrency": "USD",
		},
	})
	d.Renderer.Page(w, http.StatusOK, "index", PageData{
		Title:       "JFinder. Research paper finder and gap analysis.",
		Description: "Search OpenAlex or Scopus, download legally available PDFs from racing sources, and let an LLM map gaps and directions in the literature.",
		Canonical:   d.Cfg.BaseURL + "/",
		BaseURL:     d.Cfg.BaseURL,
		Theme:       "light",
		UmamiSrc:    d.Cfg.UmamiSrc,
		UmamiID:     d.Cfg.UmamiWebsiteID,
		JSONLD:      template.JS(jsonld),
	})
}

func (d *Deps) handleFeatures(w http.ResponseWriter, r *http.Request) {
	d.Renderer.Page(w, http.StatusOK, "features", PageData{
		Title:       "Features. JFinder.",
		Description: "Provider switching, parallel download race, LLM gap analysis, BibTeX and RIS export, server-sent progress.",
		Canonical:   d.Cfg.BaseURL + "/features",
		BaseURL:     d.Cfg.BaseURL,
		Theme:       "light",
		UmamiSrc:    d.Cfg.UmamiSrc,
		UmamiID:     d.Cfg.UmamiWebsiteID,
	})
}

func (d *Deps) handleSitemap(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	now := time.Now().UTC().Format("2006-01-02")
	body := `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>` + d.Cfg.BaseURL + `/</loc><lastmod>` + now + `</lastmod><priority>1.0</priority><changefreq>weekly</changefreq></url>
  <url><loc>` + d.Cfg.BaseURL + `/features</loc><lastmod>` + now + `</lastmod><priority>0.7</priority><changefreq>monthly</changefreq></url>
</urlset>
`
	_, _ = w.Write([]byte(body))
}

func (d *Deps) handleRobots(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte("User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: " + d.Cfg.BaseURL + "/sitemap.xml\n"))
}

// =========================================================================
// Validation helpers
// =========================================================================

func validateTaskID(id string) bool { return util.IsValidTaskID(id) }

func clamp(n, lo, hi int) int {
	if n < lo {
		return lo
	}
	if n > hi {
		return hi
	}
	return n
}

// =========================================================================
// POST /api/search
// =========================================================================

type searchJSON struct {
	Topic        string `json:"topic"`
	Cycles       int    `json:"cycles"`
	Papers       int    `json:"papers"`
	YearFilter   string `json:"yearFilter"`
	DownloadType string `json:"downloadType"`
}

func (d *Deps) handlePostSearch(w http.ResponseWriter, r *http.Request) {
	ip := util.ClientIP(r.Header)
	if lim := d.Limiter.Check(ip); lim != nil {
		w.Header().Set("Retry-After", strconv.Itoa(lim.RetryAfter))
		jsonErr(w, lim.Code, lim.Message)
		return
	}

	if d.DownloadMgr.ActiveCount() >= 5 {
		d.Limiter.Release(ip)
		jsonErr(w, http.StatusTooManyRequests, "Server is busy. Please try again later.")
		return
	}

	var topic string
	var dois []string
	cycles, papers := 3, 20
	yearFilter := ""
	downloadType := types.DownloadFull

	ctype := r.Header.Get("Content-Type")
	if strings.HasPrefix(ctype, "multipart/form-data") {
		if err := r.ParseMultipartForm(d.Cfg.MaxUploadSize); err != nil {
			d.Limiter.Release(ip)
			jsonErr(w, http.StatusBadRequest, "Failed to parse upload")
			return
		}
		topic = strings.TrimSpace(r.FormValue("topic"))
		cycles = parseInt(r.FormValue("cycles"), 3)
		papers = parseInt(r.FormValue("papers"), 20)
		yearFilter = r.FormValue("yearFilter")
		if dt := r.FormValue("downloadType"); dt == "metadata" {
			downloadType = types.DownloadMetadata
		}

		if fhs := r.MultipartForm.File["doiFile"]; len(fhs) > 0 {
			fh := fhs[0]
			if fh.Size > d.Cfg.MaxUploadSize {
				d.Limiter.Release(ip)
				jsonErr(w, http.StatusBadRequest, "File too large")
				return
			}
			if !strings.HasSuffix(strings.ToLower(fh.Filename), ".txt") {
				d.Limiter.Release(ip)
				jsonErr(w, http.StatusBadRequest, "Only .txt files are allowed")
				return
			}
			file, err := fh.Open()
			if err != nil {
				d.Limiter.Release(ip)
				jsonErr(w, http.StatusBadRequest, "Failed to read file")
				return
			}
			defer file.Close()
			content, err := io.ReadAll(file)
			if err != nil {
				d.Limiter.Release(ip)
				jsonErr(w, http.StatusBadRequest, "Failed to read file content")
				return
			}
			dois = util.ParseDOIList(string(content))
			if len(dois) == 0 {
				d.Limiter.Release(ip)
				jsonErr(w, http.StatusBadRequest, "No valid DOIs found in file")
				return
			}
		}
	} else {
		var body searchJSON
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			d.Limiter.Release(ip)
			jsonErr(w, http.StatusBadRequest, "Invalid request")
			return
		}
		topic = strings.TrimSpace(body.Topic)
		if body.Cycles > 0 {
			cycles = body.Cycles
		}
		if body.Papers > 0 {
			papers = body.Papers
		}
		yearFilter = body.YearFilter
		if body.DownloadType == "metadata" {
			downloadType = types.DownloadMetadata
		}
	}

	if topic == "" && len(dois) == 0 {
		d.Limiter.Release(ip)
		jsonErr(w, http.StatusBadRequest, "Either topic or DOI list is required")
		return
	}

	cycles = clamp(cycles, 1, 20)
	papers = clamp(papers, 1, 250)

	taskID := d.DownloadMgr.Create(papers, cycles)

	if len(dois) > 0 {
		go func() {
			defer d.Limiter.Release(ip)
			defer recoverProcessor(d, taskID)
			d.Processor.ProcessDOIList(context.Background(), tasks.DOIListParams{
				TaskID: taskID, DOIs: dois, DownloadType: downloadType,
			})
		}()
	} else {
		go func() {
			defer d.Limiter.Release(ip)
			defer recoverProcessor(d, taskID)
			d.Processor.ProcessTopicSearch(context.Background(), tasks.TopicSearchParams{
				TaskID: taskID, Topic: topic,
				Cycles: cycles, Papers: papers,
				YearFilter:   types.ParseYearFilter(yearFilter),
				DownloadType: downloadType,
			})
		}()
	}

	if prefersHTML(r) {
		d.Renderer.Partial(w, http.StatusOK, "finder_started", map[string]any{"TaskID": taskID})
		return
	}
	jsonResp(w, http.StatusOK, map[string]string{"taskId": taskID})
}

// =========================================================================
// POST /api/analyze-gaps
// =========================================================================

type gapJSON struct {
	Topic         string   `json:"topic"`
	AnalysisTypes []string `json:"analysisTypes"`
	Papers        int      `json:"papers"`
	YearFilter    string   `json:"yearFilter"`
	Depth         string   `json:"depth"`
}

func (d *Deps) handlePostAnalyzeGaps(w http.ResponseWriter, r *http.Request) {
	ip := util.ClientIP(r.Header)
	if lim := d.Limiter.Check(ip); lim != nil {
		w.Header().Set("Retry-After", strconv.Itoa(lim.RetryAfter))
		jsonErr(w, lim.Code, lim.Message)
		return
	}
	if d.GapMgr.ActiveCount() >= 5 {
		d.Limiter.Release(ip)
		jsonErr(w, http.StatusTooManyRequests, "Server is busy. Please try again later.")
		return
	}

	var body gapJSON
	// Accept form-encoded too (htmx defaults to form-encoded).
	ctype := r.Header.Get("Content-Type")
	if strings.HasPrefix(ctype, "application/x-www-form-urlencoded") {
		if err := r.ParseForm(); err != nil {
			d.Limiter.Release(ip)
			jsonErr(w, http.StatusBadRequest, "Invalid form")
			return
		}
		body.Topic = r.FormValue("topic")
		body.Papers = parseInt(r.FormValue("papers"), 30)
		body.YearFilter = r.FormValue("yearFilter")
		body.Depth = r.FormValue("depth")
		if at := r.FormValue("analysisTypes"); at != "" {
			body.AnalysisTypes = []string{at}
		}
	} else {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			d.Limiter.Release(ip)
			jsonErr(w, http.StatusBadRequest, "Invalid request")
			return
		}
	}

	body.Topic = strings.TrimSpace(body.Topic)
	if body.Topic == "" {
		d.Limiter.Release(ip)
		jsonErr(w, http.StatusBadRequest, "Topic is required")
		return
	}
	if body.Papers == 0 {
		body.Papers = 30
	}
	body.Papers = clamp(body.Papers, 5, 100)
	depth := types.DepthQuick
	if body.Depth == "deep" {
		depth = types.DepthDeep
	}

	analysisTypes := make([]types.AnalysisType, 0, len(body.AnalysisTypes))
	if len(body.AnalysisTypes) == 0 {
		analysisTypes = []types.AnalysisType{types.AnalysisAll}
	} else {
		for _, t := range body.AnalysisTypes {
			analysisTypes = append(analysisTypes, types.AnalysisType(t))
		}
	}

	taskID := d.GapMgr.Create(body.Topic, body.Papers, analysisTypes, depth)

	go func() {
		defer d.Limiter.Release(ip)
		defer recoverGapProcessor(d, taskID)
		d.GapProcessor.Process(context.Background(), taskID, types.GapAnalysisRequest{
			Topic:         body.Topic,
			AnalysisTypes: analysisTypes,
			Papers:        body.Papers,
			YearFilter:    body.YearFilter,
			Depth:         depth,
		})
	}()

	if prefersHTML(r) {
		d.Renderer.Partial(w, http.StatusOK, "gap_started", map[string]any{"TaskID": taskID})
		return
	}
	jsonResp(w, http.StatusOK, map[string]string{"taskId": taskID})
}

// =========================================================================
// POST /api/download-gap-papers/{taskId}
// =========================================================================

func (d *Deps) handlePostDownloadGapPapers(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if !validateTaskID(taskID) {
		jsonErr(w, http.StatusBadRequest, "Invalid task ID")
		return
	}
	task := d.GapMgr.Get(taskID)
	if task == nil {
		jsonErr(w, http.StatusNotFound, "Task not found")
		return
	}
	if task.Status != types.GapComplete {
		jsonErr(w, http.StatusBadRequest, "Task not complete")
		return
	}

	ip := util.ClientIP(r.Header)
	if lim := d.Limiter.Check(ip); lim != nil {
		w.Header().Set("Retry-After", strconv.Itoa(lim.RetryAfter))
		jsonErr(w, lim.Code, lim.Message)
		return
	}
	if d.DownloadMgr.ActiveCount() >= 5 {
		d.Limiter.Release(ip)
		jsonErr(w, http.StatusTooManyRequests, "Server is busy. Please try again later.")
		return
	}

	taskDir, err := util.GetTaskDir(d.Cfg.DownloadDir, taskID)
	if err != nil {
		d.Limiter.Release(ip)
		jsonErr(w, http.StatusBadRequest, "Invalid task")
		return
	}
	data, err := os.ReadFile(filepath.Join(taskDir, "gap-analysis-result.json"))
	if err != nil {
		d.Limiter.Release(ip)
		jsonErr(w, http.StatusInternalServerError, "Failed to read gap analysis results")
		return
	}
	var result struct {
		Papers []types.Paper `json:"papers"`
	}
	if err := json.Unmarshal(data, &result); err != nil || len(result.Papers) == 0 {
		d.Limiter.Release(ip)
		jsonErr(w, http.StatusBadRequest, "No papers found in gap analysis results")
		return
	}

	dlID := d.DownloadMgr.Create(len(result.Papers), 1)
	go func() {
		defer d.Limiter.Release(ip)
		defer recoverProcessor(d, dlID)
		d.Processor.ProcessGapDownload(context.Background(), tasks.GapDownloadParams{
			TaskID: dlID, Papers: result.Papers,
		})
	}()

	if prefersHTML(r) {
		d.Renderer.Partial(w, http.StatusOK, "finder_started", map[string]any{"TaskID": dlID})
		return
	}
	jsonResp(w, http.StatusOK, map[string]string{"taskId": dlID})
}

// =========================================================================
// SSE progress
// =========================================================================

func (d *Deps) handleProgress(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if !validateTaskID(taskID) {
		jsonErr(w, http.StatusBadRequest, "Invalid task ID")
		return
	}
	if d.DownloadMgr.Get(taskID) == nil {
		jsonErr(w, http.StatusNotFound, "Task not found")
		return
	}
	WriteProgressStream(r.Context(), w, taskID, func(id string) (any, string, bool) {
		t := d.DownloadMgr.Get(id)
		if t == nil {
			return nil, "", false
		}
		return t, string(t.Status), true
	})
}

func (d *Deps) handleGapProgress(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if !validateTaskID(taskID) {
		jsonErr(w, http.StatusBadRequest, "Invalid task ID")
		return
	}
	if d.GapMgr.Get(taskID) == nil {
		jsonErr(w, http.StatusNotFound, "Task not found")
		return
	}
	WriteProgressStream(r.Context(), w, taskID, func(id string) (any, string, bool) {
		t := d.GapMgr.Get(id)
		if t == nil {
			return nil, "", false
		}
		return t, string(t.Status), true
	})
}

// =========================================================================
// File-backed endpoints
// =========================================================================

func (d *Deps) handleListPapers(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if !validateTaskID(taskID) {
		jsonErr(w, http.StatusBadRequest, "Invalid task ID")
		return
	}
	t := d.DownloadMgr.Get(taskID)
	if t == nil {
		jsonErr(w, http.StatusNotFound, "Task not found")
		return
	}
	if t.Status != types.TaskComplete {
		jsonErr(w, http.StatusBadRequest, "Task not complete")
		return
	}
	taskDir, err := util.GetTaskDir(d.Cfg.DownloadDir, taskID)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid task")
		return
	}
	entries, err := os.ReadDir(filepath.Join(taskDir, "papers"))
	if err != nil {
		jsonResp(w, http.StatusOK, []any{})
		return
	}
	out := []map[string]string{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(e.Name()), ".pdf") {
			continue
		}
		name := strings.TrimSuffix(e.Name(), ".pdf")
		name = strings.ReplaceAll(name, "_", " ")
		out = append(out, map[string]string{"filename": e.Name(), "name": name})
	}
	jsonResp(w, http.StatusOK, out)
}

func (d *Deps) handleMetadata(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if !validateTaskID(taskID) {
		jsonErr(w, http.StatusBadRequest, "Invalid task ID")
		return
	}
	t := d.DownloadMgr.Get(taskID)
	if t == nil || t.Status != types.TaskComplete {
		jsonErr(w, http.StatusBadRequest, "Task not complete")
		return
	}
	taskDir, err := util.GetTaskDir(d.Cfg.DownloadDir, taskID)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid task")
		return
	}
	path := filepath.Join(taskDir, "details.txt")
	if _, err := os.Stat(path); err != nil {
		jsonErr(w, http.StatusNotFound, "Metadata not found")
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	http.ServeFile(w, r, path)
}

func (d *Deps) handleDownloadType(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	dlType := chi.URLParam(r, "type")
	if !validateTaskID(taskID) {
		jsonErr(w, http.StatusBadRequest, "Invalid task ID")
		return
	}
	if dlType != "zip" && dlType != "metadata" {
		jsonErr(w, http.StatusBadRequest, "Invalid type. Use \"zip\" or \"metadata\"")
		return
	}
	t := d.DownloadMgr.Get(taskID)
	if t == nil || t.Status != types.TaskComplete {
		jsonErr(w, http.StatusBadRequest, "Task not complete")
		return
	}
	taskDir, err := util.GetTaskDir(d.Cfg.DownloadDir, taskID)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid task")
		return
	}
	switch dlType {
	case "metadata":
		path := filepath.Join(taskDir, "details.txt")
		if _, err := os.Stat(path); err != nil {
			jsonErr(w, http.StatusNotFound, "Metadata file not found")
			return
		}
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="jfinder_results.txt"`)
		http.ServeFile(w, r, path)
	case "zip":
		path := filepath.Join(taskDir, taskID+".zip")
		if _, err := os.Stat(path); err != nil {
			jsonErr(w, http.StatusNotFound, "ZIP file not found")
			return
		}
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="jfinder_`+taskID+`.zip"`)
		http.ServeFile(w, r, path)
	}
}

var previewName = regexp.MustCompile(`^[\w\s\-]+\.pdf$`)

func (d *Deps) handlePreview(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	filename := chi.URLParam(r, "filename")
	if !validateTaskID(taskID) {
		jsonErr(w, http.StatusBadRequest, "Invalid task ID")
		return
	}
	if !previewName.MatchString(filename) {
		jsonErr(w, http.StatusBadRequest, "Invalid filename")
		return
	}
	t := d.DownloadMgr.Get(taskID)
	if t == nil || t.Status != types.TaskComplete {
		jsonErr(w, http.StatusBadRequest, "Task not complete")
		return
	}
	taskDir, err := util.GetTaskDir(d.Cfg.DownloadDir, taskID)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid task")
		return
	}
	papersDir := filepath.Join(taskDir, "papers")
	abs, err := filepath.Abs(filepath.Join(papersDir, filename))
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid path")
		return
	}
	papersAbs, _ := filepath.Abs(papersDir)
	if !strings.HasPrefix(abs, papersAbs) {
		jsonErr(w, http.StatusBadRequest, "Invalid path")
		return
	}
	if _, err := os.Stat(abs); err != nil {
		jsonErr(w, http.StatusNotFound, "File not found")
		return
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", `inline; filename="`+filename+`"`)
	w.Header().Set("Cache-Control", "public, max-age=3600")
	http.ServeFile(w, r, abs)
}

func (d *Deps) handleExport(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	format := chi.URLParam(r, "format")
	if !validateTaskID(taskID) {
		jsonErr(w, http.StatusBadRequest, "Invalid task ID")
		return
	}
	if format != "bibtex" && format != "ris" {
		jsonErr(w, http.StatusBadRequest, "Invalid format. Use \"bibtex\" or \"ris\"")
		return
	}
	gapTask := d.GapMgr.Get(taskID)
	var papers []types.Paper
	if gapTask != nil && gapTask.Status == types.GapComplete {
		taskDir, err := util.GetTaskDir(d.Cfg.DownloadDir, taskID)
		if err == nil {
			data, err := os.ReadFile(filepath.Join(taskDir, "gap-analysis-result.json"))
			if err == nil {
				var result struct {
					Papers []types.Paper `json:"papers"`
				}
				if json.Unmarshal(data, &result) == nil {
					papers = result.Papers
				}
			}
		}
	}
	if len(papers) == 0 {
		dlTask := d.DownloadMgr.Get(taskID)
		if dlTask == nil {
			jsonErr(w, http.StatusNotFound, "Task not found")
			return
		}
		if dlTask.Status != types.TaskComplete {
			jsonErr(w, http.StatusBadRequest, "Task not complete")
			return
		}
		jsonErr(w, http.StatusBadRequest, "Citation export is available for gap analysis tasks")
		return
	}
	if format == "bibtex" {
		w.Header().Set("Content-Type", "application/x-bibtex")
		w.Header().Set("Content-Disposition", `attachment; filename="jfinder-`+taskID+`.bib"`)
		_, _ = w.Write([]byte(util.PapersToBibTeX(papers)))
		return
	}
	w.Header().Set("Content-Type", "application/x-research-info-systems")
	w.Header().Set("Content-Disposition", `attachment; filename="jfinder-`+taskID+`.ris"`)
	_, _ = w.Write([]byte(util.PapersToRIS(papers)))
}

func (d *Deps) handleGapResults(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	if !validateTaskID(taskID) {
		jsonErr(w, http.StatusBadRequest, "Invalid task ID")
		return
	}
	t := d.GapMgr.Get(taskID)
	if t == nil || t.Status != types.GapComplete {
		jsonErr(w, http.StatusBadRequest, "Task not complete")
		return
	}
	taskDir, err := util.GetTaskDir(d.Cfg.DownloadDir, taskID)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid task")
		return
	}
	path := filepath.Join(taskDir, "gap-analysis-result.json")
	if _, err := os.Stat(path); err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to read results")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	http.ServeFile(w, r, path)
}

func (d *Deps) handleGapReport(w http.ResponseWriter, r *http.Request) {
	taskID := chi.URLParam(r, "taskId")
	format := r.URL.Query().Get("format")
	if format == "" {
		format = "md"
	}
	if !validateTaskID(taskID) {
		jsonErr(w, http.StatusBadRequest, "Invalid task ID")
		return
	}
	t := d.GapMgr.Get(taskID)
	if t == nil || t.Status != types.GapComplete {
		jsonErr(w, http.StatusBadRequest, "Task not complete")
		return
	}
	taskDir, err := util.GetTaskDir(d.Cfg.DownloadDir, taskID)
	if err != nil {
		jsonErr(w, http.StatusBadRequest, "Invalid task")
		return
	}
	path := filepath.Join(taskDir, "gap-analysis-report.md")
	if _, err := os.Stat(path); err != nil {
		jsonErr(w, http.StatusNotFound, "Report not available")
		return
	}
	content, err := os.ReadFile(path)
	if err != nil {
		jsonErr(w, http.StatusInternalServerError, "Failed to read report")
		return
	}
	if format == "md" {
		w.Header().Set("Content-Type", "text/markdown")
		w.Header().Set("Content-Disposition", `attachment; filename="gap-analysis-`+taskID+`.md"`)
		_, _ = w.Write(content)
		return
	}
	jsonResp(w, http.StatusOK, map[string]string{"content": string(content)})
}

// =========================================================================
// /api/suggest + /api/related-papers
// =========================================================================

func (d *Deps) handleSuggest(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) < 2 {
		jsonResp(w, http.StatusOK, []any{})
		return
	}
	apiURL := "https://api.openalex.org/autocomplete/concepts?q=" + url.QueryEscape(q) + "&mailto=" + url.QueryEscape(d.Cfg.ContactEmail)
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		jsonResp(w, http.StatusOK, []any{})
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		jsonResp(w, http.StatusOK, []any{})
		return
	}
	var data struct {
		Results []struct {
			DisplayName string `json:"display_name"`
			WorksCount  int    `json:"works_count"`
		} `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		jsonResp(w, http.StatusOK, []any{})
		return
	}
	out := []map[string]any{}
	for i, r := range data.Results {
		if i >= 8 {
			break
		}
		out = append(out, map[string]any{"name": r.DisplayName, "works": r.WorksCount})
	}
	w.Header().Set("Cache-Control", "public, max-age=300")
	jsonResp(w, http.StatusOK, out)
}

func (d *Deps) handleRelatedPapers(w http.ResponseWriter, r *http.Request) {
	doi := chi.URLParam(r, "doi")
	if doi == "" {
		jsonErr(w, http.StatusBadRequest, "DOI is required")
		return
	}
	direction := r.URL.Query().Get("direction")
	if direction == "" {
		direction = "both"
	}
	count := parseInt(r.URL.Query().Get("count"), 10)
	if count > 25 {
		count = 25
	}
	if count <= 0 {
		count = 10
	}
	result := map[string]any{"citedBy": []any{}, "references": []any{}}
	if direction == "citedBy" || direction == "both" {
		result["citedBy"] = d.OpenAlex.GetCitedBy(r.Context(), doi, count)
	}
	if direction == "references" || direction == "both" {
		result["references"] = d.OpenAlex.GetReferences(r.Context(), doi, count)
	}
	jsonResp(w, http.StatusOK, result)
}

// =========================================================================
// helpers
// =========================================================================

func parseInt(s string, def int) int {
	n, err := strconv.Atoi(strings.TrimSpace(s))
	if err != nil {
		return def
	}
	return n
}

func recoverProcessor(d *Deps, taskID string) {
	if r := recover(); r != nil {
		d.Logger.Error("processor panic", "taskId", taskID, "err", fmt.Sprint(r))
		d.DownloadMgr.Fail(taskID, "Processing failed")
	}
}

func recoverGapProcessor(d *Deps, taskID string) {
	if r := recover(); r != nil {
		d.Logger.Error("gap processor panic", "taskId", taskID, "err", fmt.Sprint(r))
		d.GapMgr.Fail(taskID, "Analysis failed")
	}
}

// unused noop to keep errors import grounded if compiler complains in some configs
var _ = errors.New
