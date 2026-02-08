import * as cheerio from 'cheerio';
import { env } from '../env';
import { logger } from '../utils/logger';

const log = logger.child({ svc: 'annas-archive' });

const ANNAS_ARCHIVE_URL = 'https://annas-archive.org';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

interface AnnasSearchResult {
  title: string;
  author: string;
  md5: string;
  format: string;
  size: string;
  downloadUrl: string;
}

/**
 * Search Anna's Archive by DOI
 */
export async function searchByDoi(doi: string): Promise<AnnasSearchResult | null> {
  try {
    const searchUrl = `${ANNAS_ARCHIVE_URL}/search?q=${encodeURIComponent(doi)}`;

    const response = await fetch(searchUrl, {
      headers: BROWSER_HEADERS,
      redirect: 'follow'
    });

    if (!response.ok) {
      log.debug('Anna\'s Archive search failed', { status: response.status });
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Find the first result that matches
    const results = $('a[href*="/md5/"]');

    if (results.length === 0) {
      log.debug('No results on Anna\'s Archive', { doi });
      return null;
    }

    // Get the first result
    const firstResult = results.first();
    const href = firstResult.attr('href');

    if (!href) return null;

    // Extract MD5 from the URL
    const md5Match = href.match(/\/md5\/([a-fA-F0-9]+)/);
    if (!md5Match) return null;

    const md5 = md5Match[1];

    // Get details from the result card
    const title = firstResult.find('h3').text().trim() ||
                  firstResult.text().trim().substring(0, 100);
    const author = firstResult.find('.italic').text().trim() || 'Unknown';

    return {
      title,
      author,
      md5,
      format: 'pdf',
      size: 'Unknown',
      downloadUrl: `${ANNAS_ARCHIVE_URL}/md5/${md5}`
    };
  } catch (error) {
    log.debug('Anna\'s Archive search error', { error: String(error) });
    return null;
  }
}

/**
 * Get download links from Anna's Archive detail page
 */
async function getDownloadLinks(md5: string): Promise<string[]> {
  try {
    const detailUrl = `${ANNAS_ARCHIVE_URL}/md5/${md5}`;

    const response = await fetch(detailUrl, {
      headers: BROWSER_HEADERS,
      redirect: 'follow'
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const downloadLinks: string[] = [];

    // Find download links - these are typically in anchor tags with specific patterns
    $('a[href*="download"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && (href.includes('.pdf') || href.includes('libgen') || href.includes('ipfs'))) {
        downloadLinks.push(href.startsWith('http') ? href : `${ANNAS_ARCHIVE_URL}${href}`);
      }
    });

    // Also look for libgen mirrors
    $('a[href*="libgen"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        downloadLinks.push(href);
      }
    });

    // Look for slow download option
    $('a[href*="/slow_download/"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        downloadLinks.push(href.startsWith('http') ? href : `${ANNAS_ARCHIVE_URL}${href}`);
      }
    });

    return downloadLinks;
  } catch (error) {
    log.debug('Error getting download links', { error: String(error) });
    return [];
  }
}

/**
 * Try to download a file from a URL
 */
async function tryDownload(url: string): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
      redirect: 'follow'
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type') || '';

    // Check if it's a PDF or file download
    if (contentType.includes('pdf') || contentType.includes('octet-stream')) {
      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer);
    }

    // If it's HTML, it might be another redirect page
    if (contentType.includes('html')) {
      const html = await response.text();
      const $ = cheerio.load(html);

      // Look for direct download link
      const directLink = $('a[href*=".pdf"]').first().attr('href');
      if (directLink) {
        return tryDownload(directLink.startsWith('http') ? directLink : new URL(directLink, url).href);
      }
    }

    return null;
  } catch (error) {
    log.debug('Download error', { error: String(error) });
    return null;
  }
}

/**
 * Download paper from Anna's Archive
 */
export async function downloadFromAnnas(doi: string): Promise<Buffer | null> {
  log.debug('Searching Anna\'s Archive', { doi });

  // Search for the paper
  const searchResult = await searchByDoi(doi);

  if (!searchResult) {
    log.debug('Paper not found on Anna\'s Archive', { doi });
    return null;
  }

  log.debug('Found on Anna\'s Archive', { doi, title: searchResult.title });

  // Get download links
  const downloadLinks = await getDownloadLinks(searchResult.md5);

  if (downloadLinks.length === 0) {
    log.debug('No download links found', { doi });
    return null;
  }

  log.debug('Download links found', { doi, count: downloadLinks.length });

  // Try each download link
  for (const link of downloadLinks) {
    log.debug('Trying download', { link: link.substring(0, 50) });
    const buffer = await tryDownload(link);

    if (buffer) {
      // Validate it's a PDF
      const header = buffer.slice(0, 4).toString();
      if (header === '%PDF') {
        log.debug('Downloaded from Anna\'s Archive', { doi });
        return buffer;
      }
    }
  }

  log.debug('Anna\'s Archive download failed', { doi });
  return null;
}

/**
 * Search Anna's Archive by title (fallback when DOI doesn't match)
 */
export async function searchByTitle(title: string): Promise<AnnasSearchResult | null> {
  try {
    // Clean up the title for search
    const cleanTitle = title
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100);

    const searchUrl = `${ANNAS_ARCHIVE_URL}/search?q=${encodeURIComponent(cleanTitle)}`;

    const response = await fetch(searchUrl, {
      headers: BROWSER_HEADERS,
      redirect: 'follow'
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const results = $('a[href*="/md5/"]');

    if (results.length === 0) {
      return null;
    }

    const firstResult = results.first();
    const href = firstResult.attr('href');

    if (!href) return null;

    const md5Match = href.match(/\/md5\/([a-fA-F0-9]+)/);
    if (!md5Match) return null;

    return {
      title: firstResult.find('h3').text().trim() || title,
      author: firstResult.find('.italic').text().trim() || 'Unknown',
      md5: md5Match[1],
      format: 'pdf',
      size: 'Unknown',
      downloadUrl: `${ANNAS_ARCHIVE_URL}/md5/${md5Match[1]}`
    };
  } catch (error) {
    log.debug('Anna\'s Archive title search error', { error: String(error) });
    return null;
  }
}
