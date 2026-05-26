package llm

const sysQueryGen = `You are a research expert. Generate search queries in proper Scopus format, one per line. Each line must match the TITLE-ABS-KEY(...) pattern. No commentary, no numbering, only the queries.`

const hdrQueryGenInitial = `Generate Scopus search queries for a research topic.

Requirements:
1. First query: specific to the topic.
2. Later queries: progressively broader.
3. Use OR operators for related terms; minimize AND (max 2 per query).
4. Use proper quotation marks for phrases.

Format each line as:
TITLE-ABS-KEY("term1" OR "synonym1" OR "related1")
or
TITLE-ABS-KEY("term1" OR "synonym1") AND TITLE-ABS-KEY("term2" OR "synonym2")

----- VARIABLE INPUT -----
`

const hdrQueryGenBroaden = `Generate broader Scopus search queries based on prior results.

Requirements:
1. Make queries progressively broader.
2. Use mostly OR operators between related terms.
3. Only use AND when absolutely necessary.
4. Include related fields and applications.
5. Use proper quotation marks for phrases.

Format each line as:
TITLE-ABS-KEY("term1" OR "synonym1" OR "related1")
or
TITLE-ABS-KEY("term1" OR "synonym1") AND TITLE-ABS-KEY("term2" OR "synonym2")

----- VARIABLE INPUT -----
`

const sysGapAnalysis = `You are a research methodology expert specializing in literature review and gap analysis. Output valid JSON only, in the exact schema provided. No prose outside JSON.`

const hdrGapAnalysis = `Analyze research papers to identify gaps in the literature.

Identify 3 to 5 research gaps. For each gap provide:
1. A concise title.
2. The type: under-researched-topic, methodological-gap, theoretical-gap, temporal-gap, geographical-gap, or contradictory-findings.
3. Severity: high, medium, or low.
4. A brief description (2 to 3 sentences).
5. A suggested approach to address it (optional).

Also list 3 to 5 general observations about the current state of research.

Respond in this exact JSON shape:
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
}

----- VARIABLE INPUT -----
`

const sysComparison = `You are a research methodology expert. Output valid JSON only, in the exact schema provided. No prose outside JSON.`

const hdrComparison = `Compare methodological approaches across research papers.

Identify:
1. Different methodologies used (list each).
2. Contradictory findings or conflicting conclusions.
3. Common approaches shared across multiple papers.
4. Unique contributions or novel methods from individual papers.

Respond in this exact JSON shape:
{
  "methodologies": ["..."],
  "contradictions": ["..."],
  "commonApproaches": ["..."],
  "uniqueContributions": ["..."]
}

----- VARIABLE INPUT -----
`

const sysDirections = `You are a senior research advisor. Output valid JSON only, in the exact schema provided. Provide creative yet feasible suggestions.`

const hdrDirections = `Suggest 3 to 5 promising research directions based on papers and identified gaps.

For each direction provide:
1. A compelling title.
2. A clear description (2 to 3 sentences).
3. Rationale explaining why this direction is valuable.
4. Suggested methodology.
5. Feasibility assessment: high, medium, or low.
6. Novelty assessment: high, medium, or low.

Respond in this exact JSON shape:
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
}

----- VARIABLE INPUT -----
`

const sysSummary = `You are an expert research consultant. Write a concise, professional executive summary for academic stakeholders. Plain prose, no markdown headings, 3 to 4 paragraphs.`

const hdrSummary = `Write a concise executive summary of a research gap analysis.

The summary should:
1. Briefly describe the current state of research.
2. Highlight the most significant gaps.
3. Explain why the recommended directions are valuable.
4. Conclude with actionable next steps for researchers.

----- VARIABLE INPUT -----
`
