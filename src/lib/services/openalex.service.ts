import type { Paper } from '../types';
import { withRetry } from '../utils/retry';
import { logger } from '../utils/logger';

const log = logger.child({ svc: 'openalex' });

export interface OpenAlexSearchParams {
  query: string;
  startYear?: number;
  endYear?: number;
  count?: number;
}

interface OpenAlexWork {
  id: string;
  title?: string;
  doi?: string;
  publication_year?: number;
  primary_location?: {
    source?: {
      display_name?: string;
    };
  };
  authorships?: Array<{
    author?: {
      display_name?: string;
    };
  }>;
  open_access?: {
    is_oa?: boolean;
    oa_url?: string;
  };
  abstract_inverted_index?: Record<string, number[]>;
}

/**
 * Reconstruct abstract text from OpenAlex inverted index format
 */
function reconstructAbstract(invertedIndex: Record<string, number[]> | undefined): string | undefined {
  if (!invertedIndex) return undefined;

  const entries: [string, number][] = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      entries.push([word, pos]);
    }
  }

  if (entries.length === 0) return undefined;

  entries.sort((a, b) => a[1] - b[1]);
  return entries.map(e => e[0]).join(' ');
}

interface OpenAlexResponse {
  results?: OpenAlexWork[];
  meta?: {
    count: number;
  };
}

const OPENALEX_API_URL = 'https://api.openalex.org/works';

// Polite pool email for better rate limits (optional but recommended)
const MAILTO = 'jfinder@doedja.com';

/**
 * Search OpenAlex for academic papers
 */
export async function searchOpenAlex(params: OpenAlexSearchParams): Promise<Paper[]> {
  const { query, startYear, endYear, count = 20 } = params;

  const url = new URL(OPENALEX_API_URL);

  // Build filter
  const filters: string[] = [];

  // Search in title and abstract
  url.searchParams.set('search', query);

  // Year filter
  if (startYear && endYear) {
    filters.push(`publication_year:${startYear}-${endYear}`);
  } else if (startYear) {
    filters.push(`publication_year:>${startYear - 1}`);
  }

  // Only get works with DOIs
  filters.push('has_doi:true');

  if (filters.length > 0) {
    url.searchParams.set('filter', filters.join(','));
  }

  url.searchParams.set('per_page', count.toString());
  url.searchParams.set('mailto', MAILTO);

  try {
    return await withRetry(async () => {
      const response = await fetch(url.toString(), {
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) {
          throw new Error(`OpenAlex API error: ${response.status} ${response.statusText}`);
        }
        log.error('OpenAlex API error', { status: response.status, statusText: response.statusText });
        return [];
      }

      const data = await response.json() as OpenAlexResponse;
      const works = data.results || [];

      return works
        .filter((work): work is OpenAlexWork & { title: string; doi: string } =>
          !!work.title && !!work.doi
        )
        .map(work => ({
          title: work.title,
          journal: work.primary_location?.source?.display_name || 'Unknown Journal',
          year: work.publication_year?.toString() || 'Unknown Year',
          authors: work.authorships
            ?.slice(0, 3)
            .map(a => a.author?.display_name)
            .filter(Boolean)
            .join(', ') || 'Unknown Authors',
          doi: work.doi.replace('https://doi.org/', ''),
          openAccessUrl: work.open_access?.oa_url || undefined,
          abstract: reconstructAbstract(work.abstract_inverted_index)
        }));
    }, 2, 1000);
  } catch (error) {
    log.error('OpenAlex search error', { error: String(error) });
    return [];
  }
}

/**
 * Look up a single paper by DOI using OpenAlex
 */
export async function lookupByDoiOpenAlex(doi: string): Promise<Paper | null> {
  // OpenAlex DOI lookup endpoint
  const url = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?mailto=${MAILTO}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        return {
          title: 'Title Not Found',
          journal: 'Unknown Journal',
          year: 'Unknown Year',
          authors: 'Unknown Authors',
          doi
        };
      }
      log.error('OpenAlex DOI lookup error', { status: response.status, doi });
      return null;
    }

    const work = await response.json() as OpenAlexWork;

    return {
      title: work.title || 'Unknown Title',
      journal: work.primary_location?.source?.display_name || 'Unknown Journal',
      year: work.publication_year?.toString() || 'Unknown Year',
      authors: work.authorships
        ?.slice(0, 3)
        .map(a => a.author?.display_name)
        .filter(Boolean)
        .join(', ') || 'Unknown Authors',
      doi,
      openAccessUrl: work.open_access?.oa_url || undefined,
      abstract: reconstructAbstract(work.abstract_inverted_index)
    };
  } catch (error) {
    log.error('OpenAlex DOI lookup error', { doi, error: String(error) });
    return null;
  }
}

/**
 * Get papers that cite a given paper (forward citations)
 */
export async function getCitedBy(doi: string, count = 10): Promise<Paper[]> {
  const url = new URL(OPENALEX_API_URL);
  url.searchParams.set('filter', `cites:https://doi.org/${doi}`);
  url.searchParams.set('per_page', count.toString());
  url.searchParams.set('sort', 'cited_by_count:desc');
  url.searchParams.set('mailto', MAILTO);

  try {
    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) return [];

    const data = await response.json() as OpenAlexResponse;
    const works = data.results || [];

    return works
      .filter((work): work is OpenAlexWork & { title: string; doi: string } =>
        !!work.title && !!work.doi
      )
      .map(work => ({
        title: work.title,
        journal: work.primary_location?.source?.display_name || 'Unknown Journal',
        year: work.publication_year?.toString() || 'Unknown Year',
        authors: work.authorships
          ?.slice(0, 3)
          .map(a => a.author?.display_name)
          .filter(Boolean)
          .join(', ') || 'Unknown Authors',
        doi: work.doi.replace('https://doi.org/', ''),
        openAccessUrl: work.open_access?.oa_url || undefined,
        abstract: reconstructAbstract(work.abstract_inverted_index)
      }));
  } catch (error) {
    log.error('OpenAlex cited-by error', { doi, error: String(error) });
    return [];
  }
}

/**
 * Get papers referenced by a given paper (backward citations)
 */
export async function getReferences(doi: string, count = 10): Promise<Paper[]> {
  // First get the work to find its referenced_works
  const workUrl = `https://api.openalex.org/works/doi:${encodeURIComponent(doi)}?mailto=${MAILTO}`;

  try {
    const workResponse = await fetch(workUrl, {
      headers: { 'Accept': 'application/json' }
    });

    if (!workResponse.ok) return [];

    const work = await workResponse.json() as any;
    const referencedWorks: string[] = work.referenced_works || [];

    if (referencedWorks.length === 0) return [];

    // Fetch details for referenced works (take first N)
    const ids = referencedWorks.slice(0, count).map((id: string) => id.replace('https://openalex.org/', ''));
    const filter = `openalex:${ids.join('|')}`;

    const url = new URL(OPENALEX_API_URL);
    url.searchParams.set('filter', filter);
    url.searchParams.set('per_page', count.toString());
    url.searchParams.set('mailto', MAILTO);

    const response = await fetch(url.toString(), {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) return [];

    const data = await response.json() as OpenAlexResponse;
    const works = data.results || [];

    return works
      .filter((w): w is OpenAlexWork & { title: string; doi: string } =>
        !!w.title && !!w.doi
      )
      .map(w => ({
        title: w.title,
        journal: w.primary_location?.source?.display_name || 'Unknown Journal',
        year: w.publication_year?.toString() || 'Unknown Year',
        authors: w.authorships
          ?.slice(0, 3)
          .map(a => a.author?.display_name)
          .filter(Boolean)
          .join(', ') || 'Unknown Authors',
        doi: w.doi.replace('https://doi.org/', ''),
        openAccessUrl: w.open_access?.oa_url || undefined,
        abstract: reconstructAbstract(w.abstract_inverted_index)
      }));
  } catch (error) {
    log.error('OpenAlex references error', { doi, error: String(error) });
    return [];
  }
}

/**
 * Process a list of DOIs using OpenAlex
 */
export async function processDOIListOpenAlex(
  dois: string[],
  onProgress?: (current: number, total: number) => void
): Promise<Paper[]> {
  const results: Paper[] = [];

  for (let i = 0; i < dois.length; i++) {
    const doi = dois[i];
    const paper = await lookupByDoiOpenAlex(doi);

    if (paper) {
      results.push(paper);
    }

    onProgress?.(i + 1, dois.length);

    // Rate limiting - 100ms delay (OpenAlex allows 10 req/sec)
    if (i < dois.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  return results;
}
