import { describe, expect, it } from 'vitest';
import { cleanSleeperAdp } from './sleeperAdp';

describe('cleanSleeperAdp', () => {
  it('keeps real ADP', () => {
    expect(cleanSleeperAdp(1.2)).toBe(1.2);
    expect(cleanSleeperAdp(215.7)).toBe(215.7);
  });
  it('drops 999 and 999-padded averages', () => {
    expect(cleanSleeperAdp(999)).toBeNull();
    expect(cleanSleeperAdp(683.5)).toBeNull();
  });
  it('drops missing values', () => {
    expect(cleanSleeperAdp(undefined)).toBeNull();
    expect(cleanSleeperAdp(null)).toBeNull();
  });
});
