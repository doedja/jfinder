package types

import "time"

type GapType string

const (
	GapUnderResearched GapType = "under-researched-topic"
	GapMethodological  GapType = "methodological-gap"
	GapTheoretical     GapType = "theoretical-gap"
	GapTemporal        GapType = "temporal-gap"
	GapGeographical    GapType = "geographical-gap"
	GapContradictory   GapType = "contradictory-findings"
)

type GapSeverity string

const (
	SeverityHigh   GapSeverity = "high"
	SeverityMedium GapSeverity = "medium"
	SeverityLow    GapSeverity = "low"
)

type AnalysisDepth string

const (
	DepthQuick AnalysisDepth = "quick"
	DepthDeep  AnalysisDepth = "deep"
)

type AnalysisType string

const (
	AnalysisGaps        AnalysisType = "gaps"
	AnalysisComparisons AnalysisType = "comparisons"
	AnalysisDirections  AnalysisType = "directions"
	AnalysisAll         AnalysisType = "all"
)

type GapEvidence struct {
	PaperCount      int      `json:"paperCount"`
	CitationDensity int      `json:"citationDensity"`
	YearRange       string   `json:"yearRange"`
	Keywords        []string `json:"keywords"`
	Observations    []string `json:"observations"`
}

type ResearchGap struct {
	ID                string      `json:"id"`
	Type              GapType     `json:"type"`
	Severity          GapSeverity `json:"severity"`
	Title             string      `json:"title"`
	Description       string      `json:"description"`
	Evidence          GapEvidence `json:"evidence"`
	RelatedPapers     []string    `json:"relatedPapers"`
	SuggestedApproach string      `json:"suggestedApproach,omitempty"`
}

type ComparisonFinding struct {
	Aspect       string   `json:"aspect"`
	Differences  []string `json:"differences"`
	Similarities []string `json:"similarities"`
}

type PaperComparison struct {
	ID             string              `json:"id"`
	Papers         []string            `json:"papers"`
	Dimension      string              `json:"dimension"`
	Findings       []ComparisonFinding `json:"findings"`
	Contradictions []string            `json:"contradictions,omitempty"`
}

type ResearchDirection struct {
	ID                   string      `json:"id"`
	Title                string      `json:"title"`
	Description          string      `json:"description"`
	Rationale            string      `json:"rationale"`
	Feasibility          GapSeverity `json:"feasibility"`
	Novelty              GapSeverity `json:"novelty"`
	BasedOnGaps          []string    `json:"basedOnGaps"`
	SuggestedMethodology string      `json:"suggestedMethodology,omitempty"`
	PotentialImpact      string      `json:"potentialImpact,omitempty"`
}

type TrendAnalysis struct {
	YearlyDistribution map[string]int `json:"yearlyDistribution"`
	PeakYears          []string       `json:"peakYears"`
	DecliningTrends    []string       `json:"decliningTrends"`
	EmergingTopics     []string       `json:"emergingTopics"`
}

type PaperCluster struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Keywords    []string `json:"keywords"`
	Papers      []string `json:"papers"`
	AverageYear int      `json:"averageYear"`
	Size        int      `json:"size"`
}

type AnalysisMetadata struct {
	AnalysisDate   time.Time      `json:"analysisDate"`
	AnalysisTypes  []AnalysisType `json:"analysisTypes"`
	PaperCount     int            `json:"paperCount"`
	YearRange      string         `json:"yearRange"`
	Depth          AnalysisDepth  `json:"depth"`
	SearchQueries  []string       `json:"searchQueries"`
	ProcessingTime int64          `json:"processingTime"`
}

type GapAnalysisResult struct {
	TaskID      string              `json:"taskId"`
	Topic       string              `json:"topic"`
	Papers      []Paper             `json:"papers"`
	Gaps        []ResearchGap       `json:"gaps"`
	Comparisons []PaperComparison   `json:"comparisons"`
	Directions  []ResearchDirection `json:"directions"`
	Trends      *TrendAnalysis      `json:"trends,omitempty"`
	Clusters    []PaperCluster      `json:"clusters,omitempty"`
	Metadata    AnalysisMetadata    `json:"metadata"`
}

type GapTaskState string

const (
	GapPending    GapTaskState = "pending"
	GapSearching  GapTaskState = "searching"
	GapCollecting GapTaskState = "collecting"
	GapAnalyzing  GapTaskState = "analyzing"
	GapComparing  GapTaskState = "comparing"
	GapGenerating GapTaskState = "generating"
	GapComplete   GapTaskState = "complete"
	GapError      GapTaskState = "error"
)

type GapTaskStatus struct {
	ID                   string       `json:"id"`
	Type                 string       `json:"type"`
	Status               GapTaskState `json:"status"`
	Progress             int          `json:"progress"`
	Stage                string       `json:"stage"`
	Topic                string       `json:"topic"`
	PapersFound          int          `json:"papersFound"`
	GapsIdentified       int          `json:"gapsIdentified"`
	ComparisonsComplete  int          `json:"comparisonsComplete"`
	DirectionsGenerated  int          `json:"directionsGenerated"`
	Err                  string       `json:"error,omitempty"`
	ResultURL            string       `json:"resultUrl,omitempty"`
	ReportURL            string       `json:"reportUrl,omitempty"`
	LastUpdate           time.Time    `json:"lastUpdate"`
}

func (t *GapTaskStatus) GetID() string            { return t.ID }
func (t *GapTaskStatus) GetStatus() string        { return string(t.Status) }
func (t *GapTaskStatus) GetLastUpdate() time.Time { return t.LastUpdate }

type GapAnalysisRequest struct {
	Topic         string         `json:"topic"`
	AnalysisTypes []AnalysisType `json:"analysisTypes"`
	Papers        int            `json:"papers"`
	YearFilter    string         `json:"yearFilter,omitempty"`
	Depth         AnalysisDepth  `json:"depth"`
}

type LLMGap struct {
	Title             string      `json:"title"`
	Type              GapType     `json:"type"`
	Severity          GapSeverity `json:"severity"`
	Description       string      `json:"description"`
	SuggestedApproach string      `json:"suggestedApproach,omitempty"`
}

type LLMGapAnalysis struct {
	Gaps         []LLMGap `json:"gaps"`
	Observations []string `json:"observations"`
}

type LLMComparisonAnalysis struct {
	Methodologies        []string `json:"methodologies"`
	Contradictions       []string `json:"contradictions"`
	CommonApproaches     []string `json:"commonApproaches"`
	UniqueContributions  []string `json:"uniqueContributions"`
}

type LLMDirectionSuggestion struct {
	Title       string      `json:"title"`
	Description string      `json:"description"`
	Rationale   string      `json:"rationale"`
	Methodology string      `json:"methodology"`
	Feasibility GapSeverity `json:"feasibility"`
	Novelty     GapSeverity `json:"novelty"`
}
