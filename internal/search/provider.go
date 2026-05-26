package search

import (
	"context"

	"github.com/doedja/jfinder/internal/config"
	"github.com/doedja/jfinder/internal/types"
)

type SearchParams struct {
	Query              string
	StartYear, EndYear int
	Count              int
}

type Provider interface {
	Search(ctx context.Context, p SearchParams) []types.Paper
	LookupByDOI(ctx context.Context, doi string) *types.Paper
	ProcessDOIList(ctx context.Context, dois []string, onProgress func(current, total int)) []types.Paper
	Name() string
}

func ChooseProvider(cfg *config.Config) Provider {
	if cfg.HasScopus() {
		return NewScopus(cfg)
	}
	return NewOpenAlex(cfg)
}
