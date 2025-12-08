import type { Paper } from '../types';
import { searchScopus, lookupByDoi as lookupByDoiScopus, processDOIList as processDOIListScopus, cleanDoi } from './scopus.service';
import { searchOpenAlex, lookupByDoiOpenAlex, processDOIListOpenAlex } from './openalex.service';

export interface SearchParams {
  query: string;
  startYear?: number;
  endYear?: number;
  count?: number;
}

// Check if Scopus is available
const SCOPUS_API_KEY = process.env.SCOPUS_API_KEY;
const useScopus = !!SCOPUS_API_KEY && SCOPUS_API_KEY.length > 0;

export const searchProvider = useScopus ? 'Scopus' : 'OpenAlex';

/**
 * Search for papers using available provider (Scopus or OpenAlex)
 */
export async function searchPapers(params: SearchParams): Promise<Paper[]> {
  if (useScopus) {
    return searchScopus(params);
  }
  return searchOpenAlex(params);
}

/**
 * Look up a single paper by DOI
 */
export async function lookupByDoi(doi: string): Promise<Paper | null> {
  if (useScopus) {
    return lookupByDoiScopus(doi);
  }
  return lookupByDoiOpenAlex(doi);
}

/**
 * Process a list of DOIs and return paper details
 */
export async function processDOIList(
  dois: string[],
  onProgress?: (current: number, total: number) => void
): Promise<Paper[]> {
  // Clean DOIs first (reuse from scopus service)
  const validDois = dois
    .map(cleanDoi)
    .filter((doi): doi is string => doi !== null);

  if (useScopus) {
    return processDOIListScopus(validDois, onProgress);
  }
  return processDOIListOpenAlex(validDois, onProgress);
}

// Re-export cleanDoi for convenience
export { cleanDoi } from './scopus.service';
