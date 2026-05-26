package download

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
	"github.com/doedja/jfinder/internal/proxy"
	"github.com/doedja/jfinder/internal/util"
)

var browserHeaders = map[string]string{
	"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	"Accept":     "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
}

type ScihubService struct {
	proxy  *proxy.Service
	logger *util.Logger
}

func NewScihub(p *proxy.Service) *ScihubService {
	return &ScihubService{proxy: p, logger: util.Default}
}

var scihubDomains = []string{
	"https://sci-hub.se",
	"https://sci-hub.st",
	"https://sci-hub.ru",
	"https://sci-hub.wf",
	"https://sci-hub.ren",
}

func (s *ScihubService) Download(ctx context.Context, doi string) []byte {
	for _, domain := range scihubDomains {
		data := s.tryDomain(ctx, domain, doi)
		if data != nil {
			return data
		}
	}
	// last resort: https://doi.org/<doi>
	fallbackURL := fmt.Sprintf("https://doi.org/%s", doi)
	client := &http.Client{Timeout: 20 * time.Second}
	req, _ := http.NewRequestWithContext(ctx, "GET", fallbackURL, nil)
	for k, v := range browserHeaders {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return nil
	}
	var pdfURL string
	doc.Find("a[href]").Each(func(i int, sel *goquery.Selection) {
		href, ok := sel.Attr("href")
		if !ok {
			return
		}
		if strings.Contains(href, ".pdf") || strings.Contains(href, "download") {
			pdfURL = href
		}
	})
	if pdfURL != "" {
		return s.fetchPDF(ctx, pdfURL, client)
	}
	return nil
}

func (s *ScihubService) tryDomain(ctx context.Context, domain, doi string) []byte {
	client := buildClient(s.proxy.GetRandom(ctx), 20*time.Second)
	searchURL := fmt.Sprintf("%s/%s", domain, doi)
	req, _ := http.NewRequestWithContext(ctx, "GET", searchURL, nil)
	for k, v := range browserHeaders {
		req.Header.Set(k, v)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return nil
	}

	// Extract PDF link in order
	var pdfURL string
	// 1. #buttons button[onclick] matching /['"]([^'"]*\.pdf)['"]/
	doc.Find("#buttons button[onclick]").Each(func(i int, sel *goquery.Selection) {
		onclick, _ := sel.Attr("onclick")
		if onclick == "" {
			return
		}
		re := regexp.MustCompile(`['"]([^'"]*\.pdf)['"]`)
		matches := re.FindStringSubmatch(onclick)
		if len(matches) >= 2 {
			pdfURL = matches[1]
		}
	})
	if pdfURL == "" {
		// 2. embed[type="application/pdf"] src
		embedSel := doc.Find("embed[type='application/pdf']")
		src, exists := embedSel.Attr("src")
		if exists {
			pdfURL = src
			if idx := strings.Index(pdfURL, "#"); idx != -1 {
				pdfURL = pdfURL[:idx]
			}
		}
	}
	if pdfURL == "" {
		// 3. iframe src
		iframeSel := doc.Find("iframe")
		src, exists := iframeSel.Attr("src")
		if exists {
			pdfURL = src
		}
	}
	if pdfURL == "" {
		return nil
	}
	pdfURL = resolveURL(domain, pdfURL)
	return s.fetchPDF(ctx, pdfURL, client)
}

func resolveURL(base, rel string) string {
	u, err := url.Parse(rel)
	if err != nil {
		return rel
	}
	if u.IsAbs() {
		return rel
	}
	baseURL, err := url.Parse(base)
	if err != nil {
		return rel
	}
	return baseURL.ResolveReference(u).String()
}

func (s *ScihubService) fetchPDF(ctx context.Context, pdfURL string, client *http.Client) []byte {
	req, _ := http.NewRequestWithContext(ctx, "GET", pdfURL, nil)
	for k, v := range browserHeaders {
		req.Header.Set(k, v)
	}
	req.Header.Set("Accept", "application/pdf,application/octet-stream,*/*")
	resp, err := client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if isPDF(data) {
		return data
	}
	ct := resp.Header.Get("Content-Type")
	if strings.Contains(ct, "pdf") {
		return data
	}
	return nil
}

func isPDF(data []byte) bool {
	return len(data) >= 4 && string(data[:4]) == "%PDF"
}
