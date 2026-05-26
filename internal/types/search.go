package types

import (
	"strconv"
	"strings"
)

type DownloadType string

const (
	DownloadFull     DownloadType = "full"
	DownloadMetadata DownloadType = "metadata"
)

type YearFilter struct {
	StartYear int
	EndYear   int
}

// ParseYearFilter parses "2024" or "2020-2024" into a YearFilter.
// Returns nil for empty or invalid input.
func ParseYearFilter(s string) *YearFilter {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	if strings.Contains(s, "-") {
		parts := strings.SplitN(s, "-", 2)
		start, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
		end, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
		if err1 == nil && err2 == nil {
			return &YearFilter{StartYear: start, EndYear: end}
		}
		return nil
	}
	y, err := strconv.Atoi(s)
	if err != nil {
		return nil
	}
	return &YearFilter{StartYear: y, EndYear: y}
}
