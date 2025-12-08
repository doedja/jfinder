export interface Paper {
  title: string;
  journal: string;
  year: string;
  authors: string;
  doi: string;
  openAccessUrl?: string; // Direct OA URL from OpenAlex/Unpaywall
}

export interface DownloadResult {
  success: boolean;
  source?: DownloadSource;
  filePath?: string;
  error?: string;
}

export type DownloadSource =
  | 'scihub'
  | 'annas-archive'
  | 'libgen'
  | 'unpaywall'
  | 'openalex-oa'
  | 'doi-direct';

export interface FailedDownload {
  paper: Paper;
  error: string;
  attemptedSources: DownloadSource[];
}
