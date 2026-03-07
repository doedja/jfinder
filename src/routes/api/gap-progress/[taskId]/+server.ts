import type { RequestHandler } from './$types';
import { gapTaskManager } from '$lib/tasks/gap-task-manager';
import { createProgressStream } from '$lib/utils/sse-progress';

export const GET: RequestHandler = async ({ params, request }) => {
  return createProgressStream(
    params.taskId,
    (id) => gapTaskManager.getTask(id),
    request.signal
  );
};
