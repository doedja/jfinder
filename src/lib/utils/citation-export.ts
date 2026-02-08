import type { Paper } from '../types';

/**
 * Convert a Paper to a BibTeX entry
 */
function paperToBibtex(paper: Paper, index: number): string {
  const key = paper.doi
    ? paper.doi.replace(/[^a-zA-Z0-9]/g, '_')
    : `paper_${index + 1}`;

  const authors = paper.authors
    .split(',')
    .map(a => a.trim())
    .join(' and ');

  const lines = [
    `@article{${key},`,
    `  title = {${escapeBibtex(paper.title)}},`,
    `  author = {${escapeBibtex(authors)}},`,
    `  journal = {${escapeBibtex(paper.journal)}},`,
    `  year = {${paper.year}},`,
  ];

  if (paper.doi) {
    lines.push(`  doi = {${paper.doi}},`);
  }

  if (paper.abstract) {
    lines.push(`  abstract = {${escapeBibtex(paper.abstract.substring(0, 1000))}},`);
  }

  // Remove trailing comma from last field
  const lastLine = lines[lines.length - 1];
  lines[lines.length - 1] = lastLine.replace(/,$/, '');

  lines.push('}');

  return lines.join('\n');
}

function escapeBibtex(text: string): string {
  return text
    .replace(/[{}]/g, '')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_');
}

/**
 * Convert an array of Papers to BibTeX format
 */
export function papersToBibtex(papers: Paper[]): string {
  return papers.map((p, i) => paperToBibtex(p, i)).join('\n\n');
}

/**
 * Convert a Paper to RIS format
 */
function paperToRis(paper: Paper): string {
  const lines = [
    'TY  - JOUR',
    `TI  - ${paper.title}`,
  ];

  // RIS expects one AU per author
  const authors = paper.authors.split(',').map(a => a.trim());
  for (const author of authors) {
    if (author) lines.push(`AU  - ${author}`);
  }

  lines.push(`JO  - ${paper.journal}`);
  lines.push(`PY  - ${paper.year}`);

  if (paper.doi) {
    lines.push(`DO  - ${paper.doi}`);
    lines.push(`UR  - https://doi.org/${paper.doi}`);
  }

  if (paper.abstract) {
    lines.push(`AB  - ${paper.abstract.substring(0, 1000)}`);
  }

  lines.push('ER  - ');

  return lines.join('\n');
}

/**
 * Convert an array of Papers to RIS format
 */
export function papersToRis(papers: Paper[]): string {
  return papers.map(p => paperToRis(p)).join('\n\n');
}
