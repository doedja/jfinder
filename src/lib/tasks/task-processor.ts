import { writeFile } from 'fs/promises';
import { join } from 'path';
import type { Paper, DownloadType, YearFilter, FailedDownload } from '../types';
import { taskManager } from './task-manager';
import { searchPapers, processDOIList, searchProvider } from '../services/paper-search.service';
import { generateSearchQueries } from '../services/openrouter.service';
import { downloadPapers, generateMetadata } from '../services/download.service';
import { createTaskZip } from '../utils/zip-creator';
import { ensureDir, getTaskDir } from '../utils/file-utils';

interface ProcessTopicParams {
  taskId: string;
  topic: string;
  cycles: number;
  papers: number;
  yearFilter?: YearFilter;
  downloadType: DownloadType;
}

interface ProcessDOIParams {
  taskId: string;
  dois: string[];
  downloadType: DownloadType;
}

/**
 * Process a topic-based search request
 */
export async function processTopicSearch(params: ProcessTopicParams): Promise<void> {
  const { taskId, topic, cycles, papers, yearFilter, downloadType } = params;

  try {
    const taskDir = getTaskDir(taskId);
    await ensureDir(taskDir);

    // Update task status
    taskManager.startProcessing(taskId, 'Generating search queries...');

    // Generate search queries using LLM
    const searchQueries = await generateSearchQueries(topic, cycles);
    console.log(`Generated ${searchQueries.length} search queries`);

    // Perform research cycles
    const allPapers: Paper[] = [];
    const seenDois = new Set<string>();

    for (let cycle = 0; cycle < searchQueries.length; cycle++) {
      if (allPapers.length >= papers) {
        console.log('Reached target paper count, stopping search');
        break;
      }

      const query = searchQueries[cycle];
      taskManager.updateCycleProgress(
        taskId,
        `Cycle ${cycle + 1}/${cycles}: Searching ${searchProvider}...`,
        cycle + 1,
        allPapers.length
      );

      console.log(`Cycle ${cycle + 1}: ${query}`);

      const results = await searchPapers({
        query,
        startYear: yearFilter?.startYear,
        endYear: yearFilter?.endYear
      });

      // Deduplicate results
      for (const paper of results) {
        if (!seenDois.has(paper.doi)) {
          seenDois.add(paper.doi);
          allPapers.push(paper);

          if (allPapers.length >= papers) break;
        }
      }

      console.log(`Found ${allPapers.length} unique papers so far`);

      // Check if we need to broaden the search
      const halfwayCycle = Math.floor(cycles / 2);
      if (cycle === halfwayCycle && allPapers.length < papers * 0.8) {
        console.log('Insufficient results, generating broader queries...');
        taskManager.updateTask(taskId, {
          message: 'Broadening search scope...'
        });

        // Generate broader queries based on what we found
        const broaderQueries = await generateSearchQueries(topic, cycles - cycle - 1, allPapers);
        searchQueries.splice(cycle + 1, searchQueries.length - cycle - 1, ...broaderQueries);
      }

      // Small delay between cycles
      if (cycle < searchQueries.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    if (allPapers.length === 0) {
      taskManager.failTask(taskId, 'No papers found');
      return;
    }

    // Finalize papersFound count before download phase
    taskManager.updateTask(taskId, {
      papersFound: allPapers.length,
      message: 'Preparing to download...'
    });

    // Process downloads or metadata only
    await processResults(taskId, taskDir, allPapers, searchQueries, downloadType);
  } catch (error) {
    console.error('Topic search error:', error);
    taskManager.failTask(taskId, `Search failed: ${error}`);
  }
}

/**
 * Process a DOI list search request
 */
export async function processDOISearch(params: ProcessDOIParams): Promise<void> {
  const { taskId, dois, downloadType } = params;

  try {
    const taskDir = getTaskDir(taskId);
    await ensureDir(taskDir);

    taskManager.startProcessing(taskId, 'Processing DOI list...');

    // Look up papers by DOI
    const allPapers = await processDOIList(dois, (current, total) => {
      taskManager.updateTask(taskId, {
        message: `Looking up DOI ${current}/${total}...`,
        papersFound: current,
        progress: Math.round(5 + (current / total) * 40)
      });
    });

    if (allPapers.length === 0) {
      taskManager.failTask(taskId, 'No valid papers found from DOI list');
      return;
    }

    // Finalize papersFound count before download phase
    taskManager.updateTask(taskId, {
      papersFound: allPapers.length,
      message: 'Preparing to download...'
    });

    const searchQueries = [`DOI list (${dois.length} DOIs)`];
    await processResults(taskId, taskDir, allPapers, searchQueries, downloadType);
  } catch (error) {
    console.error('DOI search error:', error);
    taskManager.failTask(taskId, `DOI processing failed: ${error}`);
  }
}

/**
 * Process results - download papers and create output files
 */
async function processResults(
  taskId: string,
  taskDir: string,
  papers: Paper[],
  searchQueries: string[],
  downloadType: DownloadType
): Promise<void> {
  let failedDownloads: FailedDownload[] = [];

  if (downloadType === 'full') {
    // Download papers
    taskManager.updateTask(taskId, {
      message: 'Downloading papers...',
      progress: 50
    });

    const result = await downloadPapers(
      papers,
      taskDir,
      (current, total, paper, success) => {
        taskManager.updateDownloadProgress(taskId, current, total);
        if (!success) {
          console.log(`Failed to download: ${paper.title}`);
        }
      }
    );

    failedDownloads = result.failed;
    console.log(`Downloaded ${result.successful.length} papers, ${failedDownloads.length} failed`);
  }

  // Generate metadata
  taskManager.updateTask(taskId, {
    message: 'Generating metadata...',
    progress: 95
  });

  const metadata = generateMetadata(papers, searchQueries, failedDownloads);
  await writeFile(join(taskDir, 'details.txt'), metadata, 'utf-8');

  // Save failed downloads list if any
  if (failedDownloads.length > 0) {
    const failedContent = failedDownloads
      .map(f => `${f.paper.title}\nDOI: ${f.paper.doi}\nError: ${f.error}\n`)
      .join('\n---\n\n');
    await writeFile(join(taskDir, 'failed_downloads.txt'), failedContent, 'utf-8');
  }

  // Create ZIP if full download
  if (downloadType === 'full') {
    taskManager.updateTask(taskId, {
      message: 'Creating ZIP archive...',
      progress: 98
    });

    await createTaskZip(taskDir, taskId);
  }

  // Complete task
  taskManager.completeTask(
    taskId,
    downloadType === 'full' ? `/api/download/${taskId}/zip` : undefined,
    `/api/download/${taskId}/metadata`
  );

  console.log(`Task ${taskId} completed`);
}
