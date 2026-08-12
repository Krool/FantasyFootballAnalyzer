import { describe, it, expect, beforeEach, vi } from 'vitest';
import { vibrate } from './haptics';

function stubMatchMedia(reduced: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('reduce') ? reduced : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe('vibrate', () => {
  beforeEach(() => {
    stubMatchMedia(false);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
  });

  it('calls navigator.vibrate with the given pattern when supported', () => {
    const vibrateFn = vi.fn();
    vi.stubGlobal('navigator', { vibrate: vibrateFn });
    vibrate([60, 30, 60]);
    expect(vibrateFn).toHaveBeenCalledWith([60, 30, 60]);
  });

  it('no-ops when the Vibration API is missing (iOS Safari)', () => {
    vi.stubGlobal('navigator', {});
    expect(() => vibrate(40)).not.toThrow();
  });

  it('no-ops in a background tab', () => {
    const vibrateFn = vi.fn();
    vi.stubGlobal('navigator', { vibrate: vibrateFn });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    vibrate(40);
    expect(vibrateFn).not.toHaveBeenCalled();
  });

  it('no-ops under prefers-reduced-motion', () => {
    stubMatchMedia(true);
    const vibrateFn = vi.fn();
    vi.stubGlobal('navigator', { vibrate: vibrateFn });
    vibrate(40);
    expect(vibrateFn).not.toHaveBeenCalled();
  });

  it('survives navigator.vibrate throwing', () => {
    const vibrateFn = vi.fn(() => {
      throw new Error('nope');
    });
    vi.stubGlobal('navigator', { vibrate: vibrateFn });
    expect(() => vibrate(40)).not.toThrow();
  });
});
