import type { Paper } from '../types/paper';
import type {
  PaperComparison,
  ComparisonFinding,
  LLMComparisonAnalysis
} from '../types/gap-analysis';
import { v4 as uuidv4 } from 'uuid';

/**
 * Compare methodologies across papers
 */
export function compareMethodologies(papers: Paper[]): PaperComparison[] {
  const comparisons: PaperComparison[] = [];

  // Group papers by detected methodology type
  const methodGroups = groupByMethodology(papers);

  // Create comparisons between different methodology groups
  const groupNames = Object.keys(methodGroups);

  for (let i = 0; i < groupNames.length - 1; i++) {
    for (let j = i + 1; j < groupNames.length; j++) {
      const group1 = groupNames[i];
      const group2 = groupNames[j];

      if (methodGroups[group1].length > 0 && methodGroups[group2].length > 0) {
        comparisons.push({
          id: uuidv4(),
          papers: [
            ...methodGroups[group1].slice(0, 2).map(p => p.doi),
            ...methodGroups[group2].slice(0, 2).map(p => p.doi)
          ],
          dimension: 'methodology',
          findings: [{
            aspect: 'Methodology Approach',
            differences: [
              `${group1}: ${methodGroups[group1].length} papers`,
              `${group2}: ${methodGroups[group2].length} papers`
            ],
            similarities: ['Both address similar research questions']
          }]
        });
      }
    }
  }

  return comparisons;
}

/**
 * Find contradictions in research findings
 * Note: Full implementation would require full-text analysis
 */
export function findContradictions(papers: Paper[]): string[] {
  // This is a placeholder - real implementation would analyze abstracts/full text
  // For now, identify potential contradictions based on title patterns

  const contradictions: string[] = [];

  // Look for papers with opposing terms in titles
  const opposingTerms = [
    ['increase', 'decrease'],
    ['positive', 'negative'],
    ['improve', 'worsen'],
    ['effective', 'ineffective'],
    ['success', 'failure'],
    ['benefit', 'harm'],
    ['support', 'contradict'],
    ['confirm', 'refute']
  ];

  papers.forEach((paper1, i) => {
    papers.slice(i + 1).forEach(paper2 => {
      const title1 = paper1.title.toLowerCase();
      const title2 = paper2.title.toLowerCase();

      for (const [term1, term2] of opposingTerms) {
        if ((title1.includes(term1) && title2.includes(term2)) ||
            (title1.includes(term2) && title2.includes(term1))) {
          contradictions.push(
            `Potential contradiction: "${paper1.title.substring(0, 50)}..." vs "${paper2.title.substring(0, 50)}..."`
          );
          break;
        }
      }
    });
  });

  return contradictions.slice(0, 5); // Limit to top 5
}

/**
 * Cluster papers by approach (qualitative, quantitative, mixed)
 */
export function groupByApproach(papers: Paper[]): Record<string, Paper[]> {
  const groups: Record<string, Paper[]> = {
    quantitative: [],
    qualitative: [],
    mixed: [],
    other: []
  };

  const quantTerms = ['statistical', 'regression', 'correlation', 'experiment', 'empirical', 'measurement', 'data', 'analysis', 'model', 'simulation'];
  const qualTerms = ['interview', 'ethnograph', 'case study', 'narrative', 'phenomenolog', 'grounded theory', 'qualitative', 'interpretive'];
  const mixedTerms = ['mixed method', 'multi-method', 'triangulation'];

  papers.forEach(paper => {
    const title = paper.title.toLowerCase();

    if (mixedTerms.some(term => title.includes(term))) {
      groups.mixed.push(paper);
    } else if (qualTerms.some(term => title.includes(term))) {
      groups.qualitative.push(paper);
    } else if (quantTerms.some(term => title.includes(term))) {
      groups.quantitative.push(paper);
    } else {
      groups.other.push(paper);
    }
  });

  return groups;
}

/**
 * Find papers using different approaches for the same topic
 */
export function findDifferentApproaches(papers: Paper[]): PaperComparison[] {
  const comparisons: PaperComparison[] = [];
  const approaches = groupByApproach(papers);

  // Compare quantitative vs qualitative approaches
  if (approaches.quantitative.length > 0 && approaches.qualitative.length > 0) {
    comparisons.push({
      id: uuidv4(),
      papers: [
        ...approaches.quantitative.slice(0, 2).map(p => p.doi),
        ...approaches.qualitative.slice(0, 2).map(p => p.doi)
      ],
      dimension: 'approach',
      findings: [{
        aspect: 'Research Approach',
        differences: [
          `Quantitative approach: ${approaches.quantitative.length} papers`,
          `Qualitative approach: ${approaches.qualitative.length} papers`
        ],
        similarities: ['Same research topic addressed']
      }]
    });
  }

  return comparisons;
}

/**
 * Process LLM comparison analysis
 */
export function processLLMComparison(
  llmResult: LLMComparisonAnalysis,
  papers: Paper[]
): PaperComparison {
  return {
    id: uuidv4(),
    papers: papers.slice(0, 5).map(p => p.doi),
    dimension: 'approach',
    findings: [{
      aspect: 'Methodological Comparison',
      differences: llmResult.uniqueContributions,
      similarities: llmResult.commonApproaches
    }],
    contradictions: llmResult.contradictions
  };
}

// --- Helper Functions ---

function groupByMethodology(papers: Paper[]): Record<string, Paper[]> {
  const groups: Record<string, Paper[]> = {
    'machine-learning': [],
    'deep-learning': [],
    'statistical': [],
    'survey': [],
    'experimental': [],
    'theoretical': [],
    'other': []
  };

  const mlTerms = ['machine learning', 'classification', 'clustering', 'prediction', 'svm', 'random forest', 'decision tree'];
  const dlTerms = ['deep learning', 'neural network', 'cnn', 'rnn', 'transformer', 'lstm', 'bert', 'gpt'];
  const statTerms = ['regression', 'correlation', 'anova', 'statistical', 'hypothesis'];
  const surveyTerms = ['survey', 'review', 'meta-analysis', 'systematic review', 'literature review'];
  const expTerms = ['experiment', 'trial', 'empirical', 'controlled study'];
  const theoryTerms = ['theoretical', 'framework', 'model', 'theory', 'conceptual'];

  papers.forEach(paper => {
    const title = paper.title.toLowerCase();

    if (dlTerms.some(term => title.includes(term))) {
      groups['deep-learning'].push(paper);
    } else if (mlTerms.some(term => title.includes(term))) {
      groups['machine-learning'].push(paper);
    } else if (surveyTerms.some(term => title.includes(term))) {
      groups['survey'].push(paper);
    } else if (statTerms.some(term => title.includes(term))) {
      groups['statistical'].push(paper);
    } else if (expTerms.some(term => title.includes(term))) {
      groups['experimental'].push(paper);
    } else if (theoryTerms.some(term => title.includes(term))) {
      groups['theoretical'].push(paper);
    } else {
      groups['other'].push(paper);
    }
  });

  // Remove empty groups
  Object.keys(groups).forEach(key => {
    if (groups[key].length === 0) {
      delete groups[key];
    }
  });

  return groups;
}

/**
 * Get methodology breakdown summary
 */
export function getMethodologyBreakdown(papers: Paper[]): Record<string, number> {
  const groups = groupByMethodology(papers);
  const breakdown: Record<string, number> = {};

  Object.keys(groups).forEach(key => {
    breakdown[key] = groups[key].length;
  });

  return breakdown;
}

/**
 * Get approach breakdown summary
 */
export function getApproachBreakdown(papers: Paper[]): Record<string, number> {
  const groups = groupByApproach(papers);
  const breakdown: Record<string, number> = {};

  Object.keys(groups).forEach(key => {
    breakdown[key] = groups[key].length;
  });

  return breakdown;
}
