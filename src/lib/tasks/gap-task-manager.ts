import type { GapTaskStatus, GapTaskState, AnalysisType, AnalysisDepth } from '../types/gap-analysis';
import { BaseTaskManager } from './base-task-manager';

/**
 * Gap Task Manager - handles gap analysis task lifecycle and status tracking
 */
class GapTaskManager extends BaseTaskManager<GapTaskStatus> {
  protected get taskType(): string {
    return 'gap-analysis';
  }

  createGapTask(
    topic: string,
    targetPapers: number,
    analysisTypes: AnalysisType[],
    depth: AnalysisDepth
  ): string {
    const id = this.generateId();

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

  updateComparisons(taskId: string, comparisonsComplete: number): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.comparisonsComplete = comparisonsComplete;
    task.lastUpdate = new Date();
  }

  completeGapTask(taskId: string, resultUrl: string, reportUrl?: string): void {
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
}

// Singleton instance
export const gapTaskManager = new GapTaskManager();
