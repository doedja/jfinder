package web

import (
	"bytes"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/doedja/jfinder/internal/config"
)

// Renderer manages template rendering with a shared layout.
type Renderer struct {
	tpl   *template.Template
	cfg   *config.Config
	pages map[string]*template.Template
}

// PageData holds SEO and page-specific variables for templates.
type PageData struct {
	Title       string
	Description string
	Canonical   string
	BaseURL     string
	Theme       string
	UmamiSrc    string
	UmamiID     string
	JSONLD      template.JS
	Extra       any
	TaskID      string
	Message     string
}

// LoadRenderer parses templates/*.html and templates/partials/*.html,
// builds a separate template per page, and returns a Renderer.
func LoadRenderer(cfg *config.Config, templatesDir string) (*Renderer, error) {
	r := &Renderer{
		cfg:   cfg,
		pages: make(map[string]*template.Template),
	}

	base := template.New("")

	// Parse all root .html files (layout + pages) into the same tree.
	rootGlob := filepath.Join(templatesDir, "*.html")
	if _, err := base.ParseGlob(rootGlob); err != nil {
		return nil, fmt.Errorf("parse root templates: %w", err)
	}

	// Parse partials into the same tree.
	partialsGlob := filepath.Join(templatesDir, "partials", "*.html")
	if _, err := base.ParseGlob(partialsGlob); err != nil {
		return nil, fmt.Errorf("parse partials: %w", err)
	}

	r.tpl = base

	// Build a dedicated template for each page so its "content" definition is isolated.
	entries, err := os.ReadDir(templatesDir)
	if err != nil {
		return nil, fmt.Errorf("read templates dir: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".html") || name == "base.html" {
			continue
		}
		pageName := strings.TrimSuffix(name, ".html")
		pagePath := filepath.Join(templatesDir, name)

		cloned := template.Must(r.tpl.Clone())
		if _, err := cloned.ParseFiles(pagePath); err != nil {
			return nil, fmt.Errorf("parse page %q: %w", name, err)
		}
		r.pages[pageName] = cloned
	}

	// Verify required templates exist.
	if r.tpl.Lookup("base") == nil {
		return nil, fmt.Errorf("missing required template: base")
	}
	for _, required := range []string{"finder_started", "gap_started", "error"} {
		if r.tpl.Lookup(required) == nil {
			return nil, fmt.Errorf("missing required partial: %s", required)
		}
	}
	// At least one page must define "content".
	hasContent := false
	for _, p := range r.pages {
		if p.Lookup("content") != nil {
			hasContent = true
			break
		}
	}
	if !hasContent {
		return nil, fmt.Errorf("no page defines content template")
	}

	return r, nil
}

// Page renders "base" with the named page's "content" definition.
func (r *Renderer) Page(w http.ResponseWriter, status int, name string, data PageData) {
	tpl, ok := r.pages[name]
	if !ok {
		http.Error(w, "page not found", http.StatusInternalServerError)
		return
	}

	buf := new(bytes.Buffer)
	if err := tpl.ExecuteTemplate(buf, "base", data); err != nil {
		log.Printf("page render error: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	buf.WriteTo(w)
}

// Partial renders a single named template (no layout) for htmx swaps.
func (r *Renderer) Partial(w http.ResponseWriter, status int, name string, data any) {
	buf := new(bytes.Buffer)
	if err := r.tpl.ExecuteTemplate(buf, name, data); err != nil {
		log.Printf("partial render error: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	buf.WriteTo(w)
}
