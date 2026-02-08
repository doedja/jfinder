import { v4 as uuidv4 } from 'uuid';
import { env } from '../env';
import { cleanupOldTasks as cleanupOldTaskFiles } from '../utils/file-utils';
import { logger } from '../utils/logger';

export interface BaseTask {
  id: string;
  lastUpdate: Date;
  status: string;
}

/**
 * Generic base task manager with shared lifecycle management
 */
export abstract class BaseTaskManager<T extends BaseTask> {
  protected tasks: Map<string, T> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanup();
  }

  protected generateId(): string {
    return uuidv4();
  }

  getTask(taskId: string): T | undefined {
    return this.tasks.get(taskId);
  }

  deleteTask(taskId: string): boolean {
    return this.tasks.delete(taskId);
  }

  get taskCount(): number {
    return this.tasks.size;
  }

  get activeTaskCount(): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status !== 'complete' && task.status !== 'error') {
        count++;
      }
    }
    return count;
  }

  getAllTasks(): T[] {
    return Array.from(this.tasks.values());
  }

  cleanupOldTasks(): number {
    const now = Date.now();
    const maxAge = env.TASK_TTL_MS;
    let cleaned = 0;

    for (const [id, task] of this.tasks) {
      const age = now - task.lastUpdate.getTime();
      if (age > maxAge) {
        this.tasks.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info('Cleaned up old tasks', { type: this.taskType, cleaned });
    }

    return cleaned;
  }

  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  protected abstract get taskType(): string;

  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldTasks();
      cleanupOldTaskFiles(env.TASK_TTL_MS).catch(err => {
        logger.error('Failed to cleanup old task files', { error: String(err) });
      });
    }, 10 * 60 * 1000);
  }
}
