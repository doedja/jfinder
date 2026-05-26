package gap

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/doedja/jfinder/internal/types"
)

var stopWords = map[string]bool{
	"the": true, "a": true, "an": true, "and": true, "or": true, "but": true, "in": true, "on": true,
	"at": true, "to": true, "for": true, "of": true, "with": true, "by": true, "from": true, "as": true,
	"is": true, "was": true, "are": true, "were": true, "been": true, "be": true, "have": true, "has": true,
	"had": true, "do": true, "does": true, "did": true, "will": true, "would": true, "could": true,
	"should": true, "may": true, "might": true, "must": true, "shall": true, "can": true, "need": true,
	"dare": true, "ought": true, "used": true, "using": true, "based": true, "study": true, "analysis": true,
	"review": true, "approach": true, "method": true, "new": true, "novel": true, "towards": true, "toward": true,
}

func extractKeywords(text string) []string {
	words := strings.Fields(strings.ToLower(text))
	var keywords []string
	for _, w := range words {
		w = strings.Trim(w, ".,!?;:\"'()[]{}")
		if len(w) <= 3 {
			continue
		}
		if stopWords[w] {
			continue
		}
		keep := true
		for _, r := range w {
			if !((r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')) {
				keep = false
				break
			}
		}
		if keep {
			keywords = append(keywords, w)
		}
	}
	return keywords
}

func FindUnderResearchedAreas(papers []types.Paper, topic string) []types.ResearchGap {
	var gaps []types.ResearchGap

	years := make([]int, 0, len(papers))
	yearSet := make(map[int]int)
	for _, p := range papers {
		y, err := time.Parse("2006", p.Year)
		if err == nil {
			yr := y.Year()
			years = append(years, yr)
			yearSet[yr]++
		}
	}
	if len(years) > 1 {
		sort.Ints(years)
		minYear, maxYear := years[0], years[len(years)-1]
		for yr := minYear + 1; yr < maxYear; yr++ {
			if _, ok := yearSet[yr]; !ok {
				gaps = append(gaps, types.ResearchGap{
					ID:          uuid.NewString(),
					Type:        "temporal-gap",
					Severity:    "medium",
					Title:       fmt.Sprintf("No publications found for year %d", yr),
					Description: fmt.Sprintf("No papers published in %d within the current dataset", yr),
					Evidence: types.GapEvidence{
						PaperCount:   0,
						YearRange:    fmt.Sprintf("%d-%d", yr, yr),
						Keywords:     []string{},
						Observations: []string{fmt.Sprintf("Gap in year %d", yr)},
					},
				})
			}
		}
		if maxYear-minYear >= 5 {
			recentEnd := maxYear
			recentStart := maxYear - 2
			priorEnd := recentStart - 1
			priorStart := priorEnd - 2
			recentCount := 0
			priorCount := 0
			for yr := recentStart; yr <= recentEnd; yr++ {
				recentCount += yearSet[yr]
			}
			for yr := priorStart; yr <= priorEnd; yr++ {
				priorCount += yearSet[yr]
			}
			if priorCount > 0 && float64(recentCount) < 0.5*float64(priorCount) {
				gaps = append(gaps, types.ResearchGap{
					ID:          uuid.NewString(),
					Type:        "temporal-gap",
					Severity:    "high",
					Title:       "Recent decline in publications",
					Description: "Significant decline in number of publications in the last 3 years compared to the prior 3 years",
					Evidence: types.GapEvidence{
						PaperCount:   recentCount,
						YearRange:    fmt.Sprintf("%d-%d", recentStart, recentEnd),
						Keywords:     []string{},
						Observations: []string{fmt.Sprintf("Average count prior: %d, recent: %d", priorCount/3, recentCount/3)},
					},
				})
			}
		}
	}

	keywordCount := make(map[string]int)
	for _, p := range papers {
		kws := extractKeywords(p.Title)
		for _, kw := range kws {
			keywordCount[kw]++
		}
	}
	uniqueKeywords := make([]string, 0)
	for kw, count := range keywordCount {
		if count == 1 {
			uniqueKeywords = append(uniqueKeywords, kw)
		}
	}
	if len(uniqueKeywords) > 3 {
		gaps = append(gaps, types.ResearchGap{
			ID:          uuid.NewString(),
			Type:        "under-researched-topic",
			Severity:    "medium",
			Title:       "Unique sub-topics with limited coverage",
			Description: fmt.Sprintf("Several keywords appear only once: %s", strings.Join(uniqueKeywords, ", ")),
			Evidence: types.GapEvidence{
				PaperCount:   len(papers),
				Keywords:     uniqueKeywords,
				Observations: []string{fmt.Sprintf("Found %d unique keywords", len(uniqueKeywords))},
			},
		})
	}

	return gaps
}

func AnalyzeTrends(papers []types.Paper) types.TrendAnalysis {
	yearlyDist := make(map[string]int)
	for _, p := range papers {
		yearlyDist[p.Year]++
	}
	maxCount := 0
	for _, c := range yearlyDist {
		if c > maxCount {
			maxCount = c
		}
	}
	peakYears := make([]string, 0)
	for y, c := range yearlyDist {
		if c >= int(0.8*float64(maxCount)) {
			peakYears = append(peakYears, y)
		}
	}
	sort.Strings(peakYears)

	yearsSorted := make([]int, 0, len(yearlyDist))
	for y := range yearlyDist {
		yr, _ := time.Parse("2006", y)
		if yr.Year() > 0 {
			yearsSorted = append(yearsSorted, yr.Year())
		}
	}
	sort.Ints(yearsSorted)
	var declining []string
	for i := 1; i < len(yearsSorted); i++ {
		prev := yearsSorted[i-1]
		curr := yearsSorted[i]
		if yearlyDist[fmt.Sprintf("%d", curr)] < int(0.7*float64(yearlyDist[fmt.Sprintf("%d", prev)])) {
			declining = append(declining, fmt.Sprintf("%d to %d", prev, curr))
		}
	}

	now := time.Now()
	currentYear := now.Year()
	var recentPapers []types.Paper
	for _, p := range papers {
		yr, _ := time.Parse("2006", p.Year)
		if yr.Year() >= currentYear-1 {
			recentPapers = append(recentPapers, p)
		}
	}
	kwCount := make(map[string]int)
	for _, p := range recentPapers {
		for _, kw := range extractKeywords(p.Title) {
			kwCount[kw]++
		}
	}
	type kv struct {
		k string
		v int
	}
	var sorted []kv
	for k, v := range kwCount {
		sorted = append(sorted, kv{k, v})
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].v > sorted[j].v })
	var emerging []string
	for i := 0; i < 10 && i < len(sorted); i++ {
		emerging = append(emerging, sorted[i].k)
	}

	return types.TrendAnalysis{
		YearlyDistribution: yearlyDist,
		PeakYears:          peakYears,
		DecliningTrends:    declining,
		EmergingTopics:     emerging,
	}
}

func ClusterPapers(papers []types.Paper) []types.PaperCluster {
	keywordToPapers := make(map[string][]string)
	keywordToAvgYear := make(map[string]float64)
	for _, p := range papers {
		kws := extractKeywords(p.Title)
		yr, _ := time.Parse("2006", p.Year)
		year := yr.Year()
		for _, kw := range kws {
			keywordToPapers[kw] = append(keywordToPapers[kw], p.DOI)
			keywordToAvgYear[kw] += float64(year)
		}
	}
	var clusters []types.PaperCluster
	for kw, dois := range keywordToPapers {
		if len(dois) >= 2 {
			totalYear := keywordToAvgYear[kw]
			avgYear := totalYear / float64(len(dois))
			clusters = append(clusters, types.PaperCluster{
				ID:          uuid.NewString(),
				Name:        kw,
				Keywords:    []string{kw},
				Papers:      dois,
				AverageYear: int(math.Round(avgYear)),
				Size:        len(dois),
			})
		}
	}
	sort.Slice(clusters, func(i, j int) bool { return clusters[i].Size > clusters[j].Size })
	if len(clusters) > 10 {
		clusters = clusters[:10]
	}
	return clusters
}

func ProcessLLMGapAnalysis(llm types.LLMGapAnalysis, papers []types.Paper) []types.ResearchGap {
	var gaps []types.ResearchGap
	for _, lg := range llm.Gaps {
		years := make([]string, 0, len(papers))
		for _, p := range papers {
			if p.Year != "" {
				years = append(years, p.Year)
			}
		}
		sort.Strings(years)
		yearRange := ""
		if len(years) > 0 {
			yearRange = years[0] + " - " + years[len(years)-1]
		}
		kwCount := make(map[string]int)
		for _, p := range papers {
			for _, kw := range extractKeywords(p.Title) {
				kwCount[kw]++
			}
		}
		type kv struct {
			k string
			v int
		}
		var sorted []kv
		for k, v := range kwCount {
			sorted = append(sorted, kv{k, v})
		}
		sort.Slice(sorted, func(i, j int) bool { return sorted[i].v > sorted[j].v })
		top5 := make([]string, 0, 5)
		for i := 0; i < 5 && i < len(sorted); i++ {
			top5 = append(top5, sorted[i].k)
		}
		observations := llm.Observations
		if len(observations) > 3 {
			observations = observations[:3]
		}
		related := make([]string, 0, 5)
		for i, p := range papers {
			if i >= 5 {
				break
			}
			if p.DOI != "" {
				related = append(related, p.DOI)
			}
		}
		gaps = append(gaps, types.ResearchGap{
			ID:                uuid.NewString(),
			Type:              lg.Type,
			Severity:          lg.Severity,
			Title:             lg.Title,
			Description:       lg.Description,
			Evidence: types.GapEvidence{
				PaperCount:   len(papers),
				YearRange:    yearRange,
				Keywords:     top5,
				Observations: observations,
			},
			RelatedPapers:     related,
			SuggestedApproach: lg.SuggestedApproach,
		})
	}
	return gaps
}
