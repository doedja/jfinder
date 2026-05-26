package web

import (
	"bufio"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/doedja/jfinder/internal/config"
	"github.com/doedja/jfinder/internal/download"
	"github.com/doedja/jfinder/internal/llm"
	"github.com/doedja/jfinder/internal/proxy"
	"github.com/doedja/jfinder/internal/search"
	"github.com/doedja/jfinder/internal/tasks"
	"github.com/doedja/jfinder/internal/util"
)

// findTemplatesDir walks up from the current working directory to locate
// templates/base.html. It returns the absolute templates directory.
func findTemplatesDir(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal("cannot get working directory:", err)
	}
	for i := 0; i < 6; i++ {
		p := filepath.Join(wd, "templates", "base.html")
		if _, err := os.Stat(p); err == nil {
			return filepath.Join(wd, "templates")
		}
		wd = filepath.Dir(wd)
	}
	t.Fatal("templates/base.html not found relative to test cwd")
	return ""
}

// bootTest creates a configured server ready for integration testing.
// It returns the base URL and a cleanup function that closes the server.
func bootTest(t *testing.T) (baseURL string, cleanup func()) {
	t.Helper()

	t.Setenv("LLM_API_KEY", "sk-test-dummy")
	t.Setenv("LLM_PROVIDER", "deepseek")
	t.Setenv("LLM_MODEL", "deepseek-chat")
	t.Setenv("DOWNLOAD_DIR", t.TempDir())
	t.Setenv("BASE_URL", "http://localhost:9999")
	t.Setenv("PORT", "0")

	cfg, err := config.Load()
	if err != nil {
		t.Fatal("config load:", err)
	}

	log := util.New()
	limiter := util.NewLimiter()
	proxySvc := proxy.NewService(cfg)
	provider := search.ChooseProvider(cfg)
	openAlex := search.NewOpenAlex(cfg)

	// TODO: production LLM client does not expose base URL override;
	// this test uses the real client which may contact a real endpoint.
	llmClient := llm.New(cfg)
	engine := download.NewEngine(cfg, proxySvc)
	dlMgr := tasks.NewDownloadManager(cfg, log)
	gapMgr := tasks.NewGapManager(cfg, log)
	processor := tasks.NewProcessor(cfg, dlMgr, provider, llmClient, engine)
	gapProc := tasks.NewGapProcessor(cfg, gapMgr, provider, llmClient)

	tdir := findTemplatesDir(t)
	renderer, err := LoadRenderer(cfg, tdir)
	if err != nil {
		t.Fatal("load renderer:", err)
	}

	deps := &Deps{
		Cfg:           cfg,
		Logger:        log,
		Limiter:       limiter,
		DownloadMgr:   dlMgr,
		GapMgr:        gapMgr,
		Processor:     processor,
		GapProcessor:  gapProc,
		Provider:      provider,
		OpenAlex:      openAlex,
		LLM:           llmClient,
		Engine:        engine,
		Renderer:      renderer,
	}

	r := chi.NewRouter()
	staticDir := filepath.Join(filepath.Dir(tdir), "static")
	r.Handle("/static/*", http.StripPrefix("/static/", http.FileServer(http.Dir(staticDir))))
	Mount(r, deps)

	ts := httptest.NewServer(r)
	return ts.URL, ts.Close
}

// TestPagesRender checks that basic pages and static assets are served.
func TestPagesRender(t *testing.T) {
	baseURL, cleanup := bootTest(t)
	t.Cleanup(cleanup)

	t.Run("home", func(t *testing.T) {
		res, err := http.Get(baseURL + "/")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Errorf("GET / returned %d, want 200", res.StatusCode)
		}
		if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
			t.Errorf("Content-Type = %q, want text/html", ct)
		}
		body := readBody(t, res)
		if !strings.Contains(body, "JFinder") {
			t.Error("home page does not mention JFinder")
		}
	})

	t.Run("features", func(t *testing.T) {
		res, err := http.Get(baseURL + "/features")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Errorf("GET /features returned %d, want 200", res.StatusCode)
		}
		if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
			t.Errorf("Content-Type = %q, want text/html", ct)
		}
		body := readBody(t, res)
		if !strings.Contains(body, "Features") {
			t.Error("features page does not contain 'Features'")
		}
	})

	t.Run("sitemap.xml", func(t *testing.T) {
		res, err := http.Get(baseURL + "/sitemap.xml")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Errorf("GET /sitemap.xml returned %d, want 200", res.StatusCode)
		}
		if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/xml") {
			t.Errorf("Content-Type = %q, want application/xml", ct)
		}
		body := readBody(t, res)
		if !strings.Contains(body, "http://localhost:9999") {
			t.Error("sitemap does not contain configured base URL")
		}
	})

	t.Run("robots.txt", func(t *testing.T) {
		res, err := http.Get(baseURL + "/robots.txt")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Errorf("GET /robots.txt returned %d, want 200", res.StatusCode)
		}
		if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
			t.Errorf("Content-Type = %q, want text/plain", ct)
		}
		body := readBody(t, res)
		if !strings.Contains(body, "/api/") {
			t.Error("robots.txt does not mention /api/")
		}
	})

	t.Run("static/css/main.css", func(t *testing.T) {
		staticDir := filepath.Join(filepath.Dir(findTemplatesDir(t)), "static")
		if _, err := os.Stat(filepath.Join(staticDir, "css", "main.css")); os.IsNotExist(err) {
			t.Skip("static/css/main.css not found, skipping")
		}
		res, err := http.Get(baseURL + "/static/css/main.css")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Errorf("GET /static/css/main.css returned %d, want 200", res.StatusCode)
		}
		if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/css") {
			t.Errorf("Content-Type = %q, want text/css", ct)
		}
	})
}

// TestSearchValidation checks the /api/search endpoint input handling.
func TestSearchValidation(t *testing.T) {
	baseURL, cleanup := bootTest(t)
	t.Cleanup(cleanup)

	t.Run("empty body", func(t *testing.T) {
		res, err := http.Post(baseURL+"/api/search", "application/json", nil)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("empty body: got %d, want 400", res.StatusCode)
		}
	})

	t.Run("empty topic", func(t *testing.T) {
		body := strings.NewReader(`{"topic":""}`)
		res, err := http.Post(baseURL+"/api/search", "application/json", body)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		// The handler may accept empty topic if DOI is provided; we expect 400
		// because DOI is also empty.
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("empty topic: got %d, want 400", res.StatusCode)
		}
	})

	t.Run("valid request", func(t *testing.T) {
		payload := `{"topic":"x","cycles":3,"papers":5}`
		res, err := http.Post(baseURL+"/api/search", "application/json", strings.NewReader(payload))
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Errorf("valid request: got %d, want 200", res.StatusCode)
		}
		var result map[string]interface{}
		if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
			t.Fatal("decode response:", err)
		}
		if _, ok := result["taskId"]; !ok {
			t.Error("response does not contain taskId")
		}
	})
}

// TestProgressSSE verifies that the progress endpoint streams SSE events.
func TestProgressSSE(t *testing.T) {
	baseURL, cleanup := bootTest(t)
	t.Cleanup(cleanup)

	// Create a task first.
	payload := `{"topic":"x","cycles":1,"papers":1}`
	res, err := http.Post(baseURL+"/api/search", "application/json", strings.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create task: got %d, want 200", res.StatusCode)
	}
	var taskResp map[string]interface{}
	if err := json.NewDecoder(res.Body).Decode(&taskResp); err != nil {
		t.Fatal("decode create task response:", err)
	}
	taskID, ok := taskResp["taskId"].(string)
	if !ok || taskID == "" {
		t.Fatal("taskId missing in create response")
	}

	// Open SSE stream.
	req, err := http.NewRequest("GET", baseURL+"/api/progress/"+taskID, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Accept", "text/event-stream")
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	scanner := bufio.NewScanner(resp.Body)
	lines := make(chan string, 1)
	go func() {
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "data:") {
				lines <- line
				return
			}
		}
		close(lines)
	}()

	select {
	case line := <-lines:
		if line == "" {
			t.Error("received empty data line")
		}
	case <-time.After(2 * time.Second):
		t.Error("timeout waiting for SSE data line within 2s")
	}
}

// TestExportRequiresComplete checks export endpoint behaviour for incomplete tasks.
func TestExportRequiresComplete(t *testing.T) {
	baseURL, cleanup := bootTest(t)
	t.Cleanup(cleanup)

	t.Run("unknown task returns 404", func(t *testing.T) {
		id := "00000000-0000-0000-0000-000000000000"
		res, err := http.Get(baseURL + "/api/export/" + id + "/bibtex")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Errorf("unknown task: got %d, want 404", res.StatusCode)
		}
	})

	t.Run("invalid format returns 400", func(t *testing.T) {
		id := "00000000-0000-0000-0000-000000000000"
		res, err := http.Get(baseURL + "/api/export/" + id + "/invalid")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusBadRequest {
			t.Errorf("invalid format: got %d, want 400", res.StatusCode)
		}
	})
}

// TestSuggest checks the suggest endpoint.
func TestSuggest(t *testing.T) {
	baseURL, cleanup := bootTest(t)
	t.Cleanup(cleanup)

	t.Run("empty query returns empty", func(t *testing.T) {
		res, err := http.Get(baseURL + "/api/suggest?q=")
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Errorf("empty query: got %d, want 200", res.StatusCode)
		}
		var result []interface{}
		if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
			t.Fatal("decode response:", err)
		}
		if len(result) != 0 {
			t.Errorf("expected empty slice, got %d items", len(result))
		}
	})

	t.Run("real query against OpenAlex", func(t *testing.T) {
		res, err := http.Get(baseURL + "/api/suggest?q=ai")
		if err != nil {
			t.Skip("network error, skipping:", err)
		}
		defer res.Body.Close()
		if res.StatusCode != http.StatusOK {
			t.Errorf("real query: got %d, want 200", res.StatusCode)
		}
		var result []interface{}
		if err := json.NewDecoder(res.Body).Decode(&result); err != nil {
			t.Error("decode response:", err)
		}
		// We do not enforce non-empty; if OpenAlex is online we likely get results.
	})
}

// readBody is a helper for tests to read the full response body.
func readBody(t *testing.T, res *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatal("reading body:", err)
	}
	return string(b)
}
