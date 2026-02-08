import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { papersToBibtex, papersToRis } from '../src/lib/utils/citation-export.ts';

const samplePaper = {
  title: 'Machine Learning in Healthcare',
  journal: 'Nature Medicine',
  year: '2023',
  authors: 'J. Smith, A. Doe, W. Zhang',
  doi: '10.1234/nm.2023.001',
  abstract: 'A comprehensive review of ML applications.'
};

const samplePaperNoDoi = {
  title: 'Another Paper',
  journal: 'Science',
  year: '2022',
  authors: 'B. Jones',
  doi: ''
};

describe('papersToBibtex', () => {
  it('generates valid BibTeX for a single paper', () => {
    const result = papersToBibtex([samplePaper]);
    assert.ok(result.includes('@article{'));
    assert.ok(result.includes('title = {Machine Learning in Healthcare}'));
    assert.ok(result.includes('author = {J. Smith and A. Doe and W. Zhang}'));
    assert.ok(result.includes('journal = {Nature Medicine}'));
    assert.ok(result.includes('year = {2023}'));
    assert.ok(result.includes('doi = {10.1234/nm.2023.001}'));
    assert.ok(result.includes('abstract = {A comprehensive review'));
  });

  it('uses DOI as BibTeX key', () => {
    const result = papersToBibtex([samplePaper]);
    assert.ok(result.includes('@article{10_1234_nm_2023_001'));
  });

  it('uses fallback key when no DOI', () => {
    const result = papersToBibtex([samplePaperNoDoi]);
    assert.ok(result.includes('@article{paper_1'));
  });

  it('separates multiple papers with blank lines', () => {
    const result = papersToBibtex([samplePaper, samplePaperNoDoi]);
    assert.ok(result.includes('}\n\n@article{'));
  });

  it('escapes special characters', () => {
    const paper = { ...samplePaper, title: 'Test & Analysis #1: 50%' };
    const result = papersToBibtex([paper]);
    assert.ok(result.includes('Test \\& Analysis \\#1: 50\\%'));
  });

  it('returns empty string for empty array', () => {
    assert.equal(papersToBibtex([]), '');
  });
});

describe('papersToRis', () => {
  it('generates valid RIS for a single paper', () => {
    const result = papersToRis([samplePaper]);
    assert.ok(result.includes('TY  - JOUR'));
    assert.ok(result.includes('TI  - Machine Learning in Healthcare'));
    assert.ok(result.includes('AU  - J. Smith'));
    assert.ok(result.includes('AU  - A. Doe'));
    assert.ok(result.includes('JO  - Nature Medicine'));
    assert.ok(result.includes('PY  - 2023'));
    assert.ok(result.includes('DO  - 10.1234/nm.2023.001'));
    assert.ok(result.includes('UR  - https://doi.org/10.1234/nm.2023.001'));
    assert.ok(result.includes('AB  - A comprehensive review'));
    assert.ok(result.includes('ER  - '));
  });

  it('separates multiple papers', () => {
    const result = papersToRis([samplePaper, samplePaperNoDoi]);
    const entries = result.split('ER  - ');
    assert.equal(entries.length, 3); // 2 entries + 1 trailing
  });

  it('omits DOI fields when no DOI', () => {
    const result = papersToRis([samplePaperNoDoi]);
    assert.ok(!result.includes('DO  - '));
    assert.ok(!result.includes('UR  - '));
  });

  it('returns empty string for empty array', () => {
    assert.equal(papersToRis([]), '');
  });
});
