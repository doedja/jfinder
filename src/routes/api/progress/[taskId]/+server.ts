import type { RequestHandler } from './$types';
import { taskManager } from '$lib/tasks/task-manager';
import { createProgressStream } from '$lib/utils/sse-progress';

export const GET: RequestHandler = async ({ params, request }) => {
  return createProgressStream(
    params.taskId,
    (id) => taskManager.getTask(id),
    request.signal
  );
};
