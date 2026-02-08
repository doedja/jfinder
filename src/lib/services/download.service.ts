import type { Paper, DownloadResult, DownloadSource, FailedDownload } from '../types';
import { downloadFromScihub } from './scihub.service';
import { downloadFromAnnas } from './annas-archive.service';
import { downloadFromLibgen } from './libgen.service';
import { downloadFromUnpaywall } from './unpaywall.service';
import { env } from '../env';
import { mkdir, writeFile as fsWriteFile } from 'fs/promises';
import { join } from 'path';
import { createSafeFilename } from '../utils/file-utils';
import { logger } from '../utils/logger';

const log = logger.child({ svc: 'download' });

/**
 * Determine which download sources are enabled based on configuration
 * All free sources are always enabled, Anna's Archive only if API key provided
 */
function getEnabledSources(): DownloadSource[] {
  // Free sources - always enabled
  const sources: DownloadSource[] = ['unpaywall', 'openalex-oa', 'scihub', 'libgen'];

  // Anna's Archive - only if API key is set (used as feature flag)
  if (env.ANNAS_API_KEY || env.RAPIDAPI_KEY) {
    sources.push('annas-archive');
  }

  return sources;
}

// Default enabled sources based on configuration
export const defaultEnabledSources = getEnabledSources();

// Log enabled sources on startup
log.info('Download sources enabled', { sources: defaultEnabledSources });

/**
 * Ensure directory exists
 */
async function ensureDir(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch {
    // Directory might already exist
  }
}

/**
 * Download from OpenAlex OA URL (if paper has one)
 */
async function downloadFromOpenAlexOA(paper: Paper): Promise<Buffer | null> {
  if (!paper.openAccessUrl) {
    return null;
  }

  log.debug('Trying OpenAlex OA URL', { doi: paper.doi, url: paper.openAccessUrl });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(paper.openAccessUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/pdf,*/*'
      },
      signal: controller.signal,
      redirect: 'follow'
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Validate it's a PDF
    if (buffer.slice(0, 4).toString() === '%PDF') {
      log.debug('Downloaded from OpenAlex OA', { doi: paper.doi });
      return buffer;
    }

    return null;
  } catch (error) {
    log.debug('OpenAlex OA download error', { doi: paper.doi, error: String(error) });
    return null;
  }
}

interface DownloadAttempt {
  source: DownloadSource;
  download: (signal?: AbortSignal) => Promise<Buffer | null>;
}

/**
 * Create download attempts for a paper based on enabled sources
 */
function createDownloadAttempts(
  paper: Paper,
  enabledSources: DownloadSource[]
): DownloadAttempt[] {
  const attempts: DownloadAttempt[] = [];

  // OpenAlex OA - only if paper has OA URL
  if (enabledSources.includes('openalex-oa') && paper.openAccessUrl) {
    attempts.push({
      source: 'openalex-oa',
      download: () => downloadFromOpenAlexOA(paper)
    });
  }

  // Unpaywall - legal open access
  if (enabledSources.includes('unpaywall')) {
    attempts.push({
      source: 'unpaywall',
      download: () => downloadFromUnpaywall(paper.doi)
    });
  }

  // Sci-Hub
  if (enabledSources.includes('scihub')) {
    attempts.push({
      source: 'scihub',
      download: () => downloadFromScihub(paper.doi)
    });
  }

  // LibGen
  if (enabledSources.includes('libgen')) {
    attempts.push({
      source: 'libgen',
      download: () => downloadFromLibgen(paper.doi)
    });
  }

  // Anna's Archive (only if enabled)
  if (enabledSources.includes('annas-archive')) {
    attempts.push({
      source: 'annas-archive',
      download: () => downloadFromAnnas(paper.doi)
    });
  }

  return attempts;
}

/**
 * Race multiple download sources in parallel
 * Returns the first successful result and cancels remaining downloads
 */
async function raceDownloads(
  attempts: DownloadAttempt[]
): Promise<{ buffer: Buffer; source: DownloadSource } | null> {
  if (attempts.length === 0) {
    return null;
  }

  const controller = new AbortController();

  // Create promises that resolve with source info on success, or null on failure
  const promises = attempts.map(async (attempt) => {
    try {
      if (controller.signal.aborted) return null;
      const buffer = await attempt.download(controller.signal);
      if (buffer && !controller.signal.aborted) {
        return { buffer, source: attempt.source };
      }
      return null;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return null;
      log.debug('Download source error', { source: attempt.source, error: String(error) });
      return null;
    }
  });

  // Use Promise.race-style: resolve as soon as any source succeeds
  try {
    const result = await new Promise<{ buffer: Buffer; source: DownloadSource } | null>((resolve) => {
      let completedCount = 0;

      promises.forEach(promise => {
        promise.then(result => {
          if (result && !controller.signal.aborted) {
            controller.abort(); // Cancel remaining downloads
            resolve(result);
          } else {
            completedCount++;
            if (completedCount === promises.length) {
              resolve(null); // All sources failed
            }
          }
        });
      });
    });

    return result;
  } finally {
    // Ensure cleanup
    if (!controller.signal.aborted) {
      controller.abort();
    }
  }
}

/**
 * Download a single paper from multiple sources in parallel
 */
export async function downloadPaper(
  paper: Paper,
  enabledSources: DownloadSource[] = defaultEnabledSources
): Promise<DownloadResult> {
  log.debug('Starting parallel download', { doi: paper.doi, sources: enabledSources.length });

  const attempts = createDownloadAttempts(paper, enabledSources);

  if (attempts.length === 0) {
    return {
      success: false,
      error: 'No download sources configured'
    };
  }

  const result = await raceDownloads(attempts);

  if (result) {
    return {
      success: true,
      source: result.source
    };
  }

  return {
    success: false,
    error: `Failed to download from all sources: ${attempts.map(a => a.source).join(', ')}`
  };
}

/**
 * Download paper and save to disk
 */
export async function downloadAndSavePaper(
  paper: Paper,
  outputDir: string,
  enabledSources: DownloadSource[] = defaultEnabledSources
): Promise<DownloadResult> {
  log.debug('Starting parallel download', { doi: paper.doi, sources: enabledSources.length });

  const attempts = createDownloadAttempts(paper, enabledSources);

  if (attempts.length === 0) {
    return {
      success: false,
      error: 'No download sources configured'
    };
  }

  const result = await raceDownloads(attempts);

  if (!result) {
    return {
      success: false,
      error: `Failed to download from all sources: ${attempts.map(a => a.source).join(', ')}`
    };
  }

  // Save to disk
  await ensureDir(outputDir);
  const filename = `${createSafeFilename(paper.title)}.pdf`;
  const filePath = join(outputDir, filename);

  try {
    await fsWriteFile(filePath, result.buffer);
    return {
      success: true,
      source: result.source,
      filePath
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to save file: ${error}`
    };
  }
}

/**
 * Download multiple papers with progress tracking
 * Papers are downloaded sequentially, but each paper tries all sources in parallel
 */
export async function downloadPapers(
  papers: Paper[],
  outputDir: string,
  onProgress?: (current: number, total: number, paper: Paper, success: boolean) => void,
  enabledSources: DownloadSource[] = defaultEnabledSources
): Promise<{
  successful: string[];
  failed: FailedDownload[];
}> {
  const papersDir = join(outputDir, 'papers');
  await ensureDir(papersDir);

  const successful: string[] = [];
  const failed: FailedDownload[] = [];

  log.info('Batch download starting', { count: papers.length, sources: enabledSources });

  for (let i = 0; i < papers.length; i++) {
    const paper = papers[i];

    if (!paper.doi) {
      failed.push({
        paper,
        error: 'No DOI available',
        attemptedSources: []
      });
      onProgress?.(i + 1, papers.length, paper, false);
      continue;
    }

    const result = await downloadAndSavePaper(paper, papersDir, enabledSources);

    if (result.success && result.filePath) {
      successful.push(result.filePath);
      log.info('Paper downloaded', { idx: `${i + 1}/${papers.length}`, source: result.source, doi: paper.doi });
    } else {
      failed.push({
        paper,
        error: result.error || 'Unknown error',
        attemptedSources: enabledSources
      });
      log.warn('Paper download failed', { idx: `${i + 1}/${papers.length}`, doi: paper.doi });
    }

    onProgress?.(i + 1, papers.length, paper, result.success);

    // Rate limiting - 2 second delay between papers (sources run in parallel per paper)
    if (i < papers.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  log.info('Batch download complete', { success: successful.length, failed: failed.length });

  return { successful, failed };
}

/**
 * Generate metadata file content
 */
export function generateMetadata(
  papers: Paper[],
  searchQueries: string[],
  failedDownloads: FailedDownload[]
): string {
  let content = 'Search Queries Used:\n';
  searchQueries.forEach((query, i) => {
    content += `${i + 1}. ${query}\n`;
  });

  content += `\n${'='.repeat(50)}\n\n`;
  content += `Found Papers (${papers.length}):\n\n`;

  papers.forEach((paper, i) => {
    content += `${i + 1}. ${paper.title}\n`;
    content += `   Authors: ${paper.authors}\n`;
    content += `   Journal: ${paper.journal}\n`;
    content += `   Year: ${paper.year}\n`;
    content += `   DOI: ${paper.doi}\n`;
    if (paper.openAccessUrl) {
      content += `   Open Access: ${paper.openAccessUrl}\n`;
    }
    if (paper.abstract) {
      content += `   Abstract: ${paper.abstract.substring(0, 500)}${paper.abstract.length > 500 ? '...' : ''}\n`;
    }
    content += '\n';
  });

  if (failedDownloads.length > 0) {
    content += `\n${'='.repeat(50)}\n\n`;
    content += `Failed Downloads (${failedDownloads.length}):\n\n`;

    failedDownloads.forEach((failed, i) => {
      content += `${i + 1}. ${failed.paper.title}\n`;
      content += `   DOI: ${failed.paper.doi}\n`;
      content += `   Error: ${failed.error}\n\n`;
    });
  }

  return content;
}
