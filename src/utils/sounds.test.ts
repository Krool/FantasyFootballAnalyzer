import { describe, it, expect, beforeEach, vi } from 'vitest';

// Records every node the sounds module creates so tests can assert on the
// scheduling (audio-clock offsets, envelope targets) without real audio.

interface RampCall {
  method: 'setValueAtTime' | 'linearRampToValueAtTime' | 'exponentialRampToValueAtTime';
  value: number;
  time: number;
}

class MockParam {
  value = 0;
  calls: RampCall[] = [];
  setValueAtTime(value: number, time: number) {
    this.calls.push({ method: 'setValueAtTime', value, time });
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.calls.push({ method: 'linearRampToValueAtTime', value, time });
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.calls.push({ method: 'exponentialRampToValueAtTime', value, time });
  }
}

class MockNode {
  connect = vi.fn();
}

class MockGain extends MockNode {
  gain = new MockParam();
}

class MockOscillator extends MockNode {
  type = 'sine';
  frequency = new MockParam();
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  start(when: number) {
    this.startedAt = when;
  }
  stop(when: number) {
    this.stoppedAt = when;
  }
}

class MockFilter extends MockNode {
  type = '';
  frequency = new MockParam();
  Q = new MockParam();
}

class MockAudioContext {
  static instances: MockAudioContext[] = [];
  currentTime = 100; // nonzero so a forgotten `now +` offset shows up
  state = 'running';
  destination = new MockNode();
  oscillators: MockOscillator[] = [];
  gains: MockGain[] = [];
  filters: MockFilter[] = [];
  resume = vi.fn();
  constructor() {
    MockAudioContext.instances.push(this);
  }
  createGain() {
    const g = new MockGain();
    this.gains.push(g);
    return g;
  }
  createOscillator() {
    const o = new MockOscillator();
    this.oscillators.push(o);
    return o;
  }
  createBiquadFilter() {
    const f = new MockFilter();
    this.filters.push(f);
    return f;
  }
}

type Sounds = typeof import('./sounds');

let sounds: Sounds;

beforeEach(async () => {
  MockAudioContext.instances = [];
  vi.stubGlobal('AudioContext', MockAudioContext);
  vi.resetModules();
  sounds = await import('./sounds');
  sounds.setMuted(false);
});

function ctx(): MockAudioContext {
  expect(MockAudioContext.instances.length).toBeGreaterThan(0);
  return MockAudioContext.instances[0];
}

describe('sounds', () => {
  it('routes the master chain through a lowpass softener', () => {
    sounds.playClick();
    const c = ctx();
    expect(c.filters).toHaveLength(1);
    expect(c.filters[0].type).toBe('lowpass');
    expect(c.filters[0].connect).toHaveBeenCalledWith(c.destination);
  });

  it('schedules multi-note phrases on the audio clock, not timers', () => {
    vi.useFakeTimers();
    try {
      sounds.playLoadComplete();
      const c = ctx();
      // All three notes exist immediately, before any timer could fire.
      // Each note is an oscillator plus its shimmer octave, so count the
      // distinct start times.
      const starts = [...new Set(c.oscillators.map(o => o.startedAt!))].sort((a, b) => a - b);
      expect(starts).toHaveLength(3);
      expect(starts[0]).toBe(c.currentTime);
      expect(starts[1]).toBeGreaterThan(starts[0]);
      expect(starts[2]).toBeGreaterThan(starts[1]);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps every exponential ramp target above zero', () => {
    sounds.playSuccess();
    sounds.playError();
    sounds.playOnTheClock();
    sounds.playGradeGreat();
    for (const g of ctx().gains) {
      for (const call of g.gain.calls) {
        if (call.method === 'exponentialRampToValueAtTime') {
          expect(call.value).toBeGreaterThan(0);
        }
      }
    }
  });

  it('stops every oscillator shortly after its note ends', () => {
    sounds.playPageTransition();
    for (const o of ctx().oscillators) {
      expect(o.stoppedAt).toBeGreaterThan(o.startedAt!);
      expect(o.stoppedAt! - o.startedAt!).toBeLessThan(1);
    }
  });

  it('plays nothing while muted and resumes when unmuted', () => {
    sounds.setMuted(true);
    sounds.playClick();
    expect(MockAudioContext.instances).toHaveLength(0);
    sounds.setMuted(false);
    sounds.playClick();
    expect(ctx().oscillators.length).toBeGreaterThan(0);
  });

  it('resumes a suspended context before playing', () => {
    sounds.initAudio();
    const c = ctx();
    c.state = 'suspended';
    sounds.playClick();
    expect(c.resume).toHaveBeenCalled();
  });

  it('survives a missing AudioContext without throwing', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => sounds.playClick()).not.toThrow();
    expect(() => sounds.playOnTheClock()).not.toThrow();
    expect(() => sounds.initAudio()).not.toThrow();
  });

  it('toggleMute silences the master gain and reports state', () => {
    sounds.initAudio();
    const master = ctx().gains[0];
    expect(sounds.toggleMute()).toBe(true);
    expect(master.gain.value).toBe(0);
    expect(sounds.getMuted()).toBe(true);
    expect(sounds.toggleMute()).toBe(false);
    expect(master.gain.value).toBeGreaterThan(0);
  });
});
