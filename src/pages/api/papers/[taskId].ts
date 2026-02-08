import type { APIRoute } from 'astro';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { taskManager } from '../../../lib/tasks/task-manager';
import { getTaskDir, isValidTaskId } from '../../../lib/utils/file-utils';

export const GET: APIRoute = async ({ params }) => {
  const taskId = params.taskId;

  if (!taskId || !isValidTaskId(taskId)) {
    return new Response(
      JSON.stringify({ error: 'Invalid task ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const task = taskManager.getTask(taskId);
  if (!task || task.status !== 'complete') {
    return new Response(
      JSON.stringify({ error: 'Task not found or not complete' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const papersDir = join(getTaskDir(taskId), 'papers');

  try {
    const entries = await readdir(papersDir);
    const pdfs = entries
      .filter(f => f.endsWith('.pdf'))
      .map(f => ({
        filename: f,
        name: f.replace(/\.pdf$/, '').replace(/_/g, ' ')
      }));

    return new Response(JSON.stringify(pdfs), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
