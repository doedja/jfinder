package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/doedja/jfinder/internal/config"
	"github.com/doedja/jfinder/internal/gap"
	"github.com/doedja/jfinder/internal/llm"
	"github.com/doedja/jfinder/internal/search"
	"github.com/doedja/jfinder/internal/types"
	"github.com/doedja/jfinder/internal/util"
)

// GapProcessor handles gap analysis tasks.
type GapProcessor struct {
	cfg      *config.Config
	manager  *GapManager
	provider search.Provider
	llm      *llm.Client
	logger   *util.Logger
}

// NewGapProcessor creates a new GapProcessor.
func NewGapProcessor(cfg *config.Config, mgr *GapManager, provider search.Provider, llmc *llm.Client) *GapProcessor {
	return &GapProcessor{
		cfg:      cfg,
		manager:  mgr,
		provider: provider,
		llm:      llmc,
		logger:   util.Default.Child("gap-processor"),
	}
}

// Process executes the full gap analysis pipeline.
func (p *GapProcessor) Process(ctx context.Context, taskID string, request types.GapAnalysisRequest) {
	taskDir, err := util.GetTaskDir(p.cfg.DownloadDir, taskID)
	if err != nil {
		p.manager.Fail(taskID, "failed to get task directory")
		return
	}
	if err := util.EnsureDir(taskDir); err != nil {
		p.manager.Fail(taskID, "failed to create task directory")
		return
	}

	var searchQueries []string
	var allPapers []types.Paper
	seenDois := make(map[string]bool)

	// Phase 1: Search (0-30%)
	p.manager.UpdateGapProgress(taskID, types.GapSearching, "Generating search queries...", 0, 0, 0, 0)

	queries := p.llm.GenerateSearchQueries(ctx, request.Topic, 3, nil)
	searchQueries = append(searchQueries, queries...)

	yearStart, yearEnd := 0, 0
	if request.YearFilter != "" {
		parts := strings.Split(request.YearFilter, "-")
		if len(parts) == 2 {
			yearStart, _ = strconv.Atoi(parts[0])
			yearEnd, _ = strconv.Atoi(parts[1])
		}
	}

	for i, q := range queries {
		select {
		case <-ctx.Done():
			p.manager.Fail(taskID, "context cancelled")
			return
		default:
		}

		if len(allPapers) >= request.Papers {
			break
		}

		progress := int(5 + float64(i)/float64(len(queries))*25)
		if progress < 5 {
			progress = 5
		} else if progress > 30 {
			progress = 30
		}
		p.manager.UpdateGapProgress(taskID, types.GapSearching,
			fmt.Sprintf("Searching %s (%d/%d)...", p.provider.Name(), i+1, len(queries)),
			progress, len(allPapers), 0, 0)

		results := p.provider.Search(ctx, search.SearchParams{
			Query:     q,
			StartYear: yearStart,
			EndYear:   yearEnd,
			Count:     request.Papers,
		})
		for _, paper := range results {
			if paper.DOI == "" {
				continue
			}
			doiClean, ok := util.CleanDOI(paper.DOI)
			if !ok {
				continue
			}
			if seenDois[doiClean] {
				continue
			}
			seenDois[doiClean] = true
			allPapers = append(allPapers, paper)
		}

		time.Sleep(500 * time.Millisecond)
	}

	if len(allPapers) == 0 {
		p.manager.Fail(taskID, "No papers found for this topic")
		return
	}

	// Phase 2: Collecting (30-50%)
	p.manager.UpdateGapProgress(taskID, types.GapCollecting, "Preparing papers for analysis...", 30, len(allPapers), 0, 0)

	// Determine enabled analysis phases
	needsGap := false
	needsComparison := false
	needsDirections := false
	for _, at := range request.AnalysisTypes {
		if at == types.AnalysisGaps || at == types.AnalysisAll {
			needsGap = true
		}
		if at == types.AnalysisComparisons || at == types.AnalysisAll {
			needsComparison = true
		}
		if at == types.AnalysisDirections || at == types.AnalysisAll {
			needsDirections = true
		}
	}

	// Phase 3: Gap analysis (50-70%)
	var gaps []types.ResearchGap
	if needsGap {
		p.manager.UpdateGapProgress(taskID, types.GapAnalyzing, "Analyzing research gaps...", 50, len(allPapers), 0, 0)
		algorithmicGaps := gap.FindUnderResearchedAreas(allPapers, request.Topic)
		gaps = append(gaps, algorithmicGaps...)

		p.manager.UpdateGapProgress(taskID, types.GapAnalyzing, "Running AI gap analysis...", 60, len(allPapers), len(gaps), 0)
		llmGaps := p.llm.AnalyzeGaps(ctx, allPapers, request.Topic)
		if llmGaps != nil {
			llmProcessed := gap.ProcessLLMGapAnalysis(*llmGaps, allPapers)
			gaps = append(gaps, llmProcessed...)
		}

		// Dedup gaps by title[:30] lowercased
		seenGaps := make(map[string]bool)
		dedupedGaps := make([]types.ResearchGap, 0, len(gaps))
		for _, g := range gaps {
			key := strings.ToLower(g.Title)
			if len(key) > 30 {
				key = key[:30]
			}
			if seenGaps[key] {
				continue
			}
			seenGaps[key] = true
			dedupedGaps = append(dedupedGaps, g)
		}
		gaps = dedupedGaps
	}

	// Phase 4: Comparisons (70-85%)
	var comparisons []types.PaperComparison
	if needsComparison {
		methodComp := gap.CompareMethodologies(allPapers)
		appComp := gap.FindDifferentApproaches(allPapers)
		comparisons = append(comparisons, methodComp...)
		comparisons = append(comparisons, appComp...)

		contradictions := gap.FindContradictions(allPapers)
		if len(contradictions) > 0 && len(comparisons) > 0 {
			comparisons[0].Contradictions = contradictions
		}

		p.manager.UpdateGapProgress(taskID, types.GapComparing, "Running AI methodology comparison...", 78, len(allPapers), len(gaps), len(comparisons))

		llmComp := p.llm.CompareMethodologies(ctx, allPapers, request.Topic)
		if llmComp != nil {
			comparisons = append(comparisons, gap.ProcessLLMComparison(*llmComp, allPapers))
		}
		p.manager.UpdateComparisons(taskID, len(comparisons))
	}

	// Phase 5: Directions (85-95%)
	var directions []types.ResearchDirection
	if needsDirections {
		p.manager.UpdateGapProgress(taskID, types.GapGenerating, "Generating research directions...", 85, len(allPapers), len(gaps), 0)

		if len(gaps) > 0 {
			directions = append(directions, gap.GenerateDirections(gaps, allPapers)...)
		}
		directions = append(directions, gap.SuggestNovelAngles(request.Topic, allPapers)...)

		p.manager.UpdateGapProgress(taskID, types.GapGenerating, "Running AI direction suggestions...", 90, len(allPapers), len(gaps), len(directions))

		gapTitles := make([]llm.GapTitle, len(gaps))
		for i, g := range gaps {
			gapTitles[i] = llm.GapTitle{Title: g.Title, Description: g.Description}
		}
		llmDirs := p.llm.SuggestDirections(ctx, allPapers, gapTitles, request.Topic)
		if len(llmDirs) > 0 {
			directions = append(directions, gap.ProcessLLMDirections(llmDirs, gaps)...)
		}

		// Dedup directions by title[:30] lowercased
		seenDirs := make(map[string]bool)
		dedupedDirs := make([]types.ResearchDirection, 0, len(directions))
		for _, d := range directions {
			key := strings.ToLower(d.Title)
			if len(key) > 30 {
				key = key[:30]
			}
			if seenDirs[key] {
				continue
			}
			seenDirs[key] = true
			dedupedDirs = append(dedupedDirs, d)
		}
		directions = dedupedDirs
		directions = gap.RankDirections(directions)
		if len(directions) > 10 {
			directions = directions[:10]
		}
	}

	// Phase 6: Finalize (95-100%)
	p.manager.UpdateGapProgress(taskID, types.GapGenerating, "Compiling results...", 95, len(allPapers), len(gaps), len(directions))

	trends := gap.AnalyzeTrends(allPapers)
	clusters := gap.ClusterPapers(allPapers)

	minYear, maxYear := 0, 0
	for _, paper := range allPapers {
		year := 0
		if paper.Year != "" {
			year, _ = strconv.Atoi(paper.Year)
		}
		if year > 0 {
			if minYear == 0 || year < minYear {
				minYear = year
			}
			if year > maxYear {
				maxYear = year
			}
		}
	}
	yearRange := ""
	if minYear > 0 && maxYear > 0 {
		yearRange = fmt.Sprintf("%d-%d", minYear, maxYear)
	}

	meta := types.AnalysisMetadata{
		AnalysisDate:   time.Now(),
		AnalysisTypes:  request.AnalysisTypes,
		PaperCount:     len(allPapers),
		YearRange:      yearRange,
		Depth:          request.Depth,
		SearchQueries: searchQueries,
	}

	result := types.GapAnalysisResult{
		TaskID:      taskID,
		Topic:       request.Topic,
		Papers:      allPapers,
		Gaps:        gaps,
		Comparisons: comparisons,
		Directions:  directions,
		Trends:      &trends,
		Clusters:    clusters,
		Metadata:    meta,
	}

	// Write JSON result
	resultPath := filepath.Join(taskDir, "gap-analysis-result.json")
	resultData, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		p.manager.Fail(taskID, "failed to marshal result JSON")
		return
	}
	if err := os.WriteFile(resultPath, resultData, 0644); err != nil {
		p.manager.Fail(taskID, "failed to write result JSON")
		return
	}

	// Build markdown report
	report := p.buildMarkdownReport(result)
	reportPath := filepath.Join(taskDir, "gap-analysis-report.md")
	if err := os.WriteFile(reportPath, []byte(report), 0644); err != nil {
		p.manager.Fail(taskID, "failed to write report")
		return
	}

	p.manager.Complete(taskID,
		fmt.Sprintf("/api/gap-results/%s", taskID),
		fmt.Sprintf("/api/gap-report/%s", taskID))
}

func (p *GapProcessor) buildMarkdownReport(result types.GapAnalysisResult) string {
	var sb strings.Builder
	sb.WriteString("# Research Gap Analysis Report\n")
	sb.WriteString(fmt.Sprintf("## Topic: %s\n\n", result.Topic))

	sb.WriteString("### Metadata\n")
	sb.WriteString(fmt.Sprintf("- Analysis Date: %s\n", result.Metadata.AnalysisDate.Format(time.RFC3339)))
	sb.WriteString(fmt.Sprintf("- Paper Count: %d\n", result.Metadata.PaperCount))
	sb.WriteString(fmt.Sprintf("- Year Range: %s\n", result.Metadata.YearRange))
	sb.WriteString(fmt.Sprintf("- Depth: %s\n", result.Metadata.Depth))
	sb.WriteString(fmt.Sprintf("- Analysis Types: %v\n\n", result.Metadata.AnalysisTypes))

	sb.WriteString("## Executive Summary\n")
	ctx := context.Background()
	summary := p.llm.GenerateGapSummary(ctx, result.Topic, len(result.Papers), len(result.Gaps),
		simpleSlice(result.Gaps, 5, func(g types.ResearchGap) string { return g.Title }),
		simpleSlice(result.Directions, 5, func(d types.ResearchDirection) string { return d.Title }),
	)
	sb.WriteString(summary)
	sb.WriteString("\n\n")

	if len(result.Gaps) > 0 {
		sb.WriteString("## Research Gaps\n")
		for i, g := range result.Gaps {
			sb.WriteString(fmt.Sprintf("### %d. %s\n", i+1, g.Title))
			sb.WriteString(fmt.Sprintf("- **Type:** %s\n", g.Type))
			sb.WriteString(fmt.Sprintf("- **Severity:** %s\n", g.Severity))
			sb.WriteString(fmt.Sprintf("- **Description:** %s\n", g.Description))
			sb.WriteString(fmt.Sprintf("- **Suggested Approach:** %s\n\n", g.SuggestedApproach))
		}
	}

	if len(result.Comparisons) > 0 {
		sb.WriteString("## Methodology Comparisons\n")
		for _, comp := range result.Comparisons {
			sb.WriteString(fmt.Sprintf("### Dimension: %s\n", comp.Dimension))
			sb.WriteString(fmt.Sprintf("- Papers involved: %d\n", len(comp.Papers)))
			for _, f := range comp.Findings {
				sb.WriteString(fmt.Sprintf("  - **Aspect:** %s\n", f.Aspect))
				if len(f.Differences) > 0 {
					sb.WriteString(fmt.Sprintf("    - Differences: %s\n", strings.Join(f.Differences, ", ")))
				}
				if len(f.Similarities) > 0 {
					sb.WriteString(fmt.Sprintf("    - Similarities: %s\n", strings.Join(f.Similarities, ", ")))
				}
			}
			if len(comp.Contradictions) > 0 {
				sb.WriteString(fmt.Sprintf("- Contradictions: %s\n", strings.Join(comp.Contradictions, "; ")))
			}
			sb.WriteString("\n")
		}
	}

	if len(result.Directions) > 0 {
		sb.WriteString("## Recommended Research Directions\n")
		for i, d := range result.Directions {
			sb.WriteString(fmt.Sprintf("### %d. %s\n", i+1, d.Title))
			sb.WriteString(fmt.Sprintf("- **Feasibility:** %s\n", d.Feasibility))
			sb.WriteString(fmt.Sprintf("- **Novelty:** %s\n", d.Novelty))
			sb.WriteString(fmt.Sprintf("- **Description:** %s\n", d.Description))
			sb.WriteString(fmt.Sprintf("- **Rationale:** %s\n", d.Rationale))
			sb.WriteString(fmt.Sprintf("- **Methodology:** %s\n\n", d.SuggestedMethodology))
		}
	}

	if result.Trends != nil {
		sb.WriteString("## Publication Trends\n")
		sb.WriteString(fmt.Sprintf("- Peak years: %s\n", strings.Join(result.Trends.PeakYears, ", ")))
		sb.WriteString(fmt.Sprintf("- Declining trends: %s\n", strings.Join(result.Trends.DecliningTrends, ", ")))
		sb.WriteString(fmt.Sprintf("- Emerging topics: %s\n\n", strings.Join(result.Trends.EmergingTopics, ", ")))
	}

	return sb.String()
}

func simpleSlice[T any](items []T, max int, get func(T) string) []string {
	if len(items) > max {
		items = items[:max]
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		result = append(result, get(item))
	}
	return result
}
