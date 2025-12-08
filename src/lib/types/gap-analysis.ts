// Gap Analysis Type Definitions

// Gap types
export type GapType =
  | 'under-researched-topic'
  | 'methodological-gap'
  | 'theoretical-gap'
  | 'temporal-gap'
  | 'geographical-gap'
  | 'contradictory-findings';

export type GapSeverity = 'high' | 'medium' | 'low';
export type AnalysisDepth = 'quick' | 'deep';
export type AnalysisType = 'gaps' | 'comparisons' | 'directions' | 'all';

// Evidence supporting a gap
export interface GapEvidence {
  paperCount: number;
  citationDensity: number;
  yearRange: string;
  keywords: string[];
  observations: string[];
}

// Individual research gap
export interface ResearchGap {
  id: string;
  type: GapType;
  severity: GapSeverity;
  title: string;
  description: string;
  evidence: GapEvidence;
  relatedPapers: string[]; // DOIs
  suggestedApproach?: string;
}

// Comparison finding
export interface ComparisonFinding {
  aspect: string;
  differences: string[];
  similarities: string[];
}

// Paper comparison
export interface PaperComparison {
  id: string;
  papers: string[]; // DOIs
  dimension: 'methodology' | 'results' | 'approach' | 'theory';
  findings: ComparisonFinding[];
  contradictions?: string[];
}

// Research direction suggestion
export interface ResearchDirection {
  id: string;
  title: string;
  description: string;
  rationale: string;
  feasibility: 'high' | 'medium' | 'low';
  novelty: 'high' | 'medium' | 'low';
  basedOnGaps: string[]; // Gap IDs
  suggestedMethodology?: string;
  potentialImpact?: string;
}

// Trend analysis
export interface TrendAnalysis {
  yearlyDistribution: Record<string, number>;
  peakYears: string[];
  decliningTrends: string[];
  emergingTopics: string[];
}

// Paper clusters
export interface PaperCluster {
  id: string;
  name: string;
  keywords: string[];
  papers: string[]; // DOIs
  averageYear: number;
  size: number;
}

// Analysis metadata
export interface AnalysisMetadata {
  analysisDate: Date;
  analysisTypes: AnalysisType[];
  paperCount: number;
  yearRange: string;
  depth: AnalysisDepth;
  searchQueries: string[];
  processingTime: number; // ms
}

// Complete gap analysis result
export interface GapAnalysisResult {
  taskId: string;
  topic: string;
  papers: import('./paper').Paper[];
  gaps: ResearchGap[];
  comparisons: PaperComparison[];
  directions: ResearchDirection[];
  trends?: TrendAnalysis;
  clusters?: PaperCluster[];
  metadata: AnalysisMetadata;
}

// Gap task states
export type GapTaskState = 'pending' | 'searching' | 'collecting' | 'analyzing' | 'comparing' | 'generating' | 'complete' | 'error';

// Gap task status
export interface GapTaskStatus {
  id: string;
  type: 'gap-analysis';
  status: GapTaskState;
  progress: number;
  stage: string;
  topic: string;
  papersFound: number;
  gapsIdentified: number;
  comparisonsComplete: number;
  directionsGenerated: number;
  error?: string;
  resultUrl?: string;
  reportUrl?: string;
  lastUpdate: Date;
}

// Gap analysis request
export interface GapAnalysisRequest {
  topic: string;
  analysisTypes: AnalysisType[];
  papers: number;
  yearFilter?: string;
  depth: AnalysisDepth;
}

// LLM analysis response types
export interface LLMGapAnalysis {
  gaps: {
    title: string;
    type: GapType;
    severity: GapSeverity;
    description: string;
    suggestedApproach?: string;
  }[];
  observations: string[];
}

export interface LLMComparisonAnalysis {
  methodologies: string[];
  contradictions: string[];
  commonApproaches: string[];
  uniqueContributions: string[];
}

export interface LLMDirectionSuggestion {
  title: string;
  description: string;
  rationale: string;
  methodology: string;
  feasibility: 'high' | 'medium' | 'low';
  novelty: 'high' | 'medium' | 'low';
}
