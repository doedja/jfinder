import type { APIRoute } from 'astro';
import { readFile, stat } from 'fs/promises';
import { join, resolve } from 'path';
import { taskManager } from '../../../../lib/tasks/task-manager';
import { getTaskDir, isValidTaskId } from '../../../../lib/utils/file-utils';

export const GET: APIRoute = async ({ params }) => {
  const { taskId, filename } = params;

  if (!taskId || !isValidTaskId(taskId) || !filename) {
    return new Response(
      JSON.stringify({ error: 'Invalid parameters' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Validate filename: only allow alphanumeric, underscores, hyphens, spaces, and .pdf extension
  if (!/^[\w\s\-]+\.pdf$/i.test(filename)) {
    return new Response(
      JSON.stringify({ error: 'Invalid filename' }),
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
  const filePath = resolve(join(papersDir, filename));

  // Path traversal protection
  if (!filePath.startsWith(resolve(papersDir))) {
    return new Response(
      JSON.stringify({ error: 'Invalid path' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
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
    return new Response(
      JSON.stringify({ error: 'File not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
