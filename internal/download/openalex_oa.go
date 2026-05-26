package download

import (
	"context"
	"io"
	"net/http"
	"time"

	"github.com/doedja/jfinder/internal/types"
	"github.com/doedja/jfinder/internal/util"
)

type OpenAlexOAFetcher struct {
	client *http.Client
	logger *util.Logger
}

func NewOpenAlexOAFetcher() *OpenAlexOAFetcher {
	return &OpenAlexOAFetcher{
		client: &http.Client{Timeout: 30 * time.Second},
		logger: util.Default,
	}
}

func (f *OpenAlexOAFetcher) Download(ctx context.Context, paper types.Paper) []byte {
	if paper.OpenAccessURL == "" {
		return nil
	}
	req, _ := http.NewRequestWithContext(ctx, "GET", paper.OpenAccessURL, nil)
	for k, v := range browserHeaders {
		req.Header.Set(k, v)
	}
	req.Header.Set("Accept", "application/pdf,application/octet-stream,*/*")
	resp, err := f.client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if isPDF(data) {
		return data
	}
	return nil
}
