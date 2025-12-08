export type TaskState = 'pending' | 'processing' | 'complete' | 'error';

export interface TaskStatus {
  id: string;
  status: TaskState;
  progress: number;
  message: string;
  totalPapers: number;
  papersFound: number;
  papersDownloaded: number;
  currentCycle: number;
  totalCycles: number;
  error?: string;
  downloadUrl?: string;
  metadataUrl?: string;
  lastUpdate: Date;
}

export interface TaskUpdate {
  status?: TaskState;
  progress?: number;
  message?: string;
  papersFound?: number;
  papersDownloaded?: number;
  currentCycle?: number;
  totalCycles?: number;
  error?: string;
  downloadUrl?: string;
  metadataUrl?: string;
}

export type ProgressCallback = (
  message: string,
  cycle: number,
  papersFound: number
) => void;
