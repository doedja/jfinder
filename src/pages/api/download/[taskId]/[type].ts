import type { APIRoute } from 'astro';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { taskManager } from '../../../../lib/tasks/task-manager';
import { getTaskDir } from '../../../../lib/utils/file-utils';

export const GET: APIRoute = async ({ params }) => {
  const { taskId, type } = params;

  if (!taskId || !type) {
    return new Response(
      JSON.stringify({ error: 'Task ID and type required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Validate type
  if (type !== 'zip' && type !== 'metadata') {
    return new Response(
      JSON.stringify({ error: 'Invalid type. Use "zip" or "metadata"' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Check if task exists and is complete
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

  try {
    if (type === 'metadata') {
      const filePath = join(taskDir, 'details.txt');

      try {
        await stat(filePath);
      } catch {
        return new Response(
          JSON.stringify({ error: 'Metadata file not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const content = await readFile(filePath, 'utf-8');

      return new Response(content, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="jfinder_results.txt"`
        }
      });
    }

    if (type === 'zip') {
      const filePath = join(taskDir, `${taskId}.zip`);

      try {
        await stat(filePath);
      } catch {
        return new Response(
          JSON.stringify({ error: 'ZIP file not found' }),
          { status: 404, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const content = await readFile(filePath);

      return new Response(content, {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="jfinder_${taskId}.zip"`,
          'Content-Length': content.length.toString()
        }
      });
    }

    return new Response(
      JSON.stringify({ error: 'Invalid type' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Download error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to read file' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
