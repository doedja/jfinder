package search

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/doedja/jfinder/internal/config"
	"github.com/doedja/jfinder/internal/types"
	"github.com/doedja/jfinder/internal/util"
)

type OpenAlexService struct {
	cfg    *config.Config
	client *http.Client
}

func NewOpenAlex(cfg *config.Config) *OpenAlexService {
	return &OpenAlexService{
		cfg:    cfg,
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (s *OpenAlexService) Name() string { return "OpenAlex" }

type openAlexWork struct {
	ID               string                `json:"id"`
	Title            string                `json:"title"`
	DOI              string                `json:"doi"`
	PublicationYear  int                   `json:"publication_year"`
	PrimaryLocation  *openAlexLocation     `json:"primary_location"`
	Authorships      []openAlexAuthorship  `json:"authorships"`
	OpenAccess       *openAlexOA           `json:"open_access"`
	AbstractInverted map[string][]int      `json:"abstract_inverted_index"`
	ReferencedWorks  []string              `json:"referenced_works"`
}
type openAlexLocation struct {
	Source *openAlexSource `json:"source"`
}
type openAlexSource struct {
	DisplayName string `json:"display_name"`
}
type openAlexAuthorship struct {
	Author *openAlexAuthor `json:"author"`
}
type openAlexAuthor struct {
	DisplayName string `json:"display_name"`
}
type openAlexOA struct {
	IsOA  bool   `json:"is_oa"`
	OAURL string `json:"oa_url"`
}
type openAlexResponse struct {
	Results []openAlexWork `json:"results"`
	Meta    *openAlexMeta  `json:"meta"`
}
type openAlexMeta struct {
	Count int `json:"count"`
}

func (s *OpenAlexService) Search(ctx context.Context, p SearchParams) []types.Paper {
	baseURL := "https://api.openalex.org/works"
	query := url.Values{}
	query.Set("search", p.Query)
	yearFilter := ""
	if p.StartYear > 0 && p.EndYear > 0 {
		yearFilter = fmt.Sprintf("publication_year:%d-%d", p.StartYear, p.EndYear)
	} else if p.StartYear > 0 {
		yearFilter = fmt.Sprintf("publication_year:>%d", p.StartYear-1)
	} else if p.EndYear > 0 {
		yearFilter = fmt.Sprintf("publication_year:<%d", p.EndYear+1)
	}
	if yearFilter != "" {
		yearFilter += ","
	}
	query.Set("filter", yearFilter+"has_doi:true")
	query.Set("per_page", strconv.Itoa(p.Count))
	query.Set("mailto", s.cfg.ContactEmail)
	reqURL := baseURL + "?" + query.Encode()

	resp, err := s.doRequest(ctx, reqURL)
	if err != nil {
		return nil
	}
	if len(resp.Results) == 0 {
		return nil
	}

	papers := make([]types.Paper, 0, len(resp.Results))
	for _, w := range resp.Results {
		papers = append(papers, *mapWorkToPaper(w))
	}
	return papers
}

func (s *OpenAlexService) LookupByDOI(ctx context.Context, doi string) *types.Paper {
	baseURL := "https://api.openalex.org/works/doi:" + url.PathEscape(doi)
	query := url.Values{}
	query.Set("mailto", s.cfg.ContactEmail)
	reqURL := baseURL + "?" + query.Encode()

	var work openAlexWork
	_, err := util.WithRetry(ctx, func(ctx context.Context) (openAlexWork, error) {
		req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
		if err != nil {
			return work, err
		}
		httpResp, err := s.client.Do(req)
		if err != nil {
			return work, err
		}
		defer httpResp.Body.Close()
		if httpResp.StatusCode == 404 {
			return work, nil
		}
		if httpResp.StatusCode >= 500 || httpResp.StatusCode == 429 {
			return work, fmt.Errorf("OpenAlex returned %d", httpResp.StatusCode)
		}
		if httpResp.StatusCode != 200 {
			return work, nil
		}
		body, _ := io.ReadAll(httpResp.Body)
		err = json.Unmarshal(body, &work)
		return work, err
	}, 2, time.Second)
	if err != nil || work.ID == "" {
		return &types.Paper{Title: "Title Not Found", DOI: doi, Authors: "Unknown Authors", Journal: "Unknown Journal", Year: "Unknown Year"}
	}
	return mapWorkToPaper(work)
}

func mapWorkToPaper(w openAlexWork) *types.Paper {
	authors := make([]string, 0, 3)
	for i, a := range w.Authorships {
		if i >= 3 {
			break
		}
		if a.Author != nil {
			authors = append(authors, a.Author.DisplayName)
		}
	}
	authorStr := strings.Join(authors, ", ")
	if authorStr == "" {
		authorStr = "Unknown Authors"
	}
	journal := "Unknown Journal"
	if w.PrimaryLocation != nil && w.PrimaryLocation.Source != nil {
		journal = w.PrimaryLocation.Source.DisplayName
	}
	year := "Unknown Year"
	if w.PublicationYear > 0 {
		year = strconv.Itoa(w.PublicationYear)
	}
	doi := strings.TrimPrefix(w.DOI, "https://doi.org/")
	oaURL := ""
	if w.OpenAccess != nil && w.OpenAccess.IsOA {
		oaURL = w.OpenAccess.OAURL
	}
	abstract := reconstructAbstract(w.AbstractInverted)
	return &types.Paper{
		Title:         w.Title,
		Authors:       authorStr,
		Journal:       journal,
		Year:          year,
		DOI:           doi,
		OpenAccessURL: oaURL,
		Abstract:      abstract,
	}
}

func reconstructAbstract(inv map[string][]int) string {
	if len(inv) == 0 {
		return ""
	}
	type wordPos struct {
		word string
		pos  int
	}
	var words []wordPos
	for word, positions := range inv {
		for _, p := range positions {
			words = append(words, wordPos{word: word, pos: p})
		}
	}
	sort.Slice(words, func(i, j int) bool { return words[i].pos < words[j].pos })
	var b strings.Builder
	for i, wp := range words {
		if i > 0 {
			b.WriteString(" ")
		}
		b.WriteString(wp.word)
	}
	return b.String()
}

func (s *OpenAlexService) GetCitedBy(ctx context.Context, doi string, count int) []types.Paper {
	baseURL := "https://api.openalex.org/works"
	query := url.Values{}
	query.Set("filter", "cites:https://doi.org/"+doi)
	query.Set("per_page", strconv.Itoa(count))
	query.Set("sort", "cited_by_count:desc")
	query.Set("mailto", s.cfg.ContactEmail)
	reqURL := baseURL + "?" + query.Encode()

	resp, err := s.doRequest(ctx, reqURL)
	if err != nil {
		return nil
	}
	papers := make([]types.Paper, 0, len(resp.Results))
	for _, w := range resp.Results {
		papers = append(papers, *mapWorkToPaper(w))
	}
	return papers
}

func (s *OpenAlexService) GetReferences(ctx context.Context, doi string, count int) []types.Paper {
	// First fetch the work to get referenced_works
	workURL := fmt.Sprintf("https://api.openalex.org/works/doi:%s?mailto=%s", url.PathEscape(doi), s.cfg.ContactEmail)
	var work openAlexWork
	_, err := util.WithRetry(ctx, func(ctx context.Context) (openAlexWork, error) {
		req, err := http.NewRequestWithContext(ctx, "GET", workURL, nil)
		if err != nil {
			return work, err
		}
		httpResp, err := s.client.Do(req)
		if err != nil {
			return work, err
		}
		defer httpResp.Body.Close()
		if httpResp.StatusCode == 404 {
			return work, nil
		}
		if httpResp.StatusCode >= 500 || httpResp.StatusCode == 429 {
			return work, fmt.Errorf("OpenAlex returned %d", httpResp.StatusCode)
		}
		body, _ := io.ReadAll(httpResp.Body)
		err = json.Unmarshal(body, &work)
		return work, err
	}, 2, time.Second)
	if err != nil || work.ID == "" {
		return nil
	}
	ids := work.ReferencedWorks
	if len(ids) == 0 {
		return nil
	}
	if len(ids) > count {
		ids = ids[:count]
	}
	trimmed := make([]string, len(ids))
	for i, id := range ids {
		trimmed[i] = strings.TrimPrefix(id, "https://openalex.org/")
	}
	filter := "openalex:" + strings.Join(trimmed, "|")
	reqURL := fmt.Sprintf("https://api.openalex.org/works?filter=%s&per_page=%d&mailto=%s", url.QueryEscape(filter), len(trimmed), s.cfg.ContactEmail)
	resp, err := s.doRequest(ctx, reqURL)
	if err != nil {
		return nil
	}
	papers := make([]types.Paper, 0, len(resp.Results))
	for _, w := range resp.Results {
		papers = append(papers, *mapWorkToPaper(w))
	}
	return papers
}

func (s *OpenAlexService) ProcessDOIList(ctx context.Context, dois []string, onProgress func(current, total int)) []types.Paper {
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
		time.Sleep(100 * time.Millisecond)
	}
	return papers
}

func (s *OpenAlexService) doRequest(ctx context.Context, reqURL string) (*openAlexResponse, error) {
	var resp openAlexResponse
	_, err := util.WithRetry(ctx, func(ctx context.Context) (openAlexResponse, error) {
		req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
		if err != nil {
			return resp, err
		}
		httpResp, err := s.client.Do(req)
		if err != nil {
			return resp, err
		}
		defer httpResp.Body.Close()
		if httpResp.StatusCode >= 500 || httpResp.StatusCode == 429 {
			return resp, fmt.Errorf("OpenAlex returned %d", httpResp.StatusCode)
		}
		if httpResp.StatusCode != 200 {
			return resp, nil
		}
		body, err := io.ReadAll(httpResp.Body)
		if err != nil {
			return resp, err
		}
		err = json.Unmarshal(body, &resp)
		return resp, err
	}, 2, time.Second)
	if err != nil {
		return nil, err
	}
	return &resp, nil
}
