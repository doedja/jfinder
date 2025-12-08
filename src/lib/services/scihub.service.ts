import * as cheerio from 'cheerio';
import { proxyService, type ProxyConfig } from './proxy.service';

const SCIHUB_DOMAINS = [
  'https://sci-hub.se',
  'https://sci-hub.st',
  'https://sci-hub.ru',
  'https://sci-hub.wf',
  'https://sci-hub.ren'
];

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
};

/**
 * Extract PDF link from Sci-Hub page
 */
function extractPdfLink(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html);

  // Method 1: Download button onclick
  const button = $('#buttons button');
  if (button.length > 0) {
    const onclick = button.attr('onclick') || '';
    const match = onclick.match(/['"]([^'"]*\.pdf)['"]/);
    if (match) {
      const pdfPath = match[1];
      if (pdfPath.startsWith('http')) return pdfPath;
      if (pdfPath.startsWith('//')) return `https:${pdfPath}`;
      return `${baseUrl}${pdfPath.startsWith('/') ? '' : '/'}${pdfPath}`;
    }
  }

  // Method 2: Embedded PDF
  const embed = $('embed[type="application/pdf"]');
  if (embed.length > 0) {
    const src = embed.attr('src');
    if (src) {
      const cleanSrc = src.split('#')[0];
      if (cleanSrc.startsWith('http')) return cleanSrc;
      if (cleanSrc.startsWith('//')) return `https:${cleanSrc}`;
      return `${baseUrl}${cleanSrc.startsWith('/') ? '' : '/'}${cleanSrc}`;
    }
  }

  // Method 3: iframe
  const iframe = $('iframe');
  if (iframe.length > 0) {
    const src = iframe.attr('src');
    if (src) {
      if (src.startsWith('http')) return src;
      if (src.startsWith('//')) return `https:${src}`;
      return `${baseUrl}${src.startsWith('/') ? '' : '/'}${src}`;
    }
  }

  return null;
}

/**
 * Extract PDF link from DOI landing page
 */
function extractPdfFromDoiPage(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html);

  // Look for PDF links
  const links = $('a[href]');
  for (const el of links) {
    const href = $(el).attr('href')?.toLowerCase() || '';
    if (href.includes('.pdf') || href.includes('download') || href.includes('pdf')) {
      const fullHref = $(el).attr('href')!;
      if (fullHref.startsWith('http')) return fullHref;
      if (fullHref.startsWith('//')) return `https:${fullHref}`;
      return new URL(fullHref, baseUrl).href;
    }
  }

  return null;
}

/**
 * Validate if content is a PDF
 */
function isPdf(content: ArrayBuffer, contentType?: string): boolean {
  // Check content-type header
  if (contentType?.toLowerCase().includes('pdf')) {
    return true;
  }

  // Check magic bytes (%PDF)
  const bytes = new Uint8Array(content.slice(0, 4));
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/**
 * Build proxy agent URL for fetch (Note: Bun doesn't natively support proxies in fetch)
 * This is a placeholder - in production, you'd use a proxy agent library
 */
async function fetchWithProxy(
  url: string,
  proxy?: ProxyConfig,
  timeout = 20000
): Promise<Response | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    // Note: Native fetch doesn't support proxies directly
    // In a real implementation, you'd use a library like undici with proxy support
    // For now, we'll do direct requests
    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
      redirect: 'follow'
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.log(`Timeout accessing ${url}`);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Download paper from Sci-Hub
 */
export async function downloadFromScihub(doi: string): Promise<Buffer | null> {
  const proxy = await proxyService.getRandomProxy();

  // Try each Sci-Hub domain
  for (const domain of SCIHUB_DOMAINS) {
    const url = `${domain}/${doi}`;

    try {
      console.log(`Trying ${domain}...`);
      const response = await fetchWithProxy(url, proxy);

      if (!response || !response.ok) {
        console.log(`Failed to access ${domain}: ${response?.status || 'no response'}`);
        continue;
      }

      const html = await response.text();
      const pdfLink = extractPdfLink(html, domain);

      if (!pdfLink) {
        console.log(`No PDF link found on ${domain}`);
        continue;
      }

      console.log(`Found PDF link: ${pdfLink}`);

      // Download the PDF
      const pdfResponse = await fetchWithProxy(pdfLink, proxy, 30000);

      if (!pdfResponse || !pdfResponse.ok) {
        console.log(`Failed to download PDF from ${domain}`);
        continue;
      }

      const content = await pdfResponse.arrayBuffer();
      const contentType = pdfResponse.headers.get('content-type') || undefined;

      if (!isPdf(content, contentType)) {
        console.log(`Downloaded file is not a PDF from ${domain}`);
        continue;
      }

      console.log(`Successfully downloaded from ${domain}`);
      return Buffer.from(content);
    } catch (error) {
      console.error(`Error with ${domain}:`, error);
      continue;
    }
  }

  // Try direct DOI link as last resort
  const doiUrl = `https://doi.org/${doi}`;
  try {
    console.log(`Trying direct DOI link...`);
    const response = await fetchWithProxy(doiUrl, proxy);

    if (response && response.ok) {
      const html = await response.text();
      const pdfLink = extractPdfFromDoiPage(html, response.url);

      if (pdfLink) {
        const pdfResponse = await fetchWithProxy(pdfLink, proxy, 30000);

        if (pdfResponse && pdfResponse.ok) {
          const content = await pdfResponse.arrayBuffer();
          const contentType = pdfResponse.headers.get('content-type') || undefined;

          if (isPdf(content, contentType)) {
            console.log('Successfully downloaded from DOI link');
            return Buffer.from(content);
          }
        }
      }
    }
  } catch (error) {
    console.error('Error with DOI link:', error);
  }

  return null;
}
