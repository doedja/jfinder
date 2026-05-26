package download

import (
	"strings"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/doedja/jfinder/internal/util"
)

type UnpaywallService struct {
	logger *util.Logger
	client *http.Client
	mailto string
}

func NewUnpaywall(mailto string) *UnpaywallService {
	return &UnpaywallService{
		logger: util.Default,
		client: &http.Client{Timeout: 30 * time.Second},
		mailto: mailto,
	}
}

type unpaywallResponse struct {
	IsOA           bool                `json:"is_oa"`
	BestOALocation *unpaywallLocation  `json:"best_oa_location"`
	OALocations    []unpaywallLocation `json:"oa_locations"`
}
type unpaywallLocation struct {
	URL       string `json:"url"`
	URLForPDF string `json:"url_for_pdf"`
	License   string `json:"license"`
	Version   string `json:"version"`
}

func (s *UnpaywallService) GetOAURL(ctx context.Context, doi string) string {
	apiURL := fmt.Sprintf("https://api.unpaywall.org/v2/%s?email=%s", url.PathEscape(doi), s.mailto)
	req, err := http.NewRequestWithContext(ctx, "GET", apiURL, nil)
	if err != nil {
		return ""
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return ""
	}
	var data unpaywallResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return ""
	}
	if !data.IsOA {
		return ""
	}
	if data.BestOALocation != nil {
		if data.BestOALocation.URLForPDF != "" {
			return data.BestOALocation.URLForPDF
		}
		if data.BestOALocation.URL != "" {
			return data.BestOALocation.URL
		}
	}
	for _, loc := range data.OALocations {
		if loc.URLForPDF != "" {
			return loc.URLForPDF
		}
		if loc.URL != "" {
			return loc.URL
		}
	}
	return ""
}

func (s *UnpaywallService) Download(ctx context.Context, doi string) []byte {
	url := s.GetOAURL(ctx, doi)
	if url == "" {
		return nil
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	for k, v := range browserHeaders {
		req.Header.Set(k, v)
	}
	req.Header.Set("Accept", "application/pdf,application/octet-stream,*/*")
	resp, err := s.client.Do(req)
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
