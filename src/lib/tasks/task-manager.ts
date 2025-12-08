import { v4 as uuidv4 } from 'uuid';
import type { TaskStatus, TaskUpdate, TaskState } from '../types';
import { env } from '../env';

/**
 * Task Manager - handles task lifecycle and status tracking
 */
class TaskManager {
  private tasks: Map<string, TaskStatus> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start cleanup interval
    this.startCleanup();
  }

  /**
   * Create a new task
   */
  createTask(totalPapers: number, totalCycles = 1): string {
    const id = uuidv4();

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

  /**
   * Get a task by ID
   */
  getTask(taskId: string): TaskStatus | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Update a task's status
   */
  updateTask(taskId: string, updates: TaskUpdate): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    Object.assign(task, updates, { lastUpdate: new Date() });
  }

  /**
   * Set task as processing
   */
  startProcessing(taskId: string, message = 'Processing...'): void {
    this.updateTask(taskId, {
      status: 'processing',
      message,
      progress: 5
    });
  }

  /**
   * Update progress during research cycle
   */
  updateCycleProgress(
    taskId: string,
    message: string,
    currentCycle: number,
    papersFound: number
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // Calculate progress (5% to 90% for cycles)
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

  /**
   * Update download progress
   */
  updateDownloadProgress(
    taskId: string,
    papersDownloaded: number,
    total: number
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // Download progress is 90% to 100%
    const downloadProgress = 90 + (papersDownloaded / total) * 10;

    this.updateTask(taskId, {
      message: `Downloading papers (${papersDownloaded}/${total})...`,
      papersDownloaded,
      progress: Math.round(downloadProgress)
    });
  }

  /**
   * Mark task as complete
   */
  completeTask(
    taskId: string,
    downloadUrl?: string,
    metadataUrl?: string
  ): void {
    this.updateTask(taskId, {
      status: 'complete',
      progress: 100,
      message: 'Complete',
      downloadUrl,
      metadataUrl
    });
  }

  /**
   * Mark task as failed
   */
  failTask(taskId: string, error: string): void {
    this.updateTask(taskId, {
      status: 'error',
      error,
      message: error
    });
  }

  /**
   * Delete a task
   */
  deleteTask(taskId: string): boolean {
    return this.tasks.delete(taskId);
  }

  /**
   * Clean up old tasks
   */
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
      console.log(`Cleaned up ${cleaned} old tasks`);
    }

    return cleaned;
  }

  /**
   * Start automatic cleanup
   */
  private startCleanup(): void {
    // Run cleanup every 10 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldTasks();
    }, 10 * 60 * 1000);
  }

  /**
   * Stop cleanup interval
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get all tasks (for debugging)
   */
  getAllTasks(): TaskStatus[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get task count
   */
  get taskCount(): number {
    return this.tasks.size;
  }
}

// Singleton instance
export const taskManager = new TaskManager();
