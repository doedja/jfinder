import type { APIRoute } from 'astro';

const OPENALEX_AUTOCOMPLETE = 'https://api.openalex.org/autocomplete/concepts';
const MAILTO = 'jfinder@doedja.com';

interface AutocompleteResult {
  id: string;
  display_name: string;
  works_count: number;
  cited_by_count: number;
}

interface AutocompleteResponse {
  results?: AutocompleteResult[];
}

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim();

  if (!q || q.length < 2) {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const apiUrl = `${OPENALEX_AUTOCOMPLETE}?q=${encodeURIComponent(q)}&mailto=${MAILTO}`;
    const response = await fetch(apiUrl, {
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      return new Response(JSON.stringify([]), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json() as AutocompleteResponse;
    const suggestions = (data.results || [])
      .slice(0, 8)
      .map(r => ({
        name: r.display_name,
        works: r.works_count
      }));

    return new Response(JSON.stringify(suggestions), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300'
      }
    });
  } catch {
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
