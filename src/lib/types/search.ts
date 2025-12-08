export type DownloadType = 'full' | 'metadata';

export interface SearchRequest {
  topic?: string;
  doiFile?: File;
  cycles: number;
  papers: number;
  yearFilter?: string;
  downloadType: DownloadType;
}

export interface SearchParams {
  topic: string;
  cycles: number;
  papers: number;
  yearFilter?: YearFilter;
  downloadType: DownloadType;
}

export interface YearFilter {
  startYear?: number;
  endYear?: number;
}

export interface ResearchResult {
  papers: import('./paper').Paper[];
  failedDownloads: import('./paper').FailedDownload[];
  searchQueries: string[];
}

export function parseYearFilter(yearFilter?: string): YearFilter | undefined {
  if (!yearFilter) return undefined;

  const trimmed = yearFilter.trim();
  if (!trimmed) return undefined;

  // Format: "2024" or "2020-2024"
  if (trimmed.includes('-')) {
    const [start, end] = trimmed.split('-').map(s => parseInt(s.trim()));
    if (!isNaN(start) && !isNaN(end)) {
      return { startYear: start, endYear: end };
    }
  } else {
    const year = parseInt(trimmed);
    if (!isNaN(year)) {
      return { startYear: year, endYear: year };
    }
  }

  return undefined;
}
