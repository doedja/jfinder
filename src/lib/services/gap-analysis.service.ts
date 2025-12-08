import type { Paper } from '../types/paper';
import type {
  ResearchGap,
  GapEvidence,
  TrendAnalysis,
  PaperCluster,
  GapType,
  GapSeverity,
  LLMGapAnalysis
} from '../types/gap-analysis';
import { v4 as uuidv4 } from 'uuid';

/**
 * Analyze papers to find under-researched areas
 */
export async function findUnderResearchedAreas(
  papers: Paper[],
  topic: string
): Promise<ResearchGap[]> {
  const gaps: ResearchGap[] = [];

  // Analyze year distribution
  const yearDistribution = getYearDistribution(papers);
  const temporalGaps = findTemporalGaps(yearDistribution, topic);
  gaps.push(...temporalGaps);

  // Analyze keyword/topic distribution
  const keywordGaps = findKeywordGaps(papers, topic);
  gaps.push(...keywordGaps);

  return gaps;
}

/**
 * Analyze publication trends
 */
export function analyzeTrends(papers: Paper[]): TrendAnalysis {
  const yearDistribution = getYearDistribution(papers);
  const years = Object.keys(yearDistribution).sort();

  // Find peak years (top 20% by publication count)
  const counts = Object.values(yearDistribution);
  const threshold = Math.max(...counts) * 0.8;
  const peakYears = years.filter(y => yearDistribution[y] >= threshold);

  // Find declining trends (years with decreasing publications)
  const decliningTrends: string[] = [];
  for (let i = 1; i < years.length; i++) {
    if (yearDistribution[years[i]] < yearDistribution[years[i - 1]] * 0.7) {
      decliningTrends.push(`${years[i - 1]} → ${years[i]}`);
    }
  }

  // Extract emerging topics from recent papers
  const recentPapers = papers.filter(p => {
    const year = parseInt(p.year);
    return !isNaN(year) && year >= new Date().getFullYear() - 2;
  });
  const emergingTopics = extractTopicsFromTitles(recentPapers);

  return {
    yearlyDistribution: yearDistribution,
    peakYears,
    decliningTrends,
    emergingTopics
  };
}

/**
 * Cluster papers by similarity
 */
export function clusterPapers(papers: Paper[]): PaperCluster[] {
  // Simple keyword-based clustering
  const keywordMap = new Map<string, Paper[]>();

  papers.forEach(paper => {
    const keywords = extractKeywordsFromTitle(paper.title);
    keywords.forEach(keyword => {
      if (!keywordMap.has(keyword)) {
        keywordMap.set(keyword, []);
      }
      keywordMap.get(keyword)!.push(paper);
    });
  });

  // Create clusters from keywords with multiple papers
  const clusters: PaperCluster[] = [];
  keywordMap.forEach((clusterPapers, keyword) => {
    if (clusterPapers.length >= 2) {
      const years = clusterPapers
        .map(p => parseInt(p.year))
        .filter(y => !isNaN(y));
      const averageYear = years.length > 0
        ? Math.round(years.reduce((a, b) => a + b, 0) / years.length)
        : 0;

      clusters.push({
        id: uuidv4(),
        name: keyword,
        keywords: [keyword],
        papers: clusterPapers.map(p => p.doi),
        averageYear,
        size: clusterPapers.length
      });
    }
  });

  // Sort by size (largest first)
  return clusters.sort((a, b) => b.size - a.size).slice(0, 10);
}

/**
 * Process LLM gap analysis response into structured gaps
 */
export function processLLMGapAnalysis(
  llmResult: LLMGapAnalysis,
  papers: Paper[]
): ResearchGap[] {
  return llmResult.gaps.map(gap => ({
    id: uuidv4(),
    type: gap.type,
    severity: gap.severity,
    title: gap.title,
    description: gap.description,
    evidence: {
      paperCount: papers.length,
      citationDensity: 0, // Would need citation data
      yearRange: getYearRange(papers),
      keywords: extractTopicsFromTitles(papers.slice(0, 5)),
      observations: llmResult.observations.slice(0, 3)
    },
    relatedPapers: papers.slice(0, 5).map(p => p.doi),
    suggestedApproach: gap.suggestedApproach
  }));
}

// --- Helper Functions ---

function getYearDistribution(papers: Paper[]): Record<string, number> {
  const distribution: Record<string, number> = {};

  papers.forEach(paper => {
    const year = paper.year;
    if (year && year !== 'Unknown Year') {
      distribution[year] = (distribution[year] || 0) + 1;
    }
  });

  return distribution;
}

function getYearRange(papers: Paper[]): string {
  const years = papers
    .map(p => parseInt(p.year))
    .filter(y => !isNaN(y))
    .sort((a, b) => a - b);

  if (years.length === 0) return 'Unknown';
  if (years.length === 1) return years[0].toString();
  return `${years[0]}-${years[years.length - 1]}`;
}

function findTemporalGaps(
  yearDistribution: Record<string, number>,
  topic: string
): ResearchGap[] {
  const gaps: ResearchGap[] = [];
  const years = Object.keys(yearDistribution).map(Number).sort((a, b) => a - b);

  if (years.length < 2) return gaps;

  // Find years with no publications
  for (let y = years[0]; y <= years[years.length - 1]; y++) {
    if (!yearDistribution[y.toString()]) {
      gaps.push({
        id: uuidv4(),
        type: 'temporal-gap',
        severity: 'medium',
        title: `No publications in ${y}`,
        description: `There appears to be a gap in research publications for "${topic}" during ${y}. This could indicate either a decline in interest or an opportunity for new contributions.`,
        evidence: {
          paperCount: 0,
          citationDensity: 0,
          yearRange: y.toString(),
          keywords: [],
          observations: [`No papers found for year ${y}`]
        },
        relatedPapers: []
      });
    }
  }

  // Find recent decline
  const currentYear = new Date().getFullYear();
  const recentYears = years.filter(y => y >= currentYear - 3);
  if (recentYears.length > 0) {
    const recentAvg = recentYears.reduce((sum, y) =>
      sum + (yearDistribution[y.toString()] || 0), 0) / recentYears.length;
    const olderYears = years.filter(y => y < currentYear - 3 && y >= currentYear - 6);
    const olderAvg = olderYears.length > 0
      ? olderYears.reduce((sum, y) => sum + (yearDistribution[y.toString()] || 0), 0) / olderYears.length
      : 0;

    if (recentAvg < olderAvg * 0.5) {
      gaps.push({
        id: uuidv4(),
        type: 'temporal-gap',
        severity: 'high',
        title: 'Declining research activity',
        description: `Recent publications (${currentYear - 3}-${currentYear}) show a significant decline compared to earlier years. This could indicate a maturing field or an opportunity for revival with new perspectives.`,
        evidence: {
          paperCount: Math.round(recentAvg),
          citationDensity: 0,
          yearRange: `${currentYear - 3}-${currentYear}`,
          keywords: [],
          observations: [`Average publications declined from ${olderAvg.toFixed(1)} to ${recentAvg.toFixed(1)}`]
        },
        relatedPapers: []
      });
    }
  }

  return gaps;
}

function findKeywordGaps(papers: Paper[], topic: string): ResearchGap[] {
  const gaps: ResearchGap[] = [];

  // Extract all keywords from titles
  const allKeywords = new Map<string, number>();
  papers.forEach(paper => {
    const keywords = extractKeywordsFromTitle(paper.title);
    keywords.forEach(kw => {
      allKeywords.set(kw, (allKeywords.get(kw) || 0) + 1);
    });
  });

  // Find under-represented keywords (mentioned only once)
  const underRepresented: string[] = [];
  allKeywords.forEach((count, keyword) => {
    if (count === 1 && keyword.length > 4) {
      underRepresented.push(keyword);
    }
  });

  if (underRepresented.length > 3) {
    gaps.push({
      id: uuidv4(),
      type: 'under-researched-topic',
      severity: 'medium',
      title: 'Unique sub-topics with limited coverage',
      description: `Several sub-topics appear only once in the literature: ${underRepresented.slice(0, 5).join(', ')}. These could represent emerging areas or unexplored angles.`,
      evidence: {
        paperCount: underRepresented.length,
        citationDensity: 0,
        yearRange: getYearRange(papers),
        keywords: underRepresented.slice(0, 10),
        observations: ['Each topic appears in only one paper']
      },
      relatedPapers: []
    });
  }

  return gaps;
}

function extractKeywordsFromTitle(title: string): string[] {
  // Common stop words to filter out
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
    'dare', 'ought', 'used', 'using', 'based', 'study', 'analysis',
    'review', 'approach', 'method', 'new', 'novel', 'towards', 'toward'
  ]);

  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3 && !stopWords.has(word));
}

function extractTopicsFromTitles(papers: Paper[]): string[] {
  const topicCounts = new Map<string, number>();

  papers.forEach(paper => {
    const keywords = extractKeywordsFromTitle(paper.title);
    keywords.forEach(kw => {
      topicCounts.set(kw, (topicCounts.get(kw) || 0) + 1);
    });
  });

  // Sort by frequency and return top topics
  return Array.from(topicCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([topic]) => topic);
}
