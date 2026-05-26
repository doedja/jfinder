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

type LibgenService struct {
	logger *util.Logger
}

func NewLibgen() *LibgenService {
	return &LibgenService{logger: util.Default}
}

var libgenMirrors = []string{
	"https://libgen.is",
	"https://libgen.rs",
	"https://libgen.st",
}

func (s *LibgenService) Download(ctx context.Context, doi string) []byte {
	for _, mirror := range libgenMirrors {
		data := s.tryMirror(ctx, mirror, doi)
		if data != nil {
			return data
		}
	}
	return nil
}

func (s *LibgenService) tryMirror(ctx context.Context, mirror, doi string) []byte {
	searchURL := fmt.Sprintf("%s/scimag/?q=%s", mirror, url.QueryEscape(doi))
	client := &http.Client{Timeout: 15 * time.Second}
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

	var links []string
	var md5 string
	doc.Find("table tbody tr a[href]").Each(func(i int, sel *goquery.Selection) {
		href, ok := sel.Attr("href")
		if !ok {
			return
		}
		if strings.Contains(href, "get.php") || strings.Contains(href, "ads.php") || strings.Contains(href, "download") {
			links = append(links, href)
		}
		if md5 == "" {
			re := regexp.MustCompile(`[a-fA-F0-9]{32}`)
			if re.MatchString(href) {
				md5 = re.FindString(href)
			}
		}
	})
	for _, link := range links {
		linkURL := resolveURL(mirror, link)
		data := s.tryDownloadLink(ctx, linkURL, 45*time.Second)
		if data != nil {
			return data
		}
	}
	if md5 != "" {
		fallbackURL := fmt.Sprintf("https://download.library.lol/scimag/%s/%s.pdf", md5[:2], md5)
		data := s.tryDownloadLink(ctx, fallbackURL, 45*time.Second)
		if data != nil {
			return data
		}
	}
	fallbackDOI := fmt.Sprintf("http://libgen.lc/scimag/get.php?doi=%s", url.QueryEscape(doi))
	return s.tryDownloadLink(ctx, fallbackDOI, 45*time.Second)
}

func (s *LibgenService) tryDownloadLink(ctx context.Context, linkURL string, timeout time.Duration) []byte {
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
		var innerLink string
		doc.Find("a").Each(func(i int, sel *goquery.Selection) {
			text := strings.TrimSpace(sel.Text())
			if strings.ToUpper(text) == "GET" {
				href, _ := sel.Attr("href")
				innerLink = href
			}
			if innerLink == "" {
				href, _ := sel.Attr("href")
				if href != "" && (strings.Contains(href, ".pdf") || strings.Contains(href, "download")) {
					innerLink = href
				}
			}
		})
		if innerLink == "" {
			doc.Find("#download a").Each(func(i int, sel *goquery.Selection) {
				href, _ := sel.Attr("href")
				if href != "" && innerLink == "" {
					innerLink = href
				}
			})
		}
		if innerLink != "" {
			innerURL := resolveURL(linkURL, innerLink)
			return s.tryDownloadLink(ctx, innerURL, timeout)
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
