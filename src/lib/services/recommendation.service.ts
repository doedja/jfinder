import type { Paper } from '../types/paper';
import type {
  ResearchGap,
  ResearchDirection,
  PaperCluster,
  LLMDirectionSuggestion,
  GapType
} from '../types/gap-analysis';
import { v4 as uuidv4 } from 'uuid';

/**
 * Generate research directions based on identified gaps
 */
export function generateDirections(
  gaps: ResearchGap[],
  papers: Paper[]
): ResearchDirection[] {
  const directions: ResearchDirection[] = [];

  // Generate directions from high-severity gaps first
  const sortedGaps = [...gaps].sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  sortedGaps.forEach(gap => {
    const direction = generateDirectionFromGap(gap, papers);
    if (direction) {
      directions.push(direction);
    }
  });

  // Add cross-gap directions (combining multiple gaps)
  if (gaps.length >= 2) {
    const crossDirections = generateCrossGapDirections(gaps, papers);
    directions.push(...crossDirections);
  }

  return directions.slice(0, 10); // Limit to top 10 directions
}

/**
 * Suggest novel research angles based on topic and existing papers
 */
export function suggestNovelAngles(
  topic: string,
  papers: Paper[]
): ResearchDirection[] {
  const directions: ResearchDirection[] = [];

  // Extract methodologies from papers
  const methodologies = extractMethodologies(papers);
  const underusedMethods = findUnderusedMethodologies(methodologies);

  // Suggest applying underused methods
  underusedMethods.forEach(method => {
    directions.push({
      id: uuidv4(),
      title: `Apply ${method} to ${topic}`,
      description: `Explore ${topic} using ${method} methodology, which appears underutilized in current research.`,
      rationale: `Only ${methodologies[method] || 0} papers use this approach, suggesting potential for novel contributions.`,
      feasibility: 'medium',
      novelty: 'high',
      basedOnGaps: [],
      suggestedMethodology: method,
      potentialImpact: 'Could provide new perspectives and validate existing findings through alternative methods.'
    });
  });

  // Suggest interdisciplinary approaches
  const interdisciplinaryDirection = suggestInterdisciplinary(topic, papers);
  if (interdisciplinaryDirection) {
    directions.push(interdisciplinaryDirection);
  }

  // Suggest temporal extensions
  const temporalDirection = suggestTemporalExtension(topic, papers);
  if (temporalDirection) {
    directions.push(temporalDirection);
  }

  return directions.slice(0, 5);
}

/**
 * Process LLM-generated direction suggestions
 */
export function processLLMDirections(
  llmSuggestions: LLMDirectionSuggestion[],
  gaps: ResearchGap[]
): ResearchDirection[] {
  return llmSuggestions.map(suggestion => ({
    id: uuidv4(),
    title: suggestion.title,
    description: suggestion.description,
    rationale: suggestion.rationale,
    feasibility: suggestion.feasibility,
    novelty: suggestion.novelty,
    basedOnGaps: gaps.slice(0, 3).map(g => g.id),
    suggestedMethodology: suggestion.methodology,
    potentialImpact: `${suggestion.novelty === 'high' ? 'High' : 'Moderate'} potential for advancing the field.`
  }));
}

/**
 * Rank directions by potential impact
 */
export function rankDirections(directions: ResearchDirection[]): ResearchDirection[] {
  return [...directions].sort((a, b) => {
    // Score based on novelty and feasibility
    const scoreMap = { high: 3, medium: 2, low: 1 };
    const scoreA = scoreMap[a.novelty] * 2 + scoreMap[a.feasibility];
    const scoreB = scoreMap[b.novelty] * 2 + scoreMap[b.feasibility];
    return scoreB - scoreA;
  });
}

/**
 * Get direction summary statistics
 */
export function getDirectionStats(directions: ResearchDirection[]): {
  total: number;
  byFeasibility: Record<string, number>;
  byNovelty: Record<string, number>;
  topMethodologies: string[];
} {
  const byFeasibility: Record<string, number> = { high: 0, medium: 0, low: 0 };
  const byNovelty: Record<string, number> = { high: 0, medium: 0, low: 0 };
  const methodologyCounts: Record<string, number> = {};

  directions.forEach(d => {
    byFeasibility[d.feasibility]++;
    byNovelty[d.novelty]++;
    if (d.suggestedMethodology) {
      methodologyCounts[d.suggestedMethodology] =
        (methodologyCounts[d.suggestedMethodology] || 0) + 1;
    }
  });

  const topMethodologies = Object.entries(methodologyCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([method]) => method);

  return {
    total: directions.length,
    byFeasibility,
    byNovelty,
    topMethodologies
  };
}

// --- Helper Functions ---

function generateDirectionFromGap(
  gap: ResearchGap,
  papers: Paper[]
): ResearchDirection | null {
  const gapTypeStrategies: Record<GapType, () => ResearchDirection> = {
    'under-researched-topic': () => ({
      id: uuidv4(),
      title: `Investigate ${gap.title}`,
      description: `Conduct focused research on this under-explored area: ${gap.description}`,
      rationale: `Current literature shows limited coverage with only ${gap.evidence.paperCount} papers addressing this topic.`,
      feasibility: 'medium',
      novelty: 'high',
      basedOnGaps: [gap.id],
      suggestedMethodology: 'Mixed methods approach combining systematic review with empirical study',
      potentialImpact: 'Addresses a clear gap in the literature with potential for foundational contributions.'
    }),

    'methodological-gap': () => ({
      id: uuidv4(),
      title: `Develop new methodology for ${gap.evidence.keywords.slice(0, 2).join(' and ')}`,
      description: `Address the methodological limitations identified: ${gap.description}`,
      rationale: gap.evidence.observations.join('; '),
      feasibility: 'low',
      novelty: 'high',
      basedOnGaps: [gap.id],
      suggestedMethodology: 'Methodological innovation with validation study',
      potentialImpact: 'Could establish new standards for research in this area.'
    }),

    'theoretical-gap': () => ({
      id: uuidv4(),
      title: `Develop theoretical framework for ${gap.evidence.keywords[0] || 'this domain'}`,
      description: `Build a comprehensive theoretical foundation: ${gap.description}`,
      rationale: 'Current research lacks unified theoretical grounding.',
      feasibility: 'medium',
      novelty: 'high',
      basedOnGaps: [gap.id],
      suggestedMethodology: 'Theory building through systematic analysis and synthesis',
      potentialImpact: 'Would provide foundation for future empirical work.'
    }),

    'temporal-gap': () => ({
      id: uuidv4(),
      title: `Update research on ${gap.evidence.keywords.slice(0, 2).join(' and ')}`,
      description: `Revisit and update findings from ${gap.evidence.yearRange}: ${gap.description}`,
      rationale: 'Research in this area has declined or shows gaps in temporal coverage.',
      feasibility: 'high',
      novelty: 'medium',
      basedOnGaps: [gap.id],
      suggestedMethodology: 'Replication study with contemporary data',
      potentialImpact: 'Validates or updates existing knowledge for current context.'
    }),

    'geographical-gap': () => ({
      id: uuidv4(),
      title: `Expand geographical scope of ${gap.evidence.keywords[0] || 'research'}`,
      description: `Extend research to underrepresented regions: ${gap.description}`,
      rationale: 'Current research is geographically limited.',
      feasibility: 'medium',
      novelty: 'medium',
      basedOnGaps: [gap.id],
      suggestedMethodology: 'Cross-cultural or multi-region comparative study',
      potentialImpact: 'Improves generalizability of findings.'
    }),

    'contradictory-findings': () => ({
      id: uuidv4(),
      title: `Resolve contradictions in ${gap.evidence.keywords.slice(0, 2).join(' and ')}`,
      description: `Investigate and reconcile conflicting findings: ${gap.description}`,
      rationale: 'Multiple studies report contradictory results requiring resolution.',
      feasibility: 'medium',
      novelty: 'medium',
      basedOnGaps: [gap.id],
      suggestedMethodology: 'Meta-analysis or large-scale replication study',
      potentialImpact: 'Clarifies field understanding and resolves confusion.'
    })
  };

  const strategy = gapTypeStrategies[gap.type];
  return strategy ? strategy() : null;
}

function generateCrossGapDirections(
  gaps: ResearchGap[],
  papers: Paper[]
): ResearchDirection[] {
  const directions: ResearchDirection[] = [];

  // Combine methodological and under-researched gaps
  const methodGaps = gaps.filter(g => g.type === 'methodological-gap');
  const topicGaps = gaps.filter(g => g.type === 'under-researched-topic');

  if (methodGaps.length > 0 && topicGaps.length > 0) {
    directions.push({
      id: uuidv4(),
      title: 'Novel methodology for under-researched area',
      description: `Apply innovative methodological approaches to address gaps in ${topicGaps[0].evidence.keywords.slice(0, 2).join(' and ')}.`,
      rationale: `Combines methodological innovation with topic exploration for maximum impact.`,
      feasibility: 'low',
      novelty: 'high',
      basedOnGaps: [methodGaps[0].id, topicGaps[0].id],
      suggestedMethodology: 'Novel methodology development with application study',
      potentialImpact: 'Addresses multiple gaps simultaneously for significant field advancement.'
    });
  }

  // Combine temporal and theoretical gaps
  const temporalGaps = gaps.filter(g => g.type === 'temporal-gap');
  const theoryGaps = gaps.filter(g => g.type === 'theoretical-gap');

  if (temporalGaps.length > 0 && theoryGaps.length > 0) {
    directions.push({
      id: uuidv4(),
      title: 'Updated theoretical framework',
      description: 'Develop contemporary theoretical understanding by revisiting and updating existing frameworks.',
      rationale: 'Bridges temporal gaps while strengthening theoretical foundations.',
      feasibility: 'medium',
      novelty: 'high',
      basedOnGaps: [temporalGaps[0].id, theoryGaps[0].id],
      suggestedMethodology: 'Theory revision through systematic review and empirical validation',
      potentialImpact: 'Modernizes field understanding with solid theoretical backing.'
    });
  }

  return directions;
}

function extractMethodologies(papers: Paper[]): Record<string, number> {
  const methodologies: Record<string, number> = {};

  const methodTerms: Record<string, string[]> = {
    'survey/review': ['survey', 'review', 'meta-analysis', 'systematic review'],
    'experiment': ['experiment', 'trial', 'controlled study', 'rct'],
    'case study': ['case study', 'case analysis'],
    'qualitative': ['interview', 'ethnograph', 'qualitative', 'grounded theory'],
    'quantitative': ['regression', 'correlation', 'statistical', 'quantitative'],
    'simulation': ['simulation', 'monte carlo', 'agent-based'],
    'machine learning': ['machine learning', 'deep learning', 'neural network', 'classification'],
    'mixed methods': ['mixed method', 'multi-method', 'triangulation']
  };

  papers.forEach(paper => {
    const title = paper.title.toLowerCase();
    Object.entries(methodTerms).forEach(([method, terms]) => {
      if (terms.some(term => title.includes(term))) {
        methodologies[method] = (methodologies[method] || 0) + 1;
      }
    });
  });

  return methodologies;
}

function findUnderusedMethodologies(
  methodologies: Record<string, number>
): string[] {
  const allMethods = [
    'survey/review', 'experiment', 'case study', 'qualitative',
    'quantitative', 'simulation', 'machine learning', 'mixed methods'
  ];

  const threshold = 2; // Consider underused if <= 2 papers

  return allMethods.filter(method =>
    (methodologies[method] || 0) <= threshold
  );
}

function suggestInterdisciplinary(
  topic: string,
  papers: Paper[]
): ResearchDirection | null {
  // Extract disciplines from paper titles/sources
  const disciplines = new Set<string>();

  const disciplineTerms: Record<string, string[]> = {
    'computer science': ['algorithm', 'software', 'computing', 'data', 'machine learning'],
    'psychology': ['cognitive', 'behavioral', 'mental', 'psychological'],
    'economics': ['economic', 'market', 'financial', 'cost'],
    'medicine': ['clinical', 'patient', 'medical', 'health', 'treatment'],
    'engineering': ['design', 'system', 'optimization', 'engineering'],
    'social science': ['social', 'community', 'cultural', 'society']
  };

  papers.forEach(paper => {
    const title = paper.title.toLowerCase();
    Object.entries(disciplineTerms).forEach(([discipline, terms]) => {
      if (terms.some(term => title.includes(term))) {
        disciplines.add(discipline);
      }
    });
  });

  const allDisciplines = Object.keys(disciplineTerms);
  const missingDisciplines = allDisciplines.filter(d => !disciplines.has(d));

  if (missingDisciplines.length > 0) {
    const suggested = missingDisciplines[0];
    return {
      id: uuidv4(),
      title: `Interdisciplinary approach: ${topic} meets ${suggested}`,
      description: `Explore ${topic} through the lens of ${suggested}, bringing fresh perspectives and methodologies.`,
      rationale: `Current research lacks ${suggested} perspectives, creating opportunity for cross-disciplinary innovation.`,
      feasibility: 'medium',
      novelty: 'high',
      basedOnGaps: [],
      suggestedMethodology: `Cross-disciplinary study combining ${suggested} methods`,
      potentialImpact: 'Opens new research avenues and attracts diverse research community.'
    };
  }

  return null;
}

function suggestTemporalExtension(
  topic: string,
  papers: Paper[]
): ResearchDirection | null {
  const years = papers
    .map(p => parseInt(p.year))
    .filter(y => !isNaN(y))
    .sort((a, b) => b - a);

  if (years.length === 0) return null;

  const mostRecent = years[0];
  const currentYear = new Date().getFullYear();

  if (currentYear - mostRecent >= 2) {
    return {
      id: uuidv4(),
      title: `Contemporary update on ${topic}`,
      description: `Revisit ${topic} with contemporary data and perspectives. Most recent research is from ${mostRecent}.`,
      rationale: `Field may have evolved since ${mostRecent}. New technologies, methodologies, or contexts may apply.`,
      feasibility: 'high',
      novelty: 'medium',
      basedOnGaps: [],
      suggestedMethodology: 'Updated empirical study with contemporary context',
      potentialImpact: 'Ensures research remains relevant and actionable.'
    };
  }

  return null;
}
