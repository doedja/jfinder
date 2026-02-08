import { z } from 'zod';
import type { Paper } from '../types';
import type {
  LLMGapAnalysis,
  LLMComparisonAnalysis,
  LLMDirectionSuggestion
} from '../types/gap-analysis';
import { env } from '../env';
import { withRetryNullable } from '../utils/retry';
import { logger } from '../utils/logger';

const log = logger.child({ svc: 'openrouter' });

// Zod schemas for LLM response validation
const gapAnalysisSchema = z.object({
  gaps: z.array(z.object({
    title: z.string(),
    type: z.enum(['under-researched-topic', 'methodological-gap', 'theoretical-gap', 'temporal-gap', 'geographical-gap', 'contradictory-findings']),
    severity: z.enum(['high', 'medium', 'low']),
    description: z.string(),
    suggestedApproach: z.string().optional()
  })),
  observations: z.array(z.string())
});

const comparisonSchema = z.object({
  methodologies: z.array(z.string()),
  contradictions: z.array(z.string()),
  commonApproaches: z.array(z.string()),
  uniqueContributions: z.array(z.string())
});

const directionsSchema = z.object({
  directions: z.array(z.object({
    title: z.string(),
    description: z.string(),
    rationale: z.string(),
    methodology: z.string(),
    feasibility: z.enum(['high', 'medium', 'low']),
    novelty: z.enum(['high', 'medium', 'low'])
  }))
});

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenRouterResponse {
  choices?: {
    message: {
      content: string;
    };
  }[];
}

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const OPENROUTER_HEADERS = {
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://jfinder.doedja.com',
  'X-Title': 'JFinder'
};

/**
 * Call OpenRouter API with messages (single attempt)
 */
async function callOpenRouterOnce(
  messages: OpenRouterMessage[],
  temperature = 0.3,
  timeoutMs = 60000
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        ...OPENROUTER_HEADERS,
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: env.OPENROUTER_MODEL,
        messages,
        temperature
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      log.error('OpenRouter API error', { status: response.status });
      return null;
    }

    const data = await response.json() as OpenRouterResponse;
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      log.error('OpenRouter request timeout');
    } else {
      log.error('OpenRouter error', { error: String(error) });
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call OpenRouter API with messages and retry on failure
 */
async function callOpenRouter(
  messages: OpenRouterMessage[],
  temperature = 0.3,
  timeoutMs = 60000
): Promise<string | null> {
  return withRetryNullable(
    () => callOpenRouterOnce(messages, temperature, timeoutMs),
    2,
    2000
  );
}

/**
 * Clean and validate a Scopus query
 */
function cleanQuery(query: string): string | null {
  const cleaned = query.trim();
  if (!cleaned || !cleaned.includes('TITLE-ABS-KEY')) {
    return null;
  }

  // Convert comma-separated terms to OR if needed
  if (cleaned.includes(',') && !cleaned.includes('OR') && !cleaned.includes('AND')) {
    const match = cleaned.match(/TITLE-ABS-KEY\(([^)]+)\)/);
    if (match) {
      const terms = match[1].split(',').map(t => t.trim().replace(/"/g, ''));
      return `TITLE-ABS-KEY(${terms.map(t => `"${t}"`).join(' OR ')})`;
    }
  }

  return cleaned;
}

/**
 * Pad queries to reach the required number
 */
function padQueries(queries: string[], numCycles: number, topic: string): string[] {
  const result = [...queries];

  while (result.length < numCycles) {
    const lastQuery = result[result.length - 1] || `TITLE-ABS-KEY("${topic}")`;

    // Create broader version by removing AND conditions
    if (lastQuery.includes(' AND ')) {
      result.push(lastQuery.split(' AND ')[0]);
    } else {
      // Create a simple fallback query
      result.push(`TITLE-ABS-KEY("${topic}")`);
    }
  }

  return result.slice(0, numCycles);
}

/**
 * Generate multiple search queries for a research topic
 */
export async function generateSearchQueries(
  topic: string,
  numCycles: number,
  previousResults?: Paper[]
): Promise<string[]> {
  let prompt: string;

  if (previousResults && previousResults.length > 0) {
    // Create prompt for broader search based on previous results
    const papersText = previousResults
      .slice(0, 3)
      .map(r => `Title: ${r.title}\nJournal: ${r.journal}`)
      .join('\n\n');

    prompt = `Based on these few found papers and the original topic, generate ${numCycles} broader Scopus search queries.
Use fewer AND operators and more OR operators to get more results.

Original Topic: ${topic}

Found Papers:
${papersText}

Requirements:
1. Make queries progressively broader
2. Use mostly OR operators between related terms
3. Only use AND when absolutely necessary
4. Include related fields and applications
5. Use proper quotation marks for phrases

Format each line as:
TITLE-ABS-KEY("term1" OR "synonym1" OR "related1")
or
TITLE-ABS-KEY("term1" OR "synonym1") AND TITLE-ABS-KEY("term2" OR "synonym2")

Example broadening:
Narrow: TITLE-ABS-KEY("voice synthesis" AND "emotion recognition")
Broader: TITLE-ABS-KEY("voice synthesis" OR "speech synthesis" OR "audio processing")`;
  } else {
    // Initial search prompt
    prompt = `Generate ${numCycles} different Scopus search queries for this research topic.
Start specific, then broaden the scope. Prefer OR operators over AND to get more results.

Research Topic: ${topic}

Requirements:
1. First query: specific to the topic
2. Later queries: progressively broader terms
3. Use OR operators for related terms
4. Minimize AND operators (max 2 per query)
5. Include related fields and applications
6. Use proper quotation marks for phrases

Format each line as:
TITLE-ABS-KEY("term1" OR "synonym1" OR "related1")
or
TITLE-ABS-KEY("term1" OR "synonym1") AND TITLE-ABS-KEY("term2" OR "synonym2")

Example for "AI voice synthesis":
TITLE-ABS-KEY("voice synthesis" OR "speech synthesis")
TITLE-ABS-KEY("speech technology" OR "voice processing" OR "audio synthesis")
TITLE-ABS-KEY("voice synthesis" OR "speech synthesis") AND TITLE-ABS-KEY("artificial intelligence")`;
  }

  const messages: OpenRouterMessage[] = [
    {
      role: 'system',
      content: 'You are a research expert. Generate exactly the requested number of search queries, one per line. Each query must be in proper Scopus format.'
    },
    {
      role: 'user',
      content: prompt
    }
  ];

  const response = await callOpenRouter(messages);

  if (!response) {
    return padQueries([], numCycles, topic);
  }

  const queries = response
    .split('\n')
    .map(cleanQuery)
    .filter((q): q is string => q !== null);

  return padQueries(queries, numCycles, topic);
}

/**
 * Analyze research results and suggest related directions
 */
export async function analyzeResults(results: Paper[]): Promise<string | null> {
  if (results.length === 0) {
    return null;
  }

  const titlesText = results
    .slice(0, 10)
    .map(r => r.title)
    .join('\n');

  const prompt = `Based on these research paper titles, suggest 2-3 related research directions or gaps that could be explored. Be concise.

Titles:
${titlesText}`;

  const messages: OpenRouterMessage[] = [
    {
      role: 'system',
      content: 'You are a research advisor. Provide brief, actionable suggestions for further research.'
    },
    {
      role: 'user',
      content: prompt
    }
  ];

  return callOpenRouter(messages, 0.5);
}

/**
 * Analyze papers to identify research gaps using LLM
 */
export async function analyzeGaps(
  papers: Paper[],
  topic: string
): Promise<LLMGapAnalysis | null> {
  if (papers.length === 0) {
    return null;
  }

  const papersText = papers
    .slice(0, 15)
    .map((p, i) => {
      let entry = `${i + 1}. "${p.title}" (${p.year}) - ${p.journal}`;
      if (p.abstract) {
        entry += `\n   Abstract: ${p.abstract.substring(0, 300)}${p.abstract.length > 300 ? '...' : ''}`;
      }
      return entry;
    })
    .join('\n\n');

  const prompt = `Analyze these research papers on "${topic}" to identify gaps in the literature.

Papers:
${papersText}

Identify 3-5 research gaps. For each gap, provide:
1. A concise title
2. The type: under-researched-topic, methodological-gap, theoretical-gap, temporal-gap, geographical-gap, or contradictory-findings
3. Severity: high, medium, or low
4. A brief description (2-3 sentences)
5. A suggested approach to address it (optional)

Also list 3-5 general observations about the current state of research.

Respond in this exact JSON format:
{
  "gaps": [
    {
      "title": "...",
      "type": "under-researched-topic",
      "severity": "high",
      "description": "...",
      "suggestedApproach": "..."
    }
  ],
  "observations": ["observation 1", "observation 2"]
}`;

  const messages: OpenRouterMessage[] = [
    {
      role: 'system',
      content: 'You are a research methodology expert specializing in literature review and gap analysis. Provide structured analysis in valid JSON format only.'
    },
    {
      role: 'user',
      content: prompt
    }
  ];

  const response = await callOpenRouter(messages, 0.4, 90000);

  if (!response) {
    return null;
  }

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const raw = JSON.parse(jsonMatch[0]);
    const validated = gapAnalysisSchema.safeParse(raw);
    if (!validated.success) {
      log.warn('LLM gap analysis validation failed', { issues: validated.error.issues });
      // Fall back to partial data with safe defaults
      return {
        gaps: (raw.gaps || []).map((g: any) => ({
          title: g.title || 'Unknown Gap',
          type: g.type || 'under-researched-topic',
          severity: g.severity || 'medium',
          description: g.description || '',
          suggestedApproach: g.suggestedApproach
        })),
        observations: raw.observations || []
      } as LLMGapAnalysis;
    }
    return validated.data as LLMGapAnalysis;
  } catch (error) {
    log.error('Failed to parse gap analysis response', { error: String(error) });
    return null;
  }
}

/**
 * Compare methodologies across papers using LLM
 */
export async function compareMethodologies(
  papers: Paper[],
  topic: string
): Promise<LLMComparisonAnalysis | null> {
  if (papers.length < 2) {
    return null;
  }

  const papersText = papers
    .slice(0, 12)
    .map((p, i) => {
      let entry = `${i + 1}. "${p.title}" (${p.year})`;
      if (p.abstract) {
        entry += `\n   Abstract: ${p.abstract.substring(0, 250)}${p.abstract.length > 250 ? '...' : ''}`;
      }
      return entry;
    })
    .join('\n\n');

  const prompt = `Compare the methodological approaches in these research papers on "${topic}".

Papers:
${papersText}

Analyze and identify:
1. The different methodologies used (list each methodology found)
2. Any contradictory findings or conflicting conclusions
3. Common approaches shared across multiple papers
4. Unique contributions or novel methods from individual papers

Respond in this exact JSON format:
{
  "methodologies": ["methodology 1", "methodology 2"],
  "contradictions": ["contradiction 1 if any"],
  "commonApproaches": ["common approach 1", "common approach 2"],
  "uniqueContributions": ["unique contribution 1", "unique contribution 2"]
}`;

  const messages: OpenRouterMessage[] = [
    {
      role: 'system',
      content: 'You are a research methodology expert. Analyze paper titles to infer likely methodologies and provide structured comparison in valid JSON format only.'
    },
    {
      role: 'user',
      content: prompt
    }
  ];

  const response = await callOpenRouter(messages, 0.3, 90000);

  if (!response) {
    return null;
  }

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const raw = JSON.parse(jsonMatch[0]);
    const validated = comparisonSchema.safeParse(raw);
    if (!validated.success) {
      log.warn('LLM comparison validation failed', { issues: validated.error.issues });
      return {
        methodologies: raw.methodologies || [],
        contradictions: raw.contradictions || [],
        commonApproaches: raw.commonApproaches || [],
        uniqueContributions: raw.uniqueContributions || []
      } as LLMComparisonAnalysis;
    }
    return validated.data as LLMComparisonAnalysis;
  } catch (error) {
    log.error('Failed to parse comparison response', { error: String(error) });
    return null;
  }
}

/**
 * Generate research direction suggestions using LLM
 */
export async function suggestDirections(
  papers: Paper[],
  gaps: { title: string; description: string }[],
  topic: string
): Promise<LLMDirectionSuggestion[] | null> {
  const papersText = papers
    .slice(0, 10)
    .map((p, i) => {
      let entry = `${i + 1}. "${p.title}" (${p.year})`;
      if (p.abstract) {
        entry += `\n   Abstract: ${p.abstract.substring(0, 200)}${p.abstract.length > 200 ? '...' : ''}`;
      }
      return entry;
    })
    .join('\n\n');

  const gapsText = gaps
    .slice(0, 5)
    .map((g, i) => `${i + 1}. ${g.title}: ${g.description}`)
    .join('\n');

  const prompt = `Based on these papers and identified gaps, suggest 3-5 promising research directions for "${topic}".

Existing Papers:
${papersText}

Identified Gaps:
${gapsText}

For each direction, provide:
1. A compelling title
2. A clear description (2-3 sentences)
3. Rationale explaining why this direction is valuable
4. Suggested methodology
5. Feasibility assessment: high (straightforward), medium (some challenges), or low (significant challenges)
6. Novelty assessment: high (highly original), medium (builds on existing), or low (incremental)

Respond in this exact JSON format:
{
  "directions": [
    {
      "title": "...",
      "description": "...",
      "rationale": "...",
      "methodology": "...",
      "feasibility": "medium",
      "novelty": "high"
    }
  ]
}`;

  const messages: OpenRouterMessage[] = [
    {
      role: 'system',
      content: 'You are a senior research advisor helping identify promising research opportunities. Provide creative yet feasible suggestions in valid JSON format only.'
    },
    {
      role: 'user',
      content: prompt
    }
  ];

  const response = await callOpenRouter(messages, 0.6, 90000);

  if (!response) {
    return null;
  }

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const raw = JSON.parse(jsonMatch[0]);
    const validated = directionsSchema.safeParse(raw);
    if (!validated.success) {
      log.warn('LLM directions validation failed', { issues: validated.error.issues });
      // Fall back to partial data
      const dirs = raw.directions || [];
      return dirs.map((d: any) => ({
        title: d.title || 'Unknown Direction',
        description: d.description || '',
        rationale: d.rationale || '',
        methodology: d.methodology || '',
        feasibility: d.feasibility || 'medium',
        novelty: d.novelty || 'medium'
      })) as LLMDirectionSuggestion[];
    }
    return validated.data.directions as LLMDirectionSuggestion[];
  } catch (error) {
    log.error('Failed to parse direction suggestions', { error: String(error) });
    return null;
  }
}

/**
 * Generate a comprehensive gap analysis summary
 */
export async function generateGapSummary(
  topic: string,
  papersCount: number,
  gapsCount: number,
  topGaps: string[],
  topDirections: string[]
): Promise<string | null> {
  const prompt = `Write a concise executive summary (3-4 paragraphs) of this research gap analysis.

Topic: ${topic}
Papers Analyzed: ${papersCount}
Gaps Identified: ${gapsCount}

Key Gaps Found:
${topGaps.map((g, i) => `${i + 1}. ${g}`).join('\n')}

Recommended Research Directions:
${topDirections.map((d, i) => `${i + 1}. ${d}`).join('\n')}

The summary should:
1. Briefly describe the current state of research
2. Highlight the most significant gaps
3. Explain why the recommended directions are valuable
4. Conclude with actionable next steps for researchers`;

  const messages: OpenRouterMessage[] = [
    {
      role: 'system',
      content: 'You are an expert research consultant writing executive summaries for academic stakeholders. Be concise, professional, and actionable.'
    },
    {
      role: 'user',
      content: prompt
    }
  ];

  return callOpenRouter(messages, 0.5, 60000);
}
