import type { APIRoute } from 'astro';
import { getCitedBy, getReferences } from '../../../lib/services/openalex.service';
import { logger } from '../../../lib/utils/logger';

export const GET: APIRoute = async ({ params, url }) => {
  const { doi } = params;

  if (!doi) {
    return new Response(
      JSON.stringify({ error: 'DOI is required' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const direction = url.searchParams.get('direction') || 'both';
  const count = Math.min(parseInt(url.searchParams.get('count') || '10'), 25);

  try {
    const results: { citedBy: any[]; references: any[] } = {
      citedBy: [],
      references: []
    };

    if (direction === 'citedBy' || direction === 'both') {
      results.citedBy = await getCitedBy(doi, count);
    }

    if (direction === 'references' || direction === 'both') {
      results.references = await getReferences(doi, count);
    }

    return new Response(
      JSON.stringify(results),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    logger.error('Related papers error', { doi, error: String(error) });
    return new Response(
      JSON.stringify({ error: 'Failed to fetch related papers' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
