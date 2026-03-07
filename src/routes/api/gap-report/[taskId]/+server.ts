import type { RequestHandler } from './$types';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { gapTaskManager } from '$lib/tasks/gap-task-manager';
import { getTaskDir } from '$lib/utils/file-utils';
import { validateAndGetTask, jsonError } from '$lib/utils/task-helpers';
import { logger } from '$lib/utils/logger';

export const GET: RequestHandler = async ({ params, url }) => {
  const format = url.searchParams.get('format') || 'md';

  const result = validateAndGetTask(params.taskId, (id) => gapTaskManager.getTask(id), { requireComplete: true });
  if (result instanceof Response) return result;

  try {
    const taskDir = getTaskDir(params.taskId!);
    const reportPath = join(taskDir, 'gap-analysis-report.md');

    try {
      await stat(reportPath);
    } catch {
      return jsonError('Report not available', 404);
    }

    const content = await readFile(reportPath, 'utf-8');

    if (format === 'md') {
      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="gap-analysis-${params.taskId}.md"`
        }
      });
    }

    return new Response(JSON.stringify({ content }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    logger.error('Failed to read gap report', { taskId: params.taskId, error: String(error) });
    return jsonError('Failed to read report', 500);
  }
};
