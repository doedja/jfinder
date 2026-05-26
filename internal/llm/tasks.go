package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/doedja/jfinder/internal/types"
	"github.com/doedja/jfinder/internal/util"
)

type GapTitle struct {
	Title       string
	Description string
}

var jsonBlockRegex = regexp.MustCompile(`\{[\s\S]*\}`)

func extractJSON(raw string) string {
	return jsonBlockRegex.FindString(raw)
}

// cleanQuery validates and tidies a single TITLE-ABS-KEY query line.
// Returns empty string if not a valid Scopus query.
func cleanQuery(q string) string {
	q = strings.TrimSpace(q)
	if q == "" {
		return ""
	}
	if !strings.Contains(q, "TITLE-ABS-KEY") {
		return ""
	}
	// If it contains commas but no OR/AND, rewrite the inner parts.
	if strings.Contains(q, ",") && !strings.Contains(q, " OR ") && !strings.Contains(q, " AND ") {
		re := regexp.MustCompile(`TITLE-ABS-KEY\((.+)\)`)
		m := re.FindStringSubmatch(q)
		if len(m) < 2 {
			return ""
		}
		inner := m[1]
		parts := strings.Split(inner, ",")
		var quoted []string
		for _, p := range parts {
			p = strings.TrimSpace(p)
			p = strings.Trim(p, `"`)
			quoted = append(quoted, `"`+p+`"`)
		}
		return "TITLE-ABS-KEY(" + strings.Join(quoted, " OR ") + ")"
	}
	return q
}

// padQueries grows the list to numCycles by broadening the last query or appending a simple topic query.
func padQueries(qs []string, numCycles int, topic string) []string {
	if len(qs) == 0 {
		// start with a basic query
		qs = append(qs, `TITLE-ABS-KEY("`+topic+`")`)
	}
	for len(qs) < numCycles {
		last := qs[len(qs)-1]
		idx := strings.LastIndex(last, " AND ")
		if idx != -1 {
			broader := strings.TrimSpace(last[:idx])
			qs = append(qs, broader)
		} else {
			qs = append(qs, `TITLE-ABS-KEY("`+topic+`")`)
		}
	}
	if len(qs) > numCycles {
		qs = qs[:numCycles]
	}
	return qs
}

func formatPaper(p types.Paper, maxAbstractLen int) string {
	var b strings.Builder
	b.WriteString(`"` + p.Title + `"`)
	b.WriteString(" (" + p.Year + ")")
	if p.Journal != "" {
		b.WriteString(" - " + p.Journal)
	}
	if p.Abstract != "" {
		ab := p.Abstract
		if len(ab) > maxAbstractLen {
			ab = ab[:maxAbstractLen] + "..."
		}
		b.WriteString("\n   Abstract: " + ab)
	}
	b.WriteString("\n")
	return b.String()
}

// GenerateSearchQueries returns numCycles Scopus queries. If previousResults is non-empty,
// uses the broaden header; otherwise uses initial header.
// On repeated failure returns padded fallback queries.
func (c *Client) GenerateSearchQueries(ctx context.Context, topic string, numCycles int, previousResults []types.Paper) []string {
	var tail string
	if len(previousResults) > 0 {
		tail = "Topic: " + topic + "\n\nNumber of queries to generate: " + fmt.Sprintf("%d", numCycles) + "\n\nPrior papers (top 3):\n"
		limit := 3
		if len(previousResults) < limit {
			limit = len(previousResults)
		}
		for i := 0; i < limit; i++ {
			p := previousResults[i]
			line := fmt.Sprintf("%d. \"%s\" (%s) - %s\n", i+1, p.Title, p.Year, p.Journal)
			tail += line
		}
		header := hdrQueryGenBroaden
		tail = header + tail
	} else {
		tail = hdrQueryGenInitial + "Topic: " + topic + "\n\nGenerate " + fmt.Sprintf("%d", numCycles) + " queries."
	}

	var raw string
	var err error
	const maxRetries = 2
	for i := 0; i < maxRetries; i++ {
		raw, err = c.Chat(ctx, []Message{
			{Role: "system", Content: sysQueryGen},
			{Role: "user", Content: tail},
		}, 0.3, 60*time.Second)
		if err == nil {
			break
		}
		if i < maxRetries-1 {
			time.Sleep(1 * time.Second * time.Duration(i+1))
		}
	}
	if err != nil || raw == "" {
		// fallback: start with basic query and pad
		return padQueries(nil, numCycles, topic)
	}

	lines := strings.Split(raw, "\n")
	var queries []string
	for _, line := range lines {
		if q := cleanQuery(line); q != "" {
			queries = append(queries, q)
		}
	}
	if len(queries) == 0 {
		return padQueries(nil, numCycles, topic)
	}
	return padQueries(queries, numCycles, topic)
}

// AnalyzeGaps runs LLM-driven gap analysis. Returns nil on failure or empty papers.
func (c *Client) AnalyzeGaps(ctx context.Context, papers []types.Paper, topic string) *types.LLMGapAnalysis {
	if len(papers) == 0 {
		return nil
	}

	var tail = hdrGapAnalysis + "Topic: " + topic + "\n\nNumber of papers: " + fmt.Sprintf("%d", len(papers)) + "\n\nPapers:\n"
	limit := 15
	if len(papers) < limit {
		limit = len(papers)
	}
	for i := 0; i < limit; i++ {
		tail += fmt.Sprintf("%d. ", i+1) + formatPaper(papers[i], 300) + "\n"
	}

	result, err := util.WithRetryPointer(ctx, func(ctx context.Context) (*types.LLMGapAnalysis, error) {
		raw, err := c.Chat(ctx, []Message{
			{Role: "system", Content: sysGapAnalysis},
			{Role: "user", Content: tail},
		}, 0.4, 90*time.Second)
		if err != nil {
			return nil, err
		}
		jsonStr := extractJSON(raw)
		if jsonStr == "" {
			return &types.LLMGapAnalysis{}, nil
		}
		var analysis types.LLMGapAnalysis
		if err := json.Unmarshal([]byte(jsonStr), &analysis); err != nil {
			c.logger.Warn("Gap analysis JSON parse error", "error", err)
			return &types.LLMGapAnalysis{}, nil
		}
		return &analysis, nil
	}, 2, 2*time.Second)
	if err != nil {
		return nil
	}
	return result
}

// CompareMethodologies runs LLM methodology comparison. Needs at least 2 papers.
func (c *Client) CompareMethodologies(ctx context.Context, papers []types.Paper, topic string) *types.LLMComparisonAnalysis {
	if len(papers) < 2 {
		return nil
	}

	var tail = hdrComparison + "Topic: " + topic + "\n\nNumber of papers: " + fmt.Sprintf("%d", len(papers)) + "\n\nPapers:\n"
	limit := 12
	if len(papers) < limit {
		limit = len(papers)
	}
	for i := 0; i < limit; i++ {
		tail += fmt.Sprintf("%d. ", i+1) + formatPaper(papers[i], 250) + "\n"
	}

	result, err := util.WithRetryPointer(ctx, func(ctx context.Context) (*types.LLMComparisonAnalysis, error) {
		raw, err := c.Chat(ctx, []Message{
			{Role: "system", Content: sysComparison},
			{Role: "user", Content: tail},
		}, 0.3, 90*time.Second)
		if err != nil {
			return nil, err
		}
		jsonStr := extractJSON(raw)
		if jsonStr == "" {
			return &types.LLMComparisonAnalysis{}, nil
		}
		var comp types.LLMComparisonAnalysis
		if err := json.Unmarshal([]byte(jsonStr), &comp); err != nil {
			c.logger.Warn("Comparison JSON parse error", "error", err)
			return &types.LLMComparisonAnalysis{}, nil
		}
		return &comp, nil
	}, 2, 2*time.Second)
	if err != nil {
		return nil
	}
	return result
}

// SuggestDirections asks LLM for direction suggestions.
func (c *Client) SuggestDirections(ctx context.Context, papers []types.Paper, gaps []GapTitle, topic string) []types.LLMDirectionSuggestion {
	var tail = hdrDirections + "Topic: " + topic + "\n\nPapers:\n"
	limitPapers := 10
	if len(papers) < limitPapers {
		limitPapers = len(papers)
	}
	for i := 0; i < limitPapers; i++ {
		tail += fmt.Sprintf("%d. ", i+1) + formatPaper(papers[i], 200) + "\n"
	}
	tail += "Identified Gaps:\n"
	limitGaps := 5
	if len(gaps) < limitGaps {
		limitGaps = len(gaps)
	}
	for i := 0; i < limitGaps; i++ {
		tail += fmt.Sprintf("%d. %s: %s\n", i+1, gaps[i].Title, gaps[i].Description)
	}

	type directionsResponse struct {
		Directions []types.LLMDirectionSuggestion `json:"directions"`
	}

	result, err := util.WithRetryPointer(ctx, func(ctx context.Context) (*directionsResponse, error) {
		raw, err := c.Chat(ctx, []Message{
			{Role: "system", Content: sysDirections},
			{Role: "user", Content: tail},
		}, 0.6, 90*time.Second)
		if err != nil {
			return nil, err
		}
		jsonStr := extractJSON(raw)
		if jsonStr == "" {
			return &directionsResponse{}, nil
		}
		var resp directionsResponse
		if err := json.Unmarshal([]byte(jsonStr), &resp); err != nil {
			c.logger.Warn("Directions JSON parse error", "error", err)
			return &directionsResponse{}, nil
		}
		return &resp, nil
	}, 2, 2*time.Second)
	if err != nil || result == nil {
		return nil
	}
	return result.Directions
}

// GenerateGapSummary returns a markdown-free summary string, or "" on failure.
func (c *Client) GenerateGapSummary(ctx context.Context, topic string, paperCount, gapCount int, topGaps, topDirections []string) string {
	var tail = hdrSummary + "Topic: " + topic + "\nPapers Analyzed: " + fmt.Sprintf("%d", paperCount) +
		"\nGaps Identified: " + fmt.Sprintf("%d", gapCount) +
		"\n\nKey Gaps Found:\n"
	for i, g := range topGaps {
		tail += fmt.Sprintf("%d. %s\n", i+1, g)
	}
	tail += "\nRecommended Research Directions:\n"
	for i, d := range topDirections {
		tail += fmt.Sprintf("%d. %s\n", i+1, d)
	}

	var raw string
	var err error
	const maxRetries = 2
	for i := 0; i < maxRetries; i++ {
		raw, err = c.Chat(ctx, []Message{
			{Role: "system", Content: sysSummary},
			{Role: "user", Content: tail},
		}, 0.5, 60*time.Second)
		if err == nil {
			break
		}
		if i < maxRetries-1 {
			time.Sleep(1 * time.Second * time.Duration(i+1))
		}
	}
	if err != nil {
		return ""
	}
	return strings.TrimSpace(raw)
}
