import type { APIRoute } from 'astro';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { gapTaskManager } from '../../../lib/tasks/gap-task-manager';
import { getTaskDir, isValidTaskId } from '../../../lib/utils/file-utils';
import { logger } from '../../../lib/utils/logger';

export const GET: APIRoute = async ({ params }) => {
  const taskId = params.taskId;

  if (!taskId) {
    return new Response(
      JSON.stringify({ error: 'Task ID required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!isValidTaskId(taskId)) {
    return new Response(
      JSON.stringify({ error: 'Invalid task ID format' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const task = gapTaskManager.getTask(taskId);

  if (!task) {
    return new Response(
      JSON.stringify({ error: 'Task not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (task.status !== 'complete') {
    return new Response(
      JSON.stringify({ error: 'Analysis not yet complete', status: task.status }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const taskDir = getTaskDir(taskId);
    const resultPath = join(taskDir, 'gap-analysis-result.json');
    const content = await readFile(resultPath, 'utf-8');
    const result = JSON.parse(content);

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    logger.error('Failed to read gap results', { taskId, error: String(error) });
    return new Response(
      JSON.stringify({ error: 'Failed to read results' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
