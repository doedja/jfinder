import type { RequestHandler } from './$types';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { taskManager } from '$lib/tasks/task-manager';
import { getTaskDir } from '$lib/utils/file-utils';
import { validateAndGetTask } from '$lib/utils/task-helpers';

export const GET: RequestHandler = async ({ params }) => {
  const result = validateAndGetTask(params.taskId, (id) => taskManager.getTask(id), { requireComplete: true });
  if (result instanceof Response) return result;

  const papersDir = join(getTaskDir(params.taskId!), 'papers');

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
