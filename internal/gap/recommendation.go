package gap

import (
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/doedja/jfinder/internal/types"
)

func GenerateDirections(gaps []types.ResearchGap, papers []types.Paper) []types.ResearchDirection {
	severityOrder := map[types.GapSeverity]int{
		"high":   3,
		"medium": 2,
		"low":    1,
	}
	sortedGaps := make([]types.ResearchGap, len(gaps))
	copy(sortedGaps, gaps)
	sort.Slice(sortedGaps, func(i, j int) bool {
		return severityOrder[sortedGaps[i].Severity] > severityOrder[sortedGaps[j].Severity]
	})

	var directions []types.ResearchDirection
	for _, g := range sortedGaps {
		dir := buildDirection(g, papers)
		directions = append(directions, dir)
	}

	var mGap, uGap, tGap, tempGap *types.ResearchGap
	for i, g := range sortedGaps {
		switch g.Type {
		case "methodological-gap":
			if mGap == nil {
				mGap = &sortedGaps[i]
			}
		case "under-researched-topic":
			if uGap == nil {
				uGap = &sortedGaps[i]
			}
		case "theoretical-gap":
			if tGap == nil {
				tGap = &sortedGaps[i]
			}
		case "temporal-gap":
			if tempGap == nil {
				tempGap = &sortedGaps[i]
			}
		}
	}
	if mGap != nil && uGap != nil {
		directions = append(directions, types.ResearchDirection{
			ID:          uuid.NewString(),
			Title:       "Novel methodology for under-researched area",
			Description: "Combine methodological innovation with an under-researched topic to produce high-impact research",
			Rationale:   "There is both a need for new methods and a lack of research in specific areas",
			SuggestedMethodology: "Mixed methods incorporating the new methodology and extensive data collection",
			Feasibility: "low",
			Novelty:     "high",
			BasedOnGaps: []string{mGap.ID, uGap.ID},
			PotentialImpact: "High potential for advancing both methodology and domain knowledge",
		})
	}
	if tempGap != nil && tGap != nil {
		directions = append(directions, types.ResearchDirection{
			ID:          uuid.NewString(),
			Title:       "Updated theoretical framework",
			Description: "Temporal gap and theoretical gap suggest updating existing frameworks with current data",
			Rationale:   "Outdated theoretical constructs may not apply to recent phenomena",
			SuggestedMethodology: "Literature review and meta-analysis of recent studies to adapt theoretical model",
			Feasibility: "medium",
			Novelty:     "high",
			BasedOnGaps: []string{tempGap.ID, tGap.ID},
			PotentialImpact: "Moderate potential for advancing the field.",
		})
	}

	if len(directions) > 10 {
		directions = directions[:10]
	}
	return directions
}

func buildDirection(g types.ResearchGap, papers []types.Paper) types.ResearchDirection {
	keywords := g.Evidence.Keywords
	if len(keywords) == 0 {
		keywords = extractKeywords(g.Title)
	}

	switch g.Type {
	case "under-researched-topic":
		return types.ResearchDirection{
			ID:          uuid.NewString(),
			Title:       "Investigate " + g.Title,
			Description: g.Description,
			Rationale:   "The topic appears underrepresented in the literature",
			SuggestedMethodology: "Mixed methods approach including systematic review and empirical study",
			Feasibility: "medium",
			Novelty:     "high",
			BasedOnGaps: []string{g.ID},
			PotentialImpact: "High potential for advancing the field",
		}
	case "methodological-gap":
		methodName := "new methodology"
		if len(keywords) >= 2 {
			methodName = strings.Join(keywords[:2], " ")
		}
		return types.ResearchDirection{
			ID:          uuid.NewString(),
			Title:       "Develop new methodology for " + methodName,
			Description: g.Description,
			Rationale:   "Existing methods are insufficient or lacking",
			SuggestedMethodology: "Design and validation of novel method",
			Feasibility: "low",
			Novelty:     "high",
			BasedOnGaps: []string{g.ID},
			PotentialImpact: "High potential for advancing the field",
		}
	case "theoretical-gap":
		keyword := "this domain"
		if len(keywords) > 0 {
			keyword = keywords[0]
		}
		return types.ResearchDirection{
			ID:          uuid.NewString(),
			Title:       "Develop theoretical framework for " + keyword,
			Description: g.Description,
			Rationale:   "Existing theory is incomplete or outdated",
			SuggestedMethodology: "Theoretical analysis and synthesis of existing literature",
			Feasibility: "medium",
			Novelty:     "high",
			BasedOnGaps: []string{g.ID},
			PotentialImpact: "High potential for advancing the field",
		}
	case "temporal-gap":
		methodName := "this topic"
		if len(keywords) >= 2 {
			methodName = strings.Join(keywords[:2], " ")
		} else if len(keywords) > 0 {
			methodName = keywords[0]
		}
		return types.ResearchDirection{
			ID:          uuid.NewString(),
			Title:       "Update research on " + methodName,
			Description: g.Description,
			Rationale:   "Recent publications are lacking or declining",
			SuggestedMethodology: "Replication and extension of past studies with contemporary data",
			Feasibility: "high",
			Novelty:     "medium",
			BasedOnGaps: []string{g.ID},
			PotentialImpact: "Moderate potential for advancing the field",
		}
	case "geographical-gap":
		keyword := "research"
		if len(keywords) > 0 {
			keyword = keywords[0]
		}
		return types.ResearchDirection{
			ID:          uuid.NewString(),
			Title:       "Expand geographical scope of " + keyword,
			Description: g.Description,
			Rationale:   "Current findings are limited to specific regions",
			SuggestedMethodology: "Cross-cultural comparative study",
			Feasibility: "medium",
			Novelty:     "medium",
			BasedOnGaps: []string{g.ID},
			PotentialImpact: "Moderate potential for advancing the field",
		}
	case "contradictory-findings":
		methodName := "this area"
		if len(keywords) >= 2 {
			methodName = strings.Join(keywords[:2], " ")
		}
		return types.ResearchDirection{
			ID:          uuid.NewString(),
			Title:       "Resolve contradictions in " + methodName,
			Description: g.Description,
			Rationale:   "Conflicting results hinders progress",
			SuggestedMethodology: "Meta-analysis and systematic review with new empirical data",
			Feasibility: "medium",
			Novelty:     "medium",
			BasedOnGaps: []string{g.ID},
			PotentialImpact: "Moderate potential for advancing the field",
		}
	default:
		return types.ResearchDirection{
			ID:          uuid.NewString(),
			Title:       "Investigate " + g.Title,
			Description: g.Description,
			Rationale:   "Gap in current literature suggests further investigation",
			SuggestedMethodology: "Standard research methodology",
			Feasibility: "medium",
			Novelty:     "medium",
			BasedOnGaps: []string{g.ID},
			PotentialImpact: "Moderate potential for advancing the field",
		}
	}
}

func SuggestNovelAngles(topic string, papers []types.Paper) []types.ResearchDirection {
	var directions []types.ResearchDirection
	methodsCount := make(map[string]int)
	for _, p := range papers {
		title := strings.ToLower(p.Title)
		methods := []string{"survey", "review", "experiment", "case study", "qualitative", "quantitative", "simulation", "machine learning", "mixed methods"}
		for _, m := range methods {
			if strings.Contains(title, m) {
				methodsCount[m]++
			}
		}
	}
	underused := make([]string, 0)
	methodsToCheck := []string{"survey/review", "experiment", "case study", "qualitative", "quantitative", "simulation", "machine learning", "mixed methods"}
	for _, m := range methodsToCheck {
		if methodsCount[m] <= 2 {
			underused = append(underused, m)
		}
	}
	for _, m := range underused {
		directions = append(directions, types.ResearchDirection{
			ID:          uuid.NewString(),
			Title:       "Apply " + m + " to " + topic,
			Description: "Use " + m + " to investigate " + topic,
			Rationale:   "This method is underutilized in this domain",
			SuggestedMethodology: m,
			Feasibility: "medium",
			Novelty:     "high",
			BasedOnGaps: []string{},
			PotentialImpact: "High potential for advancing the field",
		})
	}

	disciplines := map[string]string{
		"computer science": "algorithm|software|computing|data|machine learning",
		"psychology":       "cognitive|behavioral|mental|psychological",
		"economics":        "economic|market|financial|cost",
		"medicine":         "clinical|patient|medical|health|treatment",
		"engineering":      "design|system|optimization|engineering",
		"social science":   "social|community|cultural|society",
	}
	titleSet := make([]string, len(papers))
	for i, p := range papers {
		titleSet[i] = strings.ToLower(p.Title)
	}
	missingDisc := ""
	for disc, pattern := range disciplines {
		found := false
		for _, t := range titleSet {
			re := regexp.MustCompile(pattern)
			if re.MatchString(t) {
				found = true
				break
			}
		}
		if !found {
			missingDisc = disc
			break
		}
	}
	if missingDisc != "" {
		directions = append(directions, types.ResearchDirection{
			ID:          uuid.NewString(),
			Title:       "Interdisciplinary approach: " + topic + " meets " + missingDisc,
			Description: "Combine " + topic + " with insights from " + missingDisc,
			Rationale:   "This discipline is underrepresented in current research",
			SuggestedMethodology: "Collaborative interdisciplinary research",
			Feasibility: "medium",
			Novelty:     "high",
			BasedOnGaps: []string{},
			PotentialImpact: "High potential for advancing the field",
		})
	}

	currentYear := time.Now().Year()
	mostRecent := 0
	for _, p := range papers {
		yr, err := time.Parse("2006", p.Year)
		if err == nil && yr.Year() > mostRecent {
			mostRecent = yr.Year()
		}
	}
	if mostRecent > 0 && currentYear-mostRecent >= 2 {
		directions = append(directions, types.ResearchDirection{
			ID:          uuid.NewString(),
			Title:       "Contemporary update on " + topic,
			Description: "Recent work is lacking; a fresh study needed",
			Rationale:   "More than 2 years have passed since the last publication",
			SuggestedMethodology: "Replication and extension",
			Feasibility: "high",
			Novelty:     "medium",
			BasedOnGaps: []string{},
			PotentialImpact: "Moderate potential for advancing the field",
		})
	}

	if len(directions) > 5 {
		directions = directions[:5]
	}
	return directions
}

func ProcessLLMDirections(llm []types.LLMDirectionSuggestion, gaps []types.ResearchGap) []types.ResearchDirection {
	var directions []types.ResearchDirection
	gapIDs := make([]string, 0, 3)
	for i, g := range gaps {
		if i >= 3 {
			break
		}
		gapIDs = append(gapIDs, g.ID)
	}
	for _, d := range llm {
		impact := "Moderate potential for advancing the field."
		if d.Novelty == "high" {
			impact = "High potential for advancing the field."
		}
		directions = append(directions, types.ResearchDirection{
			ID:                uuid.NewString(),
			Title:             d.Title,
			Description:       d.Description,
			Rationale:         d.Rationale,
			SuggestedMethodology:       d.Methodology,
			Feasibility:       d.Feasibility,
			Novelty:           d.Novelty,
			BasedOnGaps:       gapIDs,
			PotentialImpact:   impact,
		})
	}
	return directions
}

func RankDirections(d []types.ResearchDirection) []types.ResearchDirection {
	severityScore := map[types.GapSeverity]int{
		"high":   3,
		"medium": 2,
		"low":    1,
	}
	scored := make([]struct {
		dir   types.ResearchDirection
		score int
	}, len(d))
	for i, dir := range d {
		n := severityScore[dir.Novelty]
		f := severityScore[dir.Feasibility]
		scored[i] = struct {
			dir   types.ResearchDirection
			score int
		}{dir, n*2 + f}
	}
	sort.Slice(scored, func(i, j int) bool {
		return scored[i].score > scored[j].score
	})
	result := make([]types.ResearchDirection, len(d))
	for i, s := range scored {
		result[i] = s.dir
	}
	return result
}
