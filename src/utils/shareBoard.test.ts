import { describe, expect, it } from 'vitest';
import { wrapLines } from './shareBoard';

// One unit per character keeps the widths readable.
const measure = (s: string) => s.length;

describe('wrapLines', () => {
  it('breaks a string between words', () => {
    expect(wrapLines('one two three four', 9, measure)).toEqual(['one two', 'three', 'four']);
  });

  it('breaks a list between items, never inside one', () => {
    // "Puka Nacua 2g" is 13 wide: it stays whole on its own line even
    // though a word break would fit more on the first.
    const items = ['Breece Hall 5g', 'Puka Nacua 2g', 'Jordan Mason 5g'];
    expect(wrapLines(items, 20, measure)).toEqual(['Breece Hall 5g', 'Puka Nacua 2g', 'Jordan Mason 5g']);
    expect(wrapLines(['A 1', 'B 2', 'C 3'], 20, measure)).toEqual(['A 1  ·  B 2  ·  C 3']);
  });

  it('keeps an item wider than the column on its own line', () => {
    expect(wrapLines(['Christian McCaffrey 1g -15.1', 'X'], 10, measure)).toEqual([
      'Christian McCaffrey 1g -15.1',
      'X',
    ]);
  });

  it('ends on an ellipsis past the line cap', () => {
    const lines = wrapLines(['a', 'b', 'c', 'd', 'e'], 1, measure, 3);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('c  ·  …');
  });

  it('returns nothing for empty content', () => {
    expect(wrapLines('', 10, measure)).toEqual([]);
    expect(wrapLines([], 10, measure)).toEqual([]);
  });
});
