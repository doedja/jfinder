import type { RequestHandler } from './$types';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { taskManager } from '$lib/tasks/task-manager';
import { getTaskDir } from '$lib/utils/file-utils';
import { validateAndGetTask, jsonError } from '$lib/utils/task-helpers';

export const GET: RequestHandler = async ({ params }) => {
  const result = validateAndGetTask(params.taskId, (id) => taskManager.getTask(id), { requireComplete: true });
  if (result instanceof Response) return result;

  const filePath = join(getTaskDir(params.taskId!), 'details.txt');

  try {
    await stat(filePath);
    const content = await readFile(filePath, 'utf-8');

    return new Response(content, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  } catch {
    return jsonError('Metadata not found', 404);
  }
};
