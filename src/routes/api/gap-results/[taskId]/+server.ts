import type { RequestHandler } from './$types';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { gapTaskManager } from '$lib/tasks/gap-task-manager';
import { getTaskDir } from '$lib/utils/file-utils';
import { validateAndGetTask, jsonError } from '$lib/utils/task-helpers';
import { logger } from '$lib/utils/logger';

export const GET: RequestHandler = async ({ params }) => {
  const result = validateAndGetTask(params.taskId, (id) => gapTaskManager.getTask(id), { requireComplete: true });
  if (result instanceof Response) return result;

  try {
    const taskDir = getTaskDir(params.taskId!);
    const resultPath = join(taskDir, 'gap-analysis-result.json');
    const content = await readFile(resultPath, 'utf-8');
    const data = JSON.parse(content);

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    logger.error('Failed to read gap results', { taskId: params.taskId, error: String(error) });
    return jsonError('Failed to read results', 500);
  }
};
