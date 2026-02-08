import type { APIRoute } from 'astro';
import { z } from 'zod';
import { gapTaskManager } from '../../lib/tasks/gap-task-manager';
import { processGapAnalysis } from '../../lib/tasks/gap-analysis-processor';
import type { AnalysisType, AnalysisDepth } from '../../lib/types/gap-analysis';
import { checkRateLimit, releaseTask } from '../../lib/utils/rate-limiter';
import { logger } from '../../lib/utils/logger';

const gapAnalysisSchema = z.object({
  topic: z.string().min(1, 'Topic is required'),
  analysisTypes: z.array(z.enum(['gaps', 'comparisons', 'directions', 'all'])).default(['all']),
  papers: z.coerce.number().min(5).max(100).default(30),
  yearFilter: z.string().optional(),
  depth: z.enum(['quick', 'deep']).default('quick')
});

export const POST: APIRoute = async ({ request }) => {
  try {
    // Rate limiting
    const rateLimitResponse = checkRateLimit(request);
    if (rateLimitResponse) return rateLimitResponse;

    // Concurrent task limit
    if (gapTaskManager.activeTaskCount >= 5) {
      releaseTask(request);
      return new Response(
        JSON.stringify({ error: 'Server is busy. Please try again later.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const body = await request.json();
    const parsed = gapAnalysisSchema.safeParse(body);

    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request', details: parsed.error.issues }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { topic, analysisTypes, papers, yearFilter, depth } = parsed.data;

    // Create gap analysis task
    const taskId = gapTaskManager.createGapTask(
      topic,
      papers,
      analysisTypes as AnalysisType[],
      depth as AnalysisDepth
    );

    // Start processing in background (don't await)
    processGapAnalysis(taskId, {
      topic,
      analysisTypes: analysisTypes as AnalysisType[],
      papers,
      yearFilter,
      depth: depth as AnalysisDepth
    }).catch(err => {
      logger.error('Gap analysis error', { taskId, error: String(err) });
      gapTaskManager.failGapTask(taskId, 'Analysis failed');
    }).finally(() => releaseTask(request));

    return new Response(
      JSON.stringify({ taskId }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    logger.error('Gap analysis endpoint error', { error: String(error) });
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
