import { v4 as uuidv4 } from 'uuid';
import type { GapTaskStatus, GapTaskState, AnalysisType, AnalysisDepth } from '../types/gap-analysis';
import { env } from '../env';

/**
 * Gap Task Manager - handles gap analysis task lifecycle and status tracking
 */
class GapTaskManager {
  private tasks: Map<string, GapTaskStatus> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanup();
  }

  /**
   * Create a new gap analysis task
   */
  createGapTask(
    topic: string,
    targetPapers: number,
    analysisTypes: AnalysisType[],
    depth: AnalysisDepth
  ): string {
    const id = uuidv4();

    const task: GapTaskStatus = {
      id,
      type: 'gap-analysis',
      status: 'pending',
      progress: 0,
      stage: 'Initializing...',
      topic,
      papersFound: 0,
      gapsIdentified: 0,
      comparisonsComplete: 0,
      directionsGenerated: 0,
      lastUpdate: new Date()
    };

    this.tasks.set(id, task);
    return id;
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): GapTaskStatus | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Update gap analysis progress
   */
  updateGapProgress(
    taskId: string,
    status: GapTaskState,
    stage: string,
    progress: number,
    papersFound: number,
    gapsIdentified: number,
    directionsGenerated: number
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    Object.assign(task, {
      status,
      stage,
      progress,
      papersFound,
      gapsIdentified,
      directionsGenerated,
      lastUpdate: new Date()
    });
  }

  /**
   * Update comparisons count
   */
  updateComparisons(taskId: string, comparisonsComplete: number): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.comparisonsComplete = comparisonsComplete;
    task.lastUpdate = new Date();
  }

  /**
   * Mark task as complete
   */
  completeGapTask(
    taskId: string,
    resultUrl: string,
    reportUrl?: string
  ): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    Object.assign(task, {
      status: 'complete',
      progress: 100,
      stage: 'Analysis complete',
      resultUrl,
      reportUrl,
      lastUpdate: new Date()
    });
  }

  /**
   * Mark task as failed
   */
  failGapTask(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    Object.assign(task, {
      status: 'error',
      error,
      stage: error,
      lastUpdate: new Date()
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
      console.log(`Cleaned up ${cleaned} old gap analysis tasks`);
    }

    return cleaned;
  }

  /**
   * Start automatic cleanup
   */
  private startCleanup(): void {
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
  getAllTasks(): GapTaskStatus[] {
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
export const gapTaskManager = new GapTaskManager();
