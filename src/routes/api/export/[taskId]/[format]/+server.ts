import type { RequestHandler } from './$types';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { taskManager } from '$lib/tasks/task-manager';
import { gapTaskManager } from '$lib/tasks/gap-task-manager';
import { getTaskDir, isValidTaskId } from '$lib/utils/file-utils';
import { papersToBibtex, papersToRis } from '$lib/utils/citation-export';
import { jsonError } from '$lib/utils/task-helpers';
import type { Paper } from '$lib/types';

export const GET: RequestHandler = async ({ params }) => {
  const { taskId, format } = params;

  if (!taskId || !format || !isValidTaskId(taskId)) {
    return jsonError('Task ID and format required', 400);
  }

  if (format !== 'bibtex' && format !== 'ris') {
    return jsonError('Invalid format. Use "bibtex" or "ris"', 400);
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
      return jsonError('Task not found', 404);
    }
    if (task.status !== 'complete') {
      return jsonError('Task not complete', 400);
    }
    return jsonError('Citation export is available for gap analysis tasks', 400);
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
