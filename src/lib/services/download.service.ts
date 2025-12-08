import type { Paper, DownloadResult, DownloadSource, FailedDownload } from '../types';
import { downloadFromScihub } from './scihub.service';
import { downloadFromAnnas } from './annas-archive.service';
import { downloadFromLibgen } from './libgen.service';
import { downloadFromUnpaywall } from './unpaywall.service';
import { env } from '../env';
import { mkdir, writeFile as fsWriteFile } from 'fs/promises';
import { join } from 'path';

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
console.log(`Download sources enabled: ${defaultEnabledSources.join(', ')}`);

/**
 * Create a safe filename from a paper title
 */
export function createSafeFilename(title: string, maxLength = 100): string {
  return title
    .replace(/[^a-zA-Z0-9 \-_]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .substring(0, maxLength)
    .trim()
    .replace(/_$/, '');
}

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

  console.log(`[${paper.doi}] Trying OpenAlex OA URL: ${paper.openAccessUrl}`);

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
      console.log(`[${paper.doi}] Successfully downloaded from OpenAlex OA`);
      return buffer;
    }

    return null;
  } catch (error) {
    console.error(`[${paper.doi}] OpenAlex OA download error:`, error);
    return null;
  }
}

interface DownloadAttempt {
  source: DownloadSource;
  download: () => Promise<Buffer | null>;
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
 * Returns the first successful result
 */
async function raceDownloads(
  attempts: DownloadAttempt[]
): Promise<{ buffer: Buffer; source: DownloadSource } | null> {
  if (attempts.length === 0) {
    return null;
  }

  // Create promises that resolve with source info on success
  const promises = attempts.map(async (attempt) => {
    try {
      const buffer = await attempt.download();
      if (buffer) {
        return { buffer, source: attempt.source };
      }
      return null;
    } catch (error) {
      console.error(`Download error from ${attempt.source}:`, error);
      return null;
    }
  });

  // Wait for all to complete and find first success
  const results = await Promise.all(promises);

  for (const result of results) {
    if (result) {
      return result;
    }
  }

  return null;
}

/**
 * Download a single paper from multiple sources in parallel
 */
export async function downloadPaper(
  paper: Paper,
  enabledSources: DownloadSource[] = defaultEnabledSources
): Promise<DownloadResult> {
  console.log(`[${paper.doi}] Starting parallel download from ${enabledSources.length} sources`);

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
  console.log(`[${paper.doi}] Starting parallel download from ${enabledSources.length} sources`);

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

  console.log(`Starting download of ${papers.length} papers using sources: ${enabledSources.join(', ')}`);

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
      console.log(`[${i + 1}/${papers.length}] Downloaded: ${paper.title.substring(0, 50)}... (${result.source})`);
    } else {
      failed.push({
        paper,
        error: result.error || 'Unknown error',
        attemptedSources: enabledSources
      });
      console.log(`[${i + 1}/${papers.length}] Failed: ${paper.title.substring(0, 50)}...`);
    }

    onProgress?.(i + 1, papers.length, paper, result.success);

    // Rate limiting - 2 second delay between papers (sources run in parallel per paper)
    if (i < papers.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`Download complete: ${successful.length} successful, ${failed.length} failed`);

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
