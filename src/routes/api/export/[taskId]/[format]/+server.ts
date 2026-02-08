import type { RequestHandler } from './$types';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { taskManager } from '$lib/tasks/task-manager';
import { gapTaskManager } from '$lib/tasks/gap-task-manager';
import { getTaskDir, isValidTaskId } from '$lib/utils/file-utils';
import { papersToBibtex, papersToRis } from '$lib/utils/citation-export';
import type { Paper } from '$lib/types';

export const GET: RequestHandler = async ({ params }) => {
  const { taskId, format } = params;

  if (!taskId || !format) {
    return new Response(
      JSON.stringify({ error: 'Task ID and format required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (!isValidTaskId(taskId)) {
    return new Response(
      JSON.stringify({ error: 'Invalid task ID format' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (format !== 'bibtex' && format !== 'ris') {
    return new Response(
      JSON.stringify({ error: 'Invalid format. Use "bibtex" or "ris"' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Try to find papers from gap analysis results first, then regular task
  let papers: Paper[] = [];

  const gapTask = gapTaskManager.getTask(taskId);
  if (gapTask && gapTask.status === 'complete') {
    try {
      const taskDir = getTaskDir(taskId);
      const resultPath = join(taskDir, 'gap-analysis-result.json');
      const content = await readFile(resultPath, 'utf-8');
      const result = JSON.parse(content);
      papers = result.papers || [];
    } catch {
      // Fall through
    }
  }

  if (papers.length === 0) {
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
    // For regular tasks, we don't have papers in JSON, so parse from details.txt metadata
    return new Response(
      JSON.stringify({ error: 'Citation export is available for gap analysis tasks' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  if (format === 'bibtex') {
    const content = papersToBibtex(papers);
    return new Response(content, {
      headers: {
        'Content-Type': 'application/x-bibtex',
        'Content-Disposition': `attachment; filename="jfinder-${taskId}.bib"`
      }
    });
  }

  const content = papersToRis(papers);
  return new Response(content, {
    headers: {
      'Content-Type': 'application/x-research-info-systems',
      'Content-Disposition': `attachment; filename="jfinder-${taskId}.ris"`
    }
  });
};
