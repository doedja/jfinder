/**
 * Unpaywall API Service
 * Free API that provides legal open access links for papers
 * Only requires an email in the request (no API key)
 */

const UNPAYWALL_API_URL = 'https://api.unpaywall.org/v2';
const MAILTO = 'jfinder@doedja.com';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json'
};

interface UnpaywallResponse {
  doi: string;
  is_oa: boolean;
  best_oa_location?: {
    url?: string;
    url_for_pdf?: string;
    license?: string;
    version?: string;
  };
  oa_locations?: Array<{
    url?: string;
    url_for_pdf?: string;
    license?: string;
  }>;
}

/**
 * Get open access URL from Unpaywall
 */
export async function getUnpaywallUrl(doi: string): Promise<string | null> {
  try {
    const url = `${UNPAYWALL_API_URL}/${encodeURIComponent(doi)}?email=${MAILTO}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as UnpaywallResponse;

    if (!data.is_oa) {
      return null;
    }

    // Try best OA location first
    if (data.best_oa_location?.url_for_pdf) {
      return data.best_oa_location.url_for_pdf;
    }
    if (data.best_oa_location?.url) {
      return data.best_oa_location.url;
    }

    // Try other locations
    if (data.oa_locations) {
      for (const loc of data.oa_locations) {
        if (loc.url_for_pdf) return loc.url_for_pdf;
        if (loc.url) return loc.url;
      }
    }

    return null;
  } catch (error) {
    console.error('Unpaywall lookup error:', error);
    return null;
  }
}

/**
 * Download paper from Unpaywall
 */
export async function downloadFromUnpaywall(doi: string): Promise<Buffer | null> {
  console.log(`Checking Unpaywall for DOI: ${doi}`);

  const oaUrl = await getUnpaywallUrl(doi);

  if (!oaUrl) {
    console.log('No open access URL found on Unpaywall');
    return null;
  }

  console.log(`Found Unpaywall URL: ${oaUrl}`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(oaUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/pdf,*/*'
      },
      signal: controller.signal,
      redirect: 'follow'
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`Failed to download from Unpaywall URL: ${response.status}`);
      return null;
    }

    const contentType = response.headers.get('content-type') || '';
    const buffer = Buffer.from(await response.arrayBuffer());

    // Validate it's a PDF
    if (contentType.includes('pdf') || buffer.slice(0, 4).toString() === '%PDF') {
      console.log('Successfully downloaded from Unpaywall');
      return buffer;
    }

    console.log('Unpaywall URL did not return a PDF');
    return null;
  } catch (error) {
    console.error('Unpaywall download error:', error);
    return null;
  }
}
