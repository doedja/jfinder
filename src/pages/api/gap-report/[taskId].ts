import type { APIRoute } from 'astro';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { gapTaskManager } from '../../../lib/tasks/gap-task-manager';
import { getTaskDir } from '../../../lib/utils/file-utils';

export const GET: APIRoute = async ({ params, url }) => {
  const taskId = params.taskId;
  const format = url.searchParams.get('format') || 'md';

  if (!taskId) {
    return new Response(
      JSON.stringify({ error: 'Task ID required' }),
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
    const reportPath = join(taskDir, 'gap-analysis-report.md');

    // Check if report exists
    try {
      await stat(reportPath);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Report not available' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const content = await readFile(reportPath, 'utf-8');

    if (format === 'md') {
      return new Response(content, {
        status: 200,
        headers: {
          'Content-Type': 'text/markdown',
          'Content-Disposition': `attachment; filename="gap-analysis-${taskId}.md"`
        }
      });
    }

    // Return as JSON with content
    return new Response(
      JSON.stringify({ content }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  } catch (error) {
    console.error('Failed to read gap report:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to read report' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
