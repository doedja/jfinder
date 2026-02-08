import type { RequestHandler } from './$types';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { taskManager } from '$lib/tasks/task-manager';
import { getTaskDir, isValidTaskId } from '$lib/utils/file-utils';

export const GET: RequestHandler = async ({ params }) => {
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

  // Check if task exists
  const task = taskManager.getTask(taskId);

  if (!task) {
    return new Response(
      JSON.stringify({ error: 'Task not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (task.status !== 'complete') {
    return new Response(
      JSON.stringify({ error: 'Task not complete' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const taskDir = getTaskDir(taskId);
  const filePath = join(taskDir, 'details.txt');

  try {
    await stat(filePath);
    const content = await readFile(filePath, 'utf-8');

    return new Response(content, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8'
      }
    });
  } catch {
    return new Response(
      JSON.stringify({ error: 'Metadata not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
