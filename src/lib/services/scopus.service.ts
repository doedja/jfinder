import type { Paper, YearFilter } from '../types';
import { env } from '../env';

export interface ScopusSearchParams {
  query: string;
  startYear?: number;
  endYear?: number;
  count?: number;
}

interface ScopusEntry {
  'dc:title'?: string;
  'dc:creator'?: string;
  'prism:publicationName'?: string;
  'prism:coverDate'?: string;
  'prism:doi'?: string;
}

interface ScopusResponse {
  'search-results'?: {
    entry?: ScopusEntry[];
  };
}

/**
 * Search Scopus for academic papers
 */
export async function searchScopus(params: ScopusSearchParams): Promise<Paper[]> {
  const { query, startYear, endYear, count = 20 } = params;

  // Build query with year filter
  let fullQuery = query;
  if (startYear && endYear) {
    fullQuery = `${query} AND PUBYEAR AFT ${startYear - 1} AND PUBYEAR BEF ${endYear + 1}`;
  } else if (startYear) {
    fullQuery = `${query} AND PUBYEAR AFT ${startYear - 1}`;
  }

  const url = new URL(env.SCOPUS_API_URL);
  url.searchParams.set('query', fullQuery);
  url.searchParams.set('view', 'STANDARD');
  url.searchParams.set('count', count.toString());

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'X-ELS-APIKey': env.SCOPUS_API_KEY,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`Scopus API error: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = await response.json() as ScopusResponse;
    const entries = data['search-results']?.entry || [];

    return entries
      .filter((entry): entry is ScopusEntry & { 'dc:title': string; 'prism:doi': string } =>
        !!entry['dc:title'] && !!entry['prism:doi']
      )
      .map(entry => ({
        title: entry['dc:title'],
        journal: entry['prism:publicationName'] || 'Unknown Journal',
        year: entry['prism:coverDate']?.split('-')[0] || 'Unknown Year',
        authors: entry['dc:creator'] || 'Unknown Authors',
        doi: entry['prism:doi']
      }));
  } catch (error) {
    console.error('Scopus search error:', error);
    return [];
  }
}

/**
 * Look up a single paper by DOI
 */
export async function lookupByDoi(doi: string): Promise<Paper | null> {
  const url = new URL(env.SCOPUS_API_URL);
  url.searchParams.set('query', `DOI(${doi})`);
  url.searchParams.set('view', 'STANDARD');
  url.searchParams.set('count', '1');

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'X-ELS-APIKey': env.SCOPUS_API_KEY,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      console.error(`Scopus DOI lookup error: ${response.status}`);
      return null;
    }

    const data = await response.json() as ScopusResponse;
    const entries = data['search-results']?.entry || [];

    if (entries.length === 0 || !entries[0]['dc:title']) {
      return {
        title: 'Title Not Found',
        journal: 'Unknown Journal',
        year: 'Unknown Year',
        authors: 'Unknown Authors',
        doi
      };
    }

    const entry = entries[0];
    return {
      title: entry['dc:title'] || 'Unknown Title',
      journal: entry['prism:publicationName'] || 'Unknown Journal',
      year: entry['prism:coverDate']?.split('-')[0] || 'Unknown Year',
      authors: entry['dc:creator'] || 'Unknown Authors',
      doi
    };
  } catch (error) {
    console.error('Scopus DOI lookup error:', error);
    return null;
  }
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

/**
 * Process a list of DOIs and return paper details
 */
export async function processDOIList(
  dois: string[],
  onProgress?: (current: number, total: number) => void
): Promise<Paper[]> {
  const results: Paper[] = [];
  const validDois = dois
    .map(cleanDoi)
    .filter((doi): doi is string => doi !== null);

  for (let i = 0; i < validDois.length; i++) {
    const doi = validDois[i];
    const paper = await lookupByDoi(doi);

    if (paper) {
      results.push(paper);
    }

    onProgress?.(i + 1, validDois.length);

    // Rate limiting - 1 second delay between requests
    if (i < validDois.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  return results;
}
