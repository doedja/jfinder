package gap

import (
	"regexp"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/doedja/jfinder/internal/types"
)

var methodologyPatterns = map[string]string{
	"deep-learning":   "deep learning|neural network|cnn|rnn|transformer|lstm|bert|gpt",
	"machine-learning": "machine learning|classification|clustering|prediction|svm|random forest|decision tree",
	"survey":          "survey|review|meta-analysis|systematic review|literature review",
	"statistical":     "regression|correlation|anova|statistical|hypothesis",
	"experimental":    "experiment|trial|empirical|controlled study",
	"theoretical":     "theoretical|framework|model|theory|conceptual",
}

var contradictionPairs = [][2]string{
	{"increase", "decrease"},
	{"positive", "negative"},
	{"improve", "worsen"},
	{"effective", "ineffective"},
	{"success", "failure"},
	{"benefit", "harm"},
	{"support", "contradict"},
	{"confirm", "refute"},
}

func CompareMethodologies(papers []types.Paper) []types.PaperComparison {
	buckets := make(map[string][]types.Paper)
	for _, p := range papers {
		title := strings.ToLower(p.Title)
		matched := false
		for bucket, pattern := range methodologyPatterns {
			re := regexp.MustCompile(pattern)
			if re.MatchString(title) {
				buckets[bucket] = append(buckets[bucket], p)
				matched = true
				break
			}
		}
		if !matched {
			buckets["other"] = append(buckets["other"], p)
		}
	}
	for k, v := range buckets {
		if len(v) == 0 {
			delete(buckets, k)
		}
	}
	var comparisons []types.PaperComparison
	bucketNames := make([]string, 0, len(buckets))
	for k := range buckets {
		bucketNames = append(bucketNames, k)
	}
	for i := 0; i < len(bucketNames); i++ {
		for j := i + 1; j < len(bucketNames); j++ {
			g1 := bucketNames[i]
			g2 := bucketNames[j]
			dois := make([]string, 0, 4)
			for _, p := range buckets[g1][:min(2, len(buckets[g1]))] {
				dois = append(dois, p.DOI)
			}
			for _, p := range buckets[g2][:min(2, len(buckets[g2]))] {
				dois = append(dois, p.DOI)
			}
			comp := types.PaperComparison{
				ID:        uuid.NewString(),
				Papers:    dois,
				Dimension: "methodology",
				Findings: []types.ComparisonFinding{
					{
						Aspect: "Methodology Comparison",
						Differences: []string{
							g1 + ": " + strconv.Itoa(len(buckets[g1])) + " papers",
							g2 + ": " + strconv.Itoa(len(buckets[g2])) + " papers",
						},
						Similarities: []string{"Both address similar research questions"},
					},
				},
			}
			comparisons = append(comparisons, comp)
		}
	}
	return comparisons
}

func FindContradictions(papers []types.Paper) []string {
	var contradictions []string
	titleSet := make([]string, len(papers))
	for i, p := range papers {
		titleSet[i] = strings.ToLower(p.Title)
	}
	for i := 0; i < len(papers); i++ {
		for j := i + 1; j < len(papers); j++ {
			if len(contradictions) >= 5 {
				return contradictions
			}
			t1 := titleSet[i]
			t2 := titleSet[j]
			for _, pair := range contradictionPairs {
				has1 := strings.Contains(t1, pair[0]) && strings.Contains(t2, pair[1])
				has2 := strings.Contains(t1, pair[1]) && strings.Contains(t2, pair[0])
				if has1 || has2 {
					contradictions = append(contradictions,
						"Potential contradiction: \""+truncate(papers[i].Title, 50)+"...\" vs \""+truncate(papers[j].Title, 50)+"...\"")
					break
				}
			}
		}
	}
	return contradictions
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return s[:max]
}

func GroupByApproach(papers []types.Paper) map[string][]types.Paper {
	result := map[string][]types.Paper{
		"quantitative": {},
		"qualitative":  {},
		"mixed":        {},
		"other":        {},
	}
	for _, p := range papers {
		title := strings.ToLower(p.Title)
		quantRe := regexp.MustCompile(`statistical|regression|correlation|experiment|empirical|measurement|data|analysis|model|simulation`)
		qualRe := regexp.MustCompile(`interview|ethnograph|case study|narrative|phenomenolog|grounded theory|qualitative|interpretive`)
		mixedRe := regexp.MustCompile(`mixed method|multi-method|triangulation`)
		if mixedRe.MatchString(title) {
			result["mixed"] = append(result["mixed"], p)
		} else if quantRe.MatchString(title) {
			result["quantitative"] = append(result["quantitative"], p)
		} else if qualRe.MatchString(title) {
			result["qualitative"] = append(result["qualitative"], p)
		} else {
			result["other"] = append(result["other"], p)
		}
	}
	for k, v := range result {
		if len(v) == 0 {
			delete(result, k)
		}
	}
	return result
}

func FindDifferentApproaches(papers []types.Paper) []types.PaperComparison {
	groups := GroupByApproach(papers)
	var comparisons []types.PaperComparison
	quant := groups["quantitative"]
	qual := groups["qualitative"]
	if len(quant) > 0 && len(qual) > 0 {
		dois := make([]string, 0, 4)
		for i, p := range quant {
			if i >= 2 {
				break
			}
			dois = append(dois, p.DOI)
		}
		for i, p := range qual {
			if i >= 2 {
				break
			}
			dois = append(dois, p.DOI)
		}
		comp := types.PaperComparison{
			ID:        uuid.NewString(),
			Papers:    dois,
			Dimension: "approach",
			Findings: []types.ComparisonFinding{
				{
					Aspect: "Methodological Approach",
					Differences: []string{
						"Quantitative: " + strconv.Itoa(len(quant)) + " papers",
						"Qualitative: " + strconv.Itoa(len(qual)) + " papers",
					},
					Similarities: []string{"Both address similar research questions"},
				},
			},
		}
		comparisons = append(comparisons, comp)
	}
	return comparisons
}

func ProcessLLMComparison(llm types.LLMComparisonAnalysis, papers []types.Paper) types.PaperComparison {
	dois := make([]string, 0, 5)
	for i, p := range papers {
		if i >= 5 {
			break
		}
		if p.DOI != "" {
			dois = append(dois, p.DOI)
		}
	}
	return types.PaperComparison{
		ID:        uuid.NewString(),
		Papers:    dois,
		Dimension: "approach",
		Findings: []types.ComparisonFinding{
			{
				Aspect:       "Methodological Comparison",
				Differences:  llm.UniqueContributions,
				Similarities: llm.CommonApproaches,
			},
		},
		Contradictions: llm.Contradictions,
	}
}
