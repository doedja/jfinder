package search

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/doedja/jfinder/internal/config"
	"github.com/doedja/jfinder/internal/types"
	"github.com/doedja/jfinder/internal/util"
)

type ScopusService struct {
	cfg    *config.Config
	client *http.Client
}

func NewScopus(cfg *config.Config) *ScopusService {
	return &ScopusService{
		cfg:    cfg,
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (s *ScopusService) Name() string { return "Scopus" }

type scopusResponse struct {
	SearchResults *searchResults `json:"search-results"`
}
type searchResults struct {
	Entry []scopusEntry `json:"entry"`
}
type scopusEntry struct {
	DcTitle           string `json:"dc:title"`
	DcCreator         string `json:"dc:creator"`
	PrismPublicationName string `json:"prism:publicationName"`
	PrismCoverDate    string `json:"prism:coverDate"`
	PrismDOI          string `json:"prism:doi"`
}

func (s *ScopusService) Search(ctx context.Context, p SearchParams) []types.Paper {
	baseURL := s.cfg.ScopusAPIURL
	query := url.Values{}
	q := p.Query
	if p.StartYear > 0 || p.EndYear > 0 {
		parts := []string{q}
		if p.StartYear > 0 {
			parts = append(parts, "AND PUBYEAR AFT "+strconv.Itoa(p.StartYear-1))
		}
		if p.EndYear > 0 {
			parts = append(parts, "AND PUBYEAR BEF "+strconv.Itoa(p.EndYear+1))
		}
		q = strings.Join(parts, " ")
	}
	query.Set("query", q)
	query.Set("view", "STANDARD")
	query.Set("count", strconv.Itoa(p.Count))
	reqURL := baseURL + "?" + query.Encode()

	var resp scopusResponse
	_, err := util.WithRetry(ctx, func(ctx context.Context) (scopusResponse, error) {
		req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
		if err != nil {
			return resp, err
		}
		req.Header.Set("X-ELS-APIKey", s.cfg.ScopusAPIKey)
		httpResp, err := s.client.Do(req)
		if err != nil {
			return resp, err
		}
		defer httpResp.Body.Close()
		if httpResp.StatusCode >= 500 || httpResp.StatusCode == 429 {
			return resp, fmt.Errorf("Scopus returned %d", httpResp.StatusCode)
		}
		if httpResp.StatusCode != 200 {
			return resp, nil
		}
		body, _ := io.ReadAll(httpResp.Body)
		err = json.Unmarshal(body, &resp)
		return resp, err
	}, 2, time.Second)
	if err != nil || resp.SearchResults == nil || len(resp.SearchResults.Entry) == 0 {
		return nil
	}

	papers := make([]types.Paper, 0, len(resp.SearchResults.Entry))
	for _, e := range resp.SearchResults.Entry {
		paper := types.Paper{
			Title:   e.DcTitle,
			Authors: e.DcCreator,
			Journal: e.PrismPublicationName,
			DOI:     e.PrismDOI,
		}
		if idx := strings.Index(e.PrismCoverDate, "-"); idx > 0 {
			paper.Year = e.PrismCoverDate[:idx]
		} else {
			paper.Year = e.PrismCoverDate
		}
		if paper.Year == "" {
			paper.Year = "Unknown Year"
		}
		if paper.Authors == "" {
			paper.Authors = "Unknown Authors"
		}
		if paper.Journal == "" {
			paper.Journal = "Unknown Journal"
		}
		papers = append(papers, paper)
	}
	return papers
}

func (s *ScopusService) LookupByDOI(ctx context.Context, doi string) *types.Paper {
	baseURL := s.cfg.ScopusAPIURL
	query := url.Values{}
	query.Set("query", "DOI("+doi+")")
	query.Set("view", "STANDARD")
	query.Set("count", "1")
	reqURL := baseURL + "?" + query.Encode()

	var resp scopusResponse
	_, err := util.WithRetry(ctx, func(ctx context.Context) (scopusResponse, error) {
		req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
		if err != nil {
			return resp, err
		}
		req.Header.Set("X-ELS-APIKey", s.cfg.ScopusAPIKey)
		httpResp, err := s.client.Do(req)
		if err != nil {
			return resp, err
		}
		defer httpResp.Body.Close()
		if httpResp.StatusCode >= 500 || httpResp.StatusCode == 429 {
			return resp, fmt.Errorf("Scopus returned %d", httpResp.StatusCode)
		}
		if httpResp.StatusCode != 200 {
			return resp, nil
		}
		body, _ := io.ReadAll(httpResp.Body)
		err = json.Unmarshal(body, &resp)
		return resp, err
	}, 2, time.Second)
	if err != nil || resp.SearchResults == nil || len(resp.SearchResults.Entry) == 0 {
		return &types.Paper{Title: "Title Not Found", DOI: doi, Authors: "Unknown Authors", Journal: "Unknown Journal", Year: "Unknown Year"}
	}
	e := resp.SearchResults.Entry[0]
	paper := &types.Paper{
		Title:   e.DcTitle,
		Authors: e.DcCreator,
		Journal: e.PrismPublicationName,
		DOI:     e.PrismDOI,
	}
	if idx := strings.Index(e.PrismCoverDate, "-"); idx > 0 {
		paper.Year = e.PrismCoverDate[:idx]
	} else {
		paper.Year = e.PrismCoverDate
	}
	if paper.Year == "" {
		paper.Year = "Unknown Year"
	}
	if paper.Authors == "" {
		paper.Authors = "Unknown Authors"
	}
	if paper.Journal == "" {
		paper.Journal = "Unknown Journal"
	}
	return paper
}

func (s *ScopusService) ProcessDOIList(ctx context.Context, dois []string, onProgress func(current, total int)) []types.Paper {
	papers := make([]types.Paper, 0, len(dois))
	for i, doi := range dois {
		select {
		case <-ctx.Done():
			return papers
		default:
		}
		if onProgress != nil {
			onProgress(i+1, len(dois))
		}
		paper := s.LookupByDOI(ctx, doi)
		if paper != nil {
			papers = append(papers, *paper)
		}
		time.Sleep(1 * time.Second)
	}
	return papers
}
