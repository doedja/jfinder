import type { RequestHandler } from './$types';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { gapTaskManager } from '$lib/tasks/gap-task-manager';
import { taskManager } from '$lib/tasks/task-manager';
import { getTaskDir } from '$lib/utils/file-utils';
import { processGapPapersDownload } from '$lib/tasks/task-processor';
import { checkRateLimit, releaseTask } from '$lib/utils/rate-limiter';
import { validateAndGetTask, jsonError } from '$lib/utils/task-helpers';
import { logger } from '$lib/utils/logger';

export const POST: RequestHandler = async ({ params, request }) => {
  const { taskId } = params;

  const result = validateAndGetTask(taskId, (id) => gapTaskManager.getTask(id), { requireComplete: true });
  if (result instanceof Response) return result;

  // Rate limiting
  const rateLimitResponse = checkRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  // Concurrent task limit
  if (taskManager.activeTaskCount >= 5) {
    releaseTask(request);
    return jsonError('Server is busy. Please try again later.', 429);
  }

  // Read papers from gap analysis result
  try {
    const taskDir = getTaskDir(taskId!);
    const resultPath = join(taskDir, 'gap-analysis-result.json');
    const content = await readFile(resultPath, 'utf-8');
    const data = JSON.parse(content);
    const papers = data.papers || [];

    if (papers.length === 0) {
      return jsonError('No papers found in gap analysis results', 400);
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
    return jsonError('Failed to read gap analysis results', 500);
  }
};
