import JSZip from 'jszip';
import { readdir, readFile, writeFile } from 'fs/promises';
import { join, basename } from 'path';

/**
 * Create a ZIP archive from a task directory
 */
export async function createTaskZip(
  taskDir: string,
  taskId: string
): Promise<string> {
  const zip = new JSZip();

  // Add metadata file
  try {
    const metadataPath = join(taskDir, 'details.txt');
    const metadata = await readFile(metadataPath, 'utf-8');
    zip.file('details.txt', metadata);
  } catch {
    // Metadata file might not exist
  }

  // Add failed downloads file if exists
  try {
    const failedPath = join(taskDir, 'failed_downloads.txt');
    const failed = await readFile(failedPath, 'utf-8');
    zip.file('failed_downloads.txt', failed);
  } catch {
    // File might not exist
  }

  // Add papers folder
  const papersDir = join(taskDir, 'papers');
  const papersFolder = zip.folder('papers');

  try {
    const papers = await readdir(papersDir);

    for (const paper of papers) {
      if (paper.endsWith('.pdf')) {
        const paperPath = join(papersDir, paper);
        const content = await readFile(paperPath);
        papersFolder?.file(paper, content);
      }
    }
  } catch {
    // Papers directory might not exist or be empty
  }

  // Generate ZIP buffer
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  // Save ZIP file
  const zipPath = join(taskDir, `${taskId}.zip`);
  await writeFile(zipPath, buffer);

  return zipPath;
}

/**
 * Create a ZIP archive from file paths
 */
export async function createZipFromFiles(
  files: { path: string; name?: string }[],
  outputPath: string
): Promise<void> {
  const zip = new JSZip();

  for (const file of files) {
    try {
      const content = await readFile(file.path);
      const name = file.name || basename(file.path);
      zip.file(name, content);
    } catch (error) {
      console.error(`Failed to add file to ZIP: ${file.path}`, error);
    }
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  await writeFile(outputPath, buffer);
}
