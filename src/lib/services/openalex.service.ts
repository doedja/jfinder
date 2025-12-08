import type { Paper } from '../types';

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
    const response = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`OpenAlex API error: ${response.status} ${response.statusText}`);
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
        openAccessUrl: work.open_access?.oa_url || undefined
      }));
  } catch (error) {
    console.error('OpenAlex search error:', error);
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
      console.error(`OpenAlex DOI lookup error: ${response.status}`);
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
      openAccessUrl: work.open_access?.oa_url || undefined
    };
  } catch (error) {
    console.error('OpenAlex DOI lookup error:', error);
    return null;
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
