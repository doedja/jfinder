import { mkdir, readdir, stat, unlink, rmdir } from 'fs/promises';
import { join, resolve } from 'path';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate that a taskId is a valid UUID format
 */
export function isValidTaskId(taskId: string): boolean {
  return UUID_REGEX.test(taskId);
}

/**
 * Ensure a directory exists
 */
export async function ensureDir(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch {
    // Directory might already exist
  }
}

/**
 * Create a safe filename from a string
 */
export function createSafeFilename(name: string, maxLength = 100): string {
  return name
    .replace(/[^a-zA-Z0-9 \-_]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .substring(0, maxLength)
    .trim()
    .replace(/_$/, '');
}

/**
 * Get the downloads directory path
 */
export function getDownloadsDir(): string {
  return process.env.DOWNLOAD_DIR || './downloads';
}

/**
 * Get task directory path (with path traversal protection)
 */
export function getTaskDir(taskId: string): string {
  const downloadsDir = resolve(getDownloadsDir());
  const taskDir = resolve(join(downloadsDir, taskId));

  // Ensure resolved path is within downloads directory
  if (!taskDir.startsWith(downloadsDir)) {
    throw new Error('Invalid task ID: path traversal detected');
  }

  return taskDir;
}

/**
 * Clean up old task directories
 */
export async function cleanupOldTasks(maxAgeMs: number): Promise<number> {
  const downloadsDir = getDownloadsDir();
  let cleanedCount = 0;

  try {
    const entries = await readdir(downloadsDir);

    for (const entry of entries) {
      const entryPath = join(downloadsDir, entry);

      try {
        const stats = await stat(entryPath);

        if (stats.isDirectory()) {
          const age = Date.now() - stats.mtimeMs;

          if (age > maxAgeMs) {
            await removeDir(entryPath);
            cleanedCount++;
          }
        }
      } catch {
        // Skip entries we can't access
      }
    }
  } catch {
    // Downloads directory might not exist yet
  }

  return cleanedCount;
}

/**
 * Recursively remove a directory
 */
async function removeDir(path: string): Promise<void> {
  try {
    const entries = await readdir(path);

    for (const entry of entries) {
      const entryPath = join(path, entry);
      const stats = await stat(entryPath);

      if (stats.isDirectory()) {
        await removeDir(entryPath);
      } else {
        await unlink(entryPath);
      }
    }

    await rmdir(path);
  } catch (error) {
    console.error(`Failed to remove directory ${path}:`, error);
  }
}

/**
 * Parse DOI list from text content
 */
export function parseDOIList(content: string): string[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(cleanDoi)
    .filter((doi): doi is string => doi !== null);
}

/**
 * Clean and validate a DOI string
 */
export function cleanDoi(doiText: string): string | null {
  let cleaned = doiText.trim();

  // Remove @ prefix if present
  if (cleaned.startsWith('@')) {
    cleaned = cleaned.slice(1);
  }

  // Extract DOI from URL if present
  if (cleaned.includes('doi.org/')) {
    cleaned = cleaned.split('doi.org/').pop() || '';
  }

  // Basic validation - DOI should start with 10.
  if (!cleaned.startsWith('10.')) {
    return null;
  }

  return cleaned;
}
