import type { BaseTask } from '../tasks/base-task-manager';
import { isValidTaskId } from './file-utils';

/**
 * Create an SSE progress stream for a task with proper lifecycle management.
 * Handles task validation, polling, and cleanup on client disconnect.
 */
export function createProgressStream<T extends BaseTask>(
  taskId: string | undefined,
  getTask: (id: string) => T | undefined,
  signal?: AbortSignal
): Response {
  if (!taskId || !isValidTaskId(taskId)) {
    return new Response(
      JSON.stringify({ error: 'Invalid task ID' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const task = getTask(taskId);

  if (!task) {
    return new Response(
      JSON.stringify({ error: 'Task not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let intervalId: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (data: object) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
      };

      // Send initial status
      sendEvent(task);

      // If already complete or error, close immediately
      if (task.status === 'complete' || task.status === 'error') {
        controller.close();
        return;
      }

      // Poll for updates
      intervalId = setInterval(() => {
        const currentTask = getTask(taskId);

        if (!currentTask) {
          sendEvent({ error: 'Task not found' });
          cleanup();
          controller.close();
          return;
        }

        sendEvent(currentTask);

        if (currentTask.status === 'complete' || currentTask.status === 'error') {
          cleanup();
          controller.close();
        }
      }, 1000);

      // Clean up on client disconnect
      signal?.addEventListener('abort', () => {
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    cancel() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
}
