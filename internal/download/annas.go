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
	"github.com/doedja/jfinder/internal/util"
)

type AnnasService struct {
	logger *util.Logger
	client *http.Client
}

func NewAnnas() *AnnasService {
	return &AnnasService{
		logger: util.Default,
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (s *AnnasService) Download(ctx context.Context, doi string) []byte {
	searchURL := fmt.Sprintf("https://annas-archive.org/search?q=%s", url.QueryEscape(doi))
	req, _ := http.NewRequestWithContext(ctx, "GET", searchURL, nil)
	for k, v := range browserHeaders {
		req.Header.Set(k, v)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return nil
	}
	var md5 string
	doc.Find("a[href*='/md5/']").Each(func(i int, sel *goquery.Selection) {
		href, exists := sel.Attr("href")
		if exists && md5 == "" {
			re := regexp.MustCompile(`/md5/([a-fA-F0-9]+)`)
			matches := re.FindStringSubmatch(href)
			if len(matches) >= 2 {
				md5 = matches[1]
			}
		}
	})
	if md5 == "" {
		return nil
	}
	detailURL := fmt.Sprintf("https://annas-archive.org/md5/%s", md5)
	req2, _ := http.NewRequestWithContext(ctx, "GET", detailURL, nil)
	for k, v := range browserHeaders {
		req2.Header.Set(k, v)
	}
	resp2, err := s.client.Do(req2)
	if err != nil {
		return nil
	}
	defer resp2.Body.Close()
	doc2, err := goquery.NewDocumentFromReader(resp2.Body)
	if err != nil {
		return nil
	}
	var downloadLinks []string
	doc2.Find("a[href]").Each(func(i int, sel *goquery.Selection) {
		href, exists := sel.Attr("href")
		if !exists {
			return
		}
		if strings.Contains(href, "download") && (strings.Contains(href, ".pdf") || strings.Contains(href, "libgen") || strings.Contains(href, "ipfs")) {
			downloadLinks = append(downloadLinks, href)
		}
		if strings.Contains(href, "libgen") {
			downloadLinks = append(downloadLinks, href)
		}
		if strings.Contains(href, "/slow_download/") {
			downloadLinks = append(downloadLinks, href)
		}
	})
	for _, link := range downloadLinks {
		linkURL := resolveURL(detailURL, link)
		data := s.tryDownloadLink(ctx, linkURL, 60*time.Second)
		if data != nil {
			return data
		}
	}
	return nil
}

func (s *AnnasService) tryDownloadLink(ctx context.Context, linkURL string, timeout time.Duration) []byte {
	client := &http.Client{Timeout: timeout}
	req, _ := http.NewRequestWithContext(ctx, "GET", linkURL, nil)
	for k, v := range browserHeaders {
		req.Header.Set(k, v)
	}
	req.Header.Set("Accept", "application/pdf,application/octet-stream,*/*")
	resp, err := client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	ct := resp.Header.Get("Content-Type")
	if strings.Contains(ct, "text/html") {
		doc, err := goquery.NewDocumentFromReader(resp.Body)
		if err != nil {
			return nil
		}
		var innerPDF string
		doc.Find("a[href]").Each(func(i int, sel *goquery.Selection) {
			href, exists := sel.Attr("href")
			if exists && strings.Contains(href, ".pdf") {
				innerPDF = href
			}
		})
		if innerPDF != "" {
			return s.tryDownloadLink(ctx, resolveURL(linkURL, innerPDF), timeout)
		}
		return nil
	}
	data, _ := io.ReadAll(resp.Body)
	if isPDF(data) {
		return data
	}
	if strings.Contains(ct, "pdf") || strings.Contains(ct, "octet-stream") {
		return data
	}
	return nil
}
