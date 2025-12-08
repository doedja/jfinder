import type { APIRoute } from 'astro';
import { taskManager } from '../../../lib/tasks/task-manager';

export const GET: APIRoute = async ({ params }) => {
  const taskId = params.taskId;

  if (!taskId) {
    return new Response(
      JSON.stringify({ error: 'Task ID required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const task = taskManager.getTask(taskId);

  if (!task) {
    return new Response(
      JSON.stringify({ error: 'Task not found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const sendEvent = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Send initial status
      sendEvent(task);

      // If already complete or error, close immediately
      if (task.status === 'complete' || task.status === 'error') {
        controller.close();
        return;
      }

      // Poll for updates
      const interval = setInterval(() => {
        const currentTask = taskManager.getTask(taskId);

        if (!currentTask) {
          sendEvent({ error: 'Task not found' });
          clearInterval(interval);
          controller.close();
          return;
        }

        sendEvent(currentTask);

        if (currentTask.status === 'complete' || currentTask.status === 'error') {
          clearInterval(interval);
          controller.close();
        }
      }, 1000);

      // Cleanup on close
      return () => {
        clearInterval(interval);
      };
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
};
