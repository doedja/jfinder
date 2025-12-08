import { writeFile } from 'fs/promises';
import { join } from 'path';
import type { Paper } from '../types';
import type {
  GapAnalysisRequest,
  GapAnalysisResult,
  GapTaskStatus,
  ResearchGap,
  PaperComparison,
  ResearchDirection,
  TrendAnalysis,
  PaperCluster,
  AnalysisMetadata
} from '../types/gap-analysis';
import { gapTaskManager } from './gap-task-manager';
import { searchPapers, searchProvider } from '../services/paper-search.service';
import {
  generateSearchQueries,
  analyzeGaps as llmAnalyzeGaps,
  compareMethodologies as llmCompareMethodologies,
  suggestDirections as llmSuggestDirections,
  generateGapSummary
} from '../services/openrouter.service';
import {
  findUnderResearchedAreas,
  analyzeTrends,
  clusterPapers,
  processLLMGapAnalysis
} from '../services/gap-analysis.service';
import {
  compareMethodologies,
  findContradictions,
  findDifferentApproaches,
  processLLMComparison
} from '../services/comparison.service';
import {
  generateDirections,
  suggestNovelAngles,
  processLLMDirections,
  rankDirections
} from '../services/recommendation.service';
import { ensureDir, getTaskDir } from '../utils/file-utils';

/**
 * Process a gap analysis request
 */
export async function processGapAnalysis(
  taskId: string,
  request: GapAnalysisRequest
): Promise<void> {
  const { topic, analysisTypes, papers: targetPapers, yearFilter, depth } = request;
  const startTime = Date.now();

  try {
    const taskDir = getTaskDir(taskId);
    await ensureDir(taskDir);

    // Track search queries for metadata
    const searchQueries: string[] = [];

    // PHASE 1: Search (0-30%)
    gapTaskManager.updateGapProgress(taskId, 'searching', 'Generating search queries...', 0, 0, 0, 0);

    const queries = await generateSearchQueries(topic, 3);
    searchQueries.push(...queries);

    const allPapers: Paper[] = [];
    const seenDois = new Set<string>();

    for (let i = 0; i < queries.length; i++) {
      if (allPapers.length >= targetPapers) break;

      const progress = Math.round(5 + (i / queries.length) * 25);
      gapTaskManager.updateGapProgress(
        taskId,
        'searching',
        `Searching ${searchProvider} (${i + 1}/${queries.length})...`,
        progress,
        allPapers.length,
        0, 0
      );

      const results = await searchPapers({
        query: queries[i],
        startYear: yearFilter ? parseInt(yearFilter.split('-')[0]) : undefined,
        endYear: yearFilter ? parseInt(yearFilter.split('-')[1]) : undefined
      });

      for (const paper of results) {
        if (!seenDois.has(paper.doi) && allPapers.length < targetPapers) {
          seenDois.add(paper.doi);
          allPapers.push(paper);
        }
      }

      // Small delay between searches
      if (i < queries.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (allPapers.length === 0) {
      gapTaskManager.failGapTask(taskId, 'No papers found for this topic');
      return;
    }

    console.log(`Found ${allPapers.length} papers for gap analysis`);

    // PHASE 2: Collection (30-50%)
    gapTaskManager.updateGapProgress(
      taskId,
      'collecting',
      'Preparing papers for analysis...',
      30,
      allPapers.length,
      0, 0
    );

    // For now we use metadata only (quick mode)
    // Deep mode would download PDFs here

    // PHASE 3: Gap Analysis (50-70%)
    let gaps: ResearchGap[] = [];

    if (analysisTypes.includes('gaps') || analysisTypes.includes('all')) {
      gapTaskManager.updateGapProgress(
        taskId,
        'analyzing',
        'Analyzing research gaps...',
        50,
        allPapers.length,
        0, 0
      );

      // Algorithm-based gap detection
      const algorithmGaps = await findUnderResearchedAreas(allPapers, topic);
      gaps.push(...algorithmGaps);

      // LLM-enhanced gap detection
      gapTaskManager.updateGapProgress(
        taskId,
        'analyzing',
        'Running AI gap analysis...',
        60,
        allPapers.length,
        gaps.length, 0
      );

      const llmGaps = await llmAnalyzeGaps(allPapers, topic);
      if (llmGaps) {
        const processedLLMGaps = processLLMGapAnalysis(llmGaps, allPapers);
        gaps.push(...processedLLMGaps);
      }

      // Deduplicate by title similarity
      gaps = deduplicateGaps(gaps);

      console.log(`Identified ${gaps.length} research gaps`);
    }

    // PHASE 4: Comparison (70-85%)
    let comparisons: PaperComparison[] = [];

    if (analysisTypes.includes('comparisons') || analysisTypes.includes('all')) {
      gapTaskManager.updateGapProgress(
        taskId,
        'comparing',
        'Comparing methodologies...',
        70,
        allPapers.length,
        gaps.length, 0
      );

      // Algorithm-based comparison
      const methodComparisons = compareMethodologies(allPapers);
      const approachComparisons = findDifferentApproaches(allPapers);
      comparisons.push(...methodComparisons, ...approachComparisons);

      // Find contradictions
      const contradictions = findContradictions(allPapers);
      if (contradictions.length > 0) {
        comparisons[0] = {
          ...comparisons[0],
          contradictions
        };
      }

      // LLM-enhanced comparison
      gapTaskManager.updateGapProgress(
        taskId,
        'comparing',
        'Running AI methodology comparison...',
        78,
        allPapers.length,
        gaps.length,
        comparisons.length
      );

      const llmComparison = await llmCompareMethodologies(allPapers, topic);
      if (llmComparison) {
        const processedComparison = processLLMComparison(llmComparison, allPapers);
        comparisons.push(processedComparison);
      }

      console.log(`Created ${comparisons.length} comparisons`);
    }

    // PHASE 5: Direction Generation (85-95%)
    let directions: ResearchDirection[] = [];

    if (analysisTypes.includes('directions') || analysisTypes.includes('all')) {
      gapTaskManager.updateGapProgress(
        taskId,
        'generating',
        'Generating research directions...',
        85,
        allPapers.length,
        gaps.length,
        comparisons.length
      );

      // Algorithm-based directions
      if (gaps.length > 0) {
        const gapDirections = generateDirections(gaps, allPapers);
        directions.push(...gapDirections);
      }

      const novelAngles = suggestNovelAngles(topic, allPapers);
      directions.push(...novelAngles);

      // LLM-enhanced suggestions
      gapTaskManager.updateGapProgress(
        taskId,
        'generating',
        'Running AI direction suggestions...',
        90,
        allPapers.length,
        gaps.length,
        comparisons.length
      );

      const llmDirections = await llmSuggestDirections(
        allPapers,
        gaps.map(g => ({ title: g.title, description: g.description })),
        topic
      );
      if (llmDirections) {
        const processedDirections = processLLMDirections(llmDirections, gaps);
        directions.push(...processedDirections);
      }

      // Rank and deduplicate
      directions = rankDirections(deduplicateDirections(directions));
      directions = directions.slice(0, 10); // Top 10

      console.log(`Generated ${directions.length} research directions`);
    }

    // PHASE 6: Finalize (95-100%)
    gapTaskManager.updateGapProgress(
      taskId,
      'generating',
      'Compiling results...',
      95,
      allPapers.length,
      gaps.length,
      directions.length
    );

    // Analyze trends
    const trends: TrendAnalysis = analyzeTrends(allPapers);

    // Cluster papers
    const clusters: PaperCluster[] = clusterPapers(allPapers);

    // Create metadata
    const processingTime = Date.now() - startTime;
    const metadata: AnalysisMetadata = {
      analysisDate: new Date(),
      analysisTypes,
      paperCount: allPapers.length,
      yearRange: getYearRange(allPapers),
      depth,
      searchQueries,
      processingTime
    };

    // Build final result
    const result: GapAnalysisResult = {
      taskId,
      topic,
      papers: allPapers,
      gaps,
      comparisons,
      directions,
      trends,
      clusters,
      metadata
    };

    // Save result JSON
    const resultPath = join(taskDir, 'gap-analysis-result.json');
    await writeFile(resultPath, JSON.stringify(result, null, 2), 'utf-8');

    // Generate summary report
    const summary = await generateSummaryReport(result, taskDir);

    // Complete task
    gapTaskManager.completeGapTask(
      taskId,
      `/api/gap-results/${taskId}`,
      summary ? `/api/gap-report/${taskId}` : undefined
    );

    console.log(`Gap analysis ${taskId} completed in ${processingTime}ms`);
  } catch (error) {
    console.error('Gap analysis error:', error);
    gapTaskManager.failGapTask(taskId, `Analysis failed: ${error}`);
  }
}

/**
 * Generate a markdown summary report
 */
async function generateSummaryReport(
  result: GapAnalysisResult,
  taskDir: string
): Promise<boolean> {
  try {
    const topGaps = result.gaps.slice(0, 5).map(g => g.title);
    const topDirections = result.directions.slice(0, 5).map(d => d.title);

    // Get AI-generated summary
    const aiSummary = await generateGapSummary(
      result.topic,
      result.papers.length,
      result.gaps.length,
      topGaps,
      topDirections
    );

    // Build markdown report
    let report = `# Research Gap Analysis Report

## Topic: ${result.topic}

**Generated:** ${result.metadata.analysisDate.toISOString().split('T')[0]}
**Papers Analyzed:** ${result.metadata.paperCount}
**Gaps Identified:** ${result.gaps.length}
**Research Directions:** ${result.directions.length}
**Analysis Depth:** ${result.metadata.depth}
**Processing Time:** ${(result.metadata.processingTime / 1000).toFixed(1)}s

---

## Executive Summary

${aiSummary || 'Summary generation unavailable.'}

---

## Research Gaps

`;

    // Add gaps
    result.gaps.forEach((gap, i) => {
      report += `### ${i + 1}. ${gap.title}

**Type:** ${gap.type} | **Severity:** ${gap.severity}

${gap.description}

${gap.suggestedApproach ? `**Suggested Approach:** ${gap.suggestedApproach}` : ''}

---

`;
    });

    // Add comparisons
    if (result.comparisons.length > 0) {
      report += `## Methodology Comparisons

`;
      result.comparisons.forEach((comp, i) => {
        report += `### Comparison ${i + 1}: ${comp.dimension}

**Papers:** ${comp.papers.length} papers compared

`;
        comp.findings.forEach(f => {
          report += `**${f.aspect}**
- Differences: ${f.differences.join(', ')}
- Similarities: ${f.similarities.join(', ')}

`;
        });

        if (comp.contradictions && comp.contradictions.length > 0) {
          report += `**Contradictions Found:**
${comp.contradictions.map(c => `- ${c}`).join('\n')}

`;
        }
      });
    }

    // Add research directions
    if (result.directions.length > 0) {
      report += `## Recommended Research Directions

`;
      result.directions.forEach((dir, i) => {
        report += `### ${i + 1}. ${dir.title}

**Feasibility:** ${dir.feasibility} | **Novelty:** ${dir.novelty}

${dir.description}

**Rationale:** ${dir.rationale}

${dir.suggestedMethodology ? `**Suggested Methodology:** ${dir.suggestedMethodology}` : ''}

---

`;
      });
    }

    // Add trends
    if (result.trends) {
      report += `## Publication Trends

**Peak Years:** ${result.trends.peakYears.join(', ') || 'N/A'}
**Declining Trends:** ${result.trends.decliningTrends.join(', ') || 'None detected'}
**Emerging Topics:** ${result.trends.emergingTopics.slice(0, 5).join(', ') || 'N/A'}

`;
    }

    // Save report
    const reportPath = join(taskDir, 'gap-analysis-report.md');
    await writeFile(reportPath, report, 'utf-8');

    return true;
  } catch (error) {
    console.error('Failed to generate summary report:', error);
    return false;
  }
}

// --- Helper Functions ---

function getYearRange(papers: Paper[]): string {
  const years = papers
    .map(p => parseInt(p.year))
    .filter(y => !isNaN(y))
    .sort((a, b) => a - b);

  if (years.length === 0) return 'Unknown';
  if (years.length === 1) return years[0].toString();
  return `${years[0]}-${years[years.length - 1]}`;
}

function deduplicateGaps(gaps: ResearchGap[]): ResearchGap[] {
  const seen = new Set<string>();
  return gaps.filter(gap => {
    const key = gap.title.toLowerCase().substring(0, 30);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicateDirections(directions: ResearchDirection[]): ResearchDirection[] {
  const seen = new Set<string>();
  return directions.filter(dir => {
    const key = dir.title.toLowerCase().substring(0, 30);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
