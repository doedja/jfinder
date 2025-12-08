/**
 * Library Genesis (LibGen) Service
 * Free service - no API key required
 * Searches LibGen mirrors for papers by DOI
 */

import * as cheerio from 'cheerio';

const LIBGEN_MIRRORS = [
  'https://libgen.is',
  'https://libgen.rs',
  'https://libgen.st'
];

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
};

interface LibGenResult {
  title: string;
  author: string;
  md5: string;
  extension: string;
  mirrors: string[];
}

/**
 * Search LibGen by DOI
 */
async function searchByDoi(doi: string, mirror: string): Promise<LibGenResult | null> {
  try {
    // LibGen search URL for scientific articles
    const searchUrl = `${mirror}/scimag/?q=${encodeURIComponent(doi)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(searchUrl, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
      redirect: 'follow'
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Find results table
    const rows = $('table tbody tr');

    if (rows.length === 0) {
      return null;
    }

    // Get first result
    const firstRow = rows.first();
    const cells = firstRow.find('td');

    if (cells.length < 3) {
      return null;
    }

    // Extract download links
    const downloadLinks: string[] = [];
    firstRow.find('a[href*="get.php"], a[href*="ads.php"], a[href*="download"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        downloadLinks.push(href.startsWith('http') ? href : `${mirror}${href.startsWith('/') ? '' : '/'}${href}`);
      }
    });

    // Try to find MD5 from links
    let md5 = '';
    for (const link of downloadLinks) {
      const md5Match = link.match(/[a-fA-F0-9]{32}/);
      if (md5Match) {
        md5 = md5Match[0];
        break;
      }
    }

    if (!md5 && downloadLinks.length === 0) {
      return null;
    }

    return {
      title: cells.eq(1).text().trim() || 'Unknown',
      author: cells.eq(0).text().trim() || 'Unknown',
      md5,
      extension: 'pdf',
      mirrors: downloadLinks
    };
  } catch (error) {
    console.error(`LibGen search error on ${mirror}:`, error);
    return null;
  }
}

/**
 * Try to download from a LibGen download URL
 */
async function tryDownloadFromUrl(url: string): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

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

    // If it's HTML, try to find the actual download link
    if (contentType.includes('html')) {
      const html = await response.text();
      const $ = cheerio.load(html);

      // Look for GET link on libgen pages
      const getLink = $('a:contains("GET")').first().attr('href') ||
                      $('a[href*=".pdf"]').first().attr('href') ||
                      $('#download a').first().attr('href');

      if (getLink) {
        const fullUrl = getLink.startsWith('http') ? getLink : new URL(getLink, url).href;
        return tryDownloadFromUrl(fullUrl);
      }
      return null;
    }

    // Check if it's a PDF
    if (contentType.includes('pdf') || contentType.includes('octet-stream')) {
      const buffer = Buffer.from(await response.arrayBuffer());

      // Verify PDF magic bytes
      if (buffer.slice(0, 4).toString() === '%PDF') {
        return buffer;
      }
    }

    return null;
  } catch (error) {
    console.error('LibGen download error:', error);
    return null;
  }
}

/**
 * Download paper from LibGen
 */
export async function downloadFromLibgen(doi: string): Promise<Buffer | null> {
  console.log(`Searching LibGen for DOI: ${doi}`);

  // Try each mirror
  for (const mirror of LIBGEN_MIRRORS) {
    console.log(`Trying LibGen mirror: ${mirror}`);

    const result = await searchByDoi(doi, mirror);

    if (!result) {
      continue;
    }

    console.log(`Found on LibGen: ${result.title}`);

    // Try each download link
    for (const link of result.mirrors) {
      console.log(`Trying LibGen download: ${link.substring(0, 60)}...`);
      const buffer = await tryDownloadFromUrl(link);

      if (buffer) {
        console.log('Successfully downloaded from LibGen');
        return buffer;
      }
    }

    // If we have MD5 but mirrors failed, try common download patterns
    if (result.md5) {
      const fallbackUrls = [
        `https://download.library.lol/scimag/${result.md5.substring(0, 2)}/${result.md5}.pdf`,
        `http://libgen.lc/scimag/get.php?doi=${encodeURIComponent(doi)}`,
      ];

      for (const fallbackUrl of fallbackUrls) {
        console.log(`Trying LibGen fallback: ${fallbackUrl.substring(0, 60)}...`);
        const buffer = await tryDownloadFromUrl(fallbackUrl);
        if (buffer) {
          console.log('Successfully downloaded from LibGen fallback');
          return buffer;
        }
      }
    }
  }

  console.log('Failed to download from LibGen');
  return null;
}
