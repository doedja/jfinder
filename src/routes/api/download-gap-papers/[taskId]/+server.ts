import type { RequestHandler } from './$types';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { gapTaskManager } from '$lib/tasks/gap-task-manager';
import { taskManager } from '$lib/tasks/task-manager';
import { getTaskDir, isValidTaskId } from '$lib/utils/file-utils';
import { processGapPapersDownload } from '$lib/tasks/task-processor';
import { checkRateLimit, releaseTask } from '$lib/utils/rate-limiter';
import { logger } from '$lib/utils/logger';

export const POST: RequestHandler = async ({ params, request }) => {
  const { taskId } = params;

  if (!taskId || !isValidTaskId(taskId)) {
    return new Response(
      JSON.stringify({ error: 'Invalid task ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Rate limiting
  const rateLimitResponse = checkRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  // Concurrent task limit
  if (taskManager.activeTaskCount >= 5) {
    releaseTask(request);
    return new Response(
      JSON.stringify({ error: 'Server is busy. Please try again later.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Verify gap analysis task exists and is complete
  const gapTask = gapTaskManager.getTask(taskId);
  if (!gapTask) {
    return new Response(
      JSON.stringify({ error: 'Gap analysis task not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (gapTask.status !== 'complete') {
    return new Response(
      JSON.stringify({ error: 'Gap analysis not yet complete' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Read papers from gap analysis result
  try {
    const taskDir = getTaskDir(taskId);
    const resultPath = join(taskDir, 'gap-analysis-result.json');
    const content = await readFile(resultPath, 'utf-8');
    const result = JSON.parse(content);
    const papers = result.papers || [];

    if (papers.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No papers found in gap analysis results' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create a new download task for these papers
    const downloadTaskId = taskManager.createTask(papers.length, 1);

    // Start download in background
    processGapPapersDownload({
      taskId: downloadTaskId,
      papers
    }).catch(err => {
      logger.error('Gap papers download error', { taskId: downloadTaskId, error: String(err) });
      taskManager.failTask(downloadTaskId, 'Download failed');
    }).finally(() => releaseTask(request));

    return new Response(
      JSON.stringify({ taskId: downloadTaskId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    logger.error('Failed to read gap analysis results', { taskId, error: String(error) });
    return new Response(
      JSON.stringify({ error: 'Failed to read gap analysis results' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
