import { isValidTaskId } from './file-utils';
import type { BaseTask } from '../tasks/base-task-manager';

export function jsonError(message: string, status: number): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status, headers: { 'Content-Type': 'application/json' } }
  );
}

/**
 * Validate task ID and retrieve the task from a manager.
 * Returns the task on success, or an error Response on failure.
 */
export function validateAndGetTask<T extends BaseTask>(
  taskId: string | undefined,
  getTask: (id: string) => T | undefined,
  opts?: { requireComplete?: boolean }
): T | Response {
  if (!taskId || !isValidTaskId(taskId)) {
    return jsonError('Invalid task ID', 400);
  }

  const task = getTask(taskId);
  if (!task) {
    return jsonError('Task not found', 404);
  }

  if (opts?.requireComplete && task.status !== 'complete') {
    return jsonError('Task not complete', 400);
  }

  return task;
}
