import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSafeFilename, isValidTaskId, parseDOIList, cleanDoi } from '../src/lib/utils/file-utils.ts';

describe('createSafeFilename', () => {
  it('replaces special characters with underscores', () => {
    assert.equal(createSafeFilename('hello/world:test'), 'hello_world_test');
  });

  it('replaces spaces with underscores', () => {
    assert.equal(createSafeFilename('hello world'), 'hello_world');
  });

  it('collapses multiple underscores', () => {
    assert.equal(createSafeFilename('a///b///c'), 'a_b_c');
  });

  it('truncates to maxLength', () => {
    const long = 'a'.repeat(200);
    assert.equal(createSafeFilename(long, 50).length, 50);
  });

  it('removes trailing underscore', () => {
    assert.equal(createSafeFilename('test_'), 'test');
  });

  it('handles empty string', () => {
    assert.equal(createSafeFilename(''), '');
  });

  it('preserves hyphens and underscores', () => {
    assert.equal(createSafeFilename('my-file_name'), 'my-file_name');
  });
});

describe('isValidTaskId', () => {
  it('accepts valid UUID', () => {
    assert.equal(isValidTaskId('550e8400-e29b-41d4-a716-446655440000'), true);
  });

  it('accepts uppercase UUID', () => {
    assert.equal(isValidTaskId('550E8400-E29B-41D4-A716-446655440000'), true);
  });

  it('rejects empty string', () => {
    assert.equal(isValidTaskId(''), false);
  });

  it('rejects path traversal', () => {
    assert.equal(isValidTaskId('../../etc'), false);
  });

  it('rejects partial UUID', () => {
    assert.equal(isValidTaskId('550e8400-e29b'), false);
  });

  it('rejects non-hex characters', () => {
    assert.equal(isValidTaskId('550e8400-e29b-41d4-a716-44665544gggg'), false);
  });
});

describe('cleanDoi', () => {
  it('accepts valid DOI', () => {
    assert.equal(cleanDoi('10.1234/test'), '10.1234/test');
  });

  it('extracts DOI from URL', () => {
    assert.equal(cleanDoi('https://doi.org/10.1234/test'), '10.1234/test');
  });

  it('removes @ prefix', () => {
    assert.equal(cleanDoi('@10.1234/test'), '10.1234/test');
  });

  it('trims whitespace', () => {
    assert.equal(cleanDoi('  10.1234/test  '), '10.1234/test');
  });

  it('rejects invalid DOI', () => {
    assert.equal(cleanDoi('not-a-doi'), null);
  });

  it('rejects empty string', () => {
    assert.equal(cleanDoi(''), null);
  });
});

describe('parseDOIList', () => {
  it('parses newline-separated DOIs', () => {
    const result = parseDOIList('10.1234/a\n10.5678/b');
    assert.deepEqual(result, ['10.1234/a', '10.5678/b']);
  });

  it('skips empty lines', () => {
    const result = parseDOIList('10.1234/a\n\n\n10.5678/b');
    assert.deepEqual(result, ['10.1234/a', '10.5678/b']);
  });

  it('filters invalid DOIs', () => {
    const result = parseDOIList('10.1234/a\nnot-a-doi\n10.5678/b');
    assert.deepEqual(result, ['10.1234/a', '10.5678/b']);
  });

  it('handles URLs in DOI list', () => {
    const result = parseDOIList('https://doi.org/10.1234/a\n10.5678/b');
    assert.deepEqual(result, ['10.1234/a', '10.5678/b']);
  });

  it('returns empty for empty input', () => {
    assert.deepEqual(parseDOIList(''), []);
  });
});
