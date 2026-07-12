import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraftQueue } from './useDraftQueue';

const KEY = 'sleeper:test-league:2026';

beforeEach(() => {
  localStorage.clear();
});

describe('useDraftQueue', () => {
  it('starts empty and toggles players in and out', () => {
    const { result } = renderHook(() => useDraftQueue(KEY));
    expect(result.current.ids).toEqual([]);

    act(() => result.current.toggle('a'));
    act(() => result.current.toggle('b'));
    expect(result.current.ids).toEqual(['a', 'b']);
    expect(result.current.queued.has('a')).toBe(true);

    act(() => result.current.toggle('a'));
    expect(result.current.ids).toEqual(['b']);
    expect(result.current.queued.has('a')).toBe(false);
  });

  it('persists across mounts, keyed by league', () => {
    const first = renderHook(() => useDraftQueue(KEY));
    act(() => first.result.current.toggle('a'));
    act(() => first.result.current.toggle('b'));
    first.unmount();

    const again = renderHook(() => useDraftQueue(KEY));
    expect(again.result.current.ids).toEqual(['a', 'b']);

    const other = renderHook(() => useDraftQueue('yahoo:other:2026'));
    expect(other.result.current.ids).toEqual([]);
  });

  it('reorders with move and clamps at the ends', () => {
    const { result } = renderHook(() => useDraftQueue(KEY));
    act(() => {
      result.current.toggle('a');
      result.current.toggle('b');
      result.current.toggle('c');
    });

    act(() => result.current.move('c', -1));
    expect(result.current.ids).toEqual(['a', 'c', 'b']);

    // Already first / already last: no-ops.
    act(() => result.current.move('a', -1));
    act(() => result.current.move('b', 1));
    expect(result.current.ids).toEqual(['a', 'c', 'b']);

    act(() => result.current.remove('c'));
    expect(result.current.ids).toEqual(['a', 'b']);

    act(() => result.current.clear());
    expect(result.current.ids).toEqual([]);
  });

  it('survives corrupt stored JSON', () => {
    localStorage.setItem(`ffa:draftQueue:v1:${KEY}`, '{not json');
    const { result } = renderHook(() => useDraftQueue(KEY));
    expect(result.current.ids).toEqual([]);

    localStorage.setItem(`ffa:draftQueue:v1:${KEY}`, JSON.stringify([1, 'ok', null]));
    const again = renderHook(() => useDraftQueue(KEY));
    expect(again.result.current.ids).toEqual(['ok']);
  });
});
