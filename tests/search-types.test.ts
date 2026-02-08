import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseYearFilter } from '../src/lib/types/search.ts';

describe('parseYearFilter', () => {
  it('returns undefined for empty input', () => {
    assert.equal(parseYearFilter(), undefined);
    assert.equal(parseYearFilter(''), undefined);
    assert.equal(parseYearFilter('  '), undefined);
  });

  it('parses year range', () => {
    const result = parseYearFilter('2020-2024');
    assert.deepEqual(result, { startYear: 2020, endYear: 2024 });
  });

  it('parses single year', () => {
    const result = parseYearFilter('2023');
    assert.deepEqual(result, { startYear: 2023, endYear: 2023 });
  });

  it('handles whitespace around years', () => {
    const result = parseYearFilter(' 2020 - 2024 ');
    assert.deepEqual(result, { startYear: 2020, endYear: 2024 });
  });

  it('returns undefined for invalid input', () => {
    assert.equal(parseYearFilter('abc'), undefined);
    assert.equal(parseYearFilter('abc-def'), undefined);
  });
});
