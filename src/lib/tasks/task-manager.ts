import type { TaskStatus, TaskUpdate } from '../types';
import { BaseTaskManager } from './base-task-manager';

/**
 * Task Manager - handles paper download task lifecycle and status tracking
 */
class TaskManager extends BaseTaskManager<TaskStatus> {
  protected get taskType(): string {
    return 'download';
  }

  createTask(totalPapers: number, totalCycles = 1): string {
    const id = this.generateId();

    const task: TaskStatus = {
      id,
      status: 'pending',
      progress: 0,
      message: 'Initializing...',
      totalPapers,
      papersFound: 0,
      papersDownloaded: 0,
      currentCycle: 0,
      totalCycles,
      lastUpdate: new Date()
    };

    this.tasks.set(id, task);
    return id;
  }

  updateTask(taskId: string, updates: TaskUpdate): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    Object.assign(task, updates, { lastUpdate: new Date() });
  }

  startProcessing(taskId: string, message = 'Processing...'): void {
    this.updateTask(taskId, { status: 'processing', message, progress: 5 });
  }

  updateCycleProgress(
    taskId: string,
    message: string,
    currentCycle: number,
    papersFound: number
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const cycleProgress = task.totalCycles > 0
      ? Math.min(90, 5 + (currentCycle * 85 / task.totalCycles))
      : 50;

    this.updateTask(taskId, {
      message,
      currentCycle,
      papersFound,
      progress: Math.round(cycleProgress)
    });
  }

  updateDownloadProgress(taskId: string, papersDownloaded: number, total: number): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    const downloadProgress = 90 + (papersDownloaded / total) * 10;

    this.updateTask(taskId, {
      message: `Downloading papers (${papersDownloaded}/${total})...`,
      papersDownloaded,
      progress: Math.round(downloadProgress)
    });
  }

  completeTask(taskId: string, downloadUrl?: string, metadataUrl?: string): void {
    this.updateTask(taskId, {
      status: 'complete',
      progress: 100,
      message: 'Complete',
      downloadUrl,
      metadataUrl
    });
  }

  failTask(taskId: string, error: string): void {
    this.updateTask(taskId, { status: 'error', error, message: error });
  }
}

// Singleton instance
export const taskManager = new TaskManager();
