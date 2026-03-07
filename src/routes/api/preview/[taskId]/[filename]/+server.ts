import type { RequestHandler } from './$types';
import { readFile, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { taskManager } from '$lib/tasks/task-manager';
import { getTaskDir } from '$lib/utils/file-utils';
import { validateAndGetTask, jsonError } from '$lib/utils/task-helpers';

export const GET: RequestHandler = async ({ params }) => {
  const { taskId, filename } = params;

  if (!filename) {
    return jsonError('Filename required', 400);
  }

  // Validate filename: only allow alphanumeric, underscores, hyphens, spaces, and .pdf extension
  if (!/^[\w\s\-]+\.pdf$/i.test(filename)) {
    return jsonError('Invalid filename', 400);
  }

  const result = validateAndGetTask(taskId, (id) => taskManager.getTask(id), { requireComplete: true });
  if (result instanceof Response) return result;

  const papersDir = join(getTaskDir(taskId!), 'papers');
  const filePath = resolve(join(papersDir, filename));

  // Path traversal protection
  if (!filePath.startsWith(resolve(papersDir))) {
    return jsonError('Invalid path', 400);
  }

  try {
    await stat(filePath);
    const content = await readFile(filePath);

    return new Response(content, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${filename}"`,
        'Content-Length': content.length.toString(),
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch {
    return jsonError('File not found', 404);
  }
};
