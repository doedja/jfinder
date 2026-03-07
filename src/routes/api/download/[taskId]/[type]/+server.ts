import type { RequestHandler } from './$types';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { taskManager } from '$lib/tasks/task-manager';
import { getTaskDir } from '$lib/utils/file-utils';
import { validateAndGetTask, jsonError } from '$lib/utils/task-helpers';
import { logger } from '$lib/utils/logger';

export const GET: RequestHandler = async ({ params }) => {
  const { taskId, type } = params;

  if (type !== 'zip' && type !== 'metadata') {
    return jsonError('Invalid type. Use "zip" or "metadata"', 400);
  }

  const result = validateAndGetTask(taskId, (id) => taskManager.getTask(id), { requireComplete: true });
  if (result instanceof Response) return result;

  const taskDir = getTaskDir(taskId!);

  try {
    if (type === 'metadata') {
      const filePath = join(taskDir, 'details.txt');

      try {
        await stat(filePath);
      } catch {
        return jsonError('Metadata file not found', 404);
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
        return jsonError('ZIP file not found', 404);
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

    return jsonError('Invalid type', 400);
  } catch (error) {
    logger.error('Download error', { taskId, type, error: String(error) });
    return jsonError('Failed to read file', 500);
  }
};
