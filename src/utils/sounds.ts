// Soft chiptune-style sound effects using Web Audio API.
// Every phrase is scheduled on the audio clock (never setTimeout) so melodies
// stay tight even when the main thread is busy, and all voices run through a
// shared lowpass so nothing reaches the speaker with a harsh edge.

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let isMuted = false;

// Master volume (0-1) - kept low so the sounds sit under the UI
const MASTER_VOLUME = 0.08;
// Rounds off the top end of every voice (the square wave included) without
// dulling the tones themselves.
const MASTER_LOWPASS_HZ = 3200;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const softener = audioContext.createBiquadFilter();
    softener.type = 'lowpass';
    softener.frequency.value = MASTER_LOWPASS_HZ;
    softener.Q.value = 0.5;
    softener.connect(audioContext.destination);
    masterGain = audioContext.createGain();
    masterGain.gain.value = MASTER_VOLUME;
    masterGain.connect(softener);
  }
  return audioContext;
}

interface Note {
  freq: number;
  /** Seconds after the phrase starts, on the audio clock. Default 0. */
  at?: number;
  /** Total length including release. */
  dur: number;
  type?: OscillatorType;
  /** Per-note volume (0-1) under the master. */
  level?: number;
  attack?: number;
  release?: number;
  /** Decay from the attack peak immediately (marimba-style tap, no sustain). */
  pluck?: boolean;
  /** Level of a quiet octave-up sine layered over the note (0 = none). */
  shimmer?: number;
}

function scheduleNote(ctx: AudioContext, out: GainNode, start: number, n: Note): void {
  const {
    freq,
    dur,
    type = 'sine',
    level = 1,
    attack = 0.012,
    release = 0.1,
    pluck = false,
    shimmer = 0,
  } = n;

  const peak = Math.max(0.0001, level);
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0.0001, start);
  // Linear attack reads as soft; an exponential rise spends most of its time
  // near zero and lands like a click.
  envelope.gain.linearRampToValueAtTime(peak, start + attack);
  if (!pluck) {
    envelope.gain.setValueAtTime(peak, start + Math.max(attack, dur - release));
  }
  envelope.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  envelope.connect(out);

  const oscillator = ctx.createOscillator();
  oscillator.type = type;
  oscillator.frequency.value = freq;
  oscillator.connect(envelope);
  oscillator.start(start);
  oscillator.stop(start + dur + 0.02);

  if (shimmer > 0) {
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = shimmer;
    shimmerGain.connect(envelope);
    const octave = ctx.createOscillator();
    octave.type = 'sine';
    octave.frequency.value = freq * 2;
    octave.connect(shimmerGain);
    octave.start(start);
    octave.stop(start + dur + 0.02);
  }
}

function playPhrase(notes: Note[]): void {
  if (isMuted) return;

  // Web Audio can be unavailable (test environments) or blocked by the
  // browser. Sound is decoration; it must never break the interaction that
  // triggered it.
  try {
    const ctx = getAudioContext();
    // iOS suspends the context when the tab backgrounds; without a resume
    // every later sound dies silently until reload.
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    for (const note of notes) {
      scheduleNote(ctx, masterGain!, now + (note.at ?? 0), note);
    }
  } catch {
    // No audio available: stay silent.
  }
}

// All pitches are equal-temperament notes so overlapping sounds stay in tune
// with each other: B3 247, Eb4 311, E4 330, G4 392, A4 440, C5 523, C#5 554,
// D5 587, E5 659, G5 784, A5 880.

// Navigation click - soft, short tap
export function playClick(): void {
  playPhrase([{ freq: 523, dur: 0.1, pluck: true, level: 0.6, shimmer: 0.12 }]);
}

// Hover sound - barely there
export function playHover(): void {
  playPhrase([{ freq: 440, dur: 0.05, pluck: true, level: 0.3 }]);
}

// Success - gentle two-note rise (C5 to G5)
export function playSuccess(): void {
  playPhrase([
    { freq: 523, dur: 0.16, level: 0.65, shimmer: 0.1 },
    { freq: 784, at: 0.11, dur: 0.24, level: 0.65, shimmer: 0.12, release: 0.16 },
  ]);
}

// Error - soft descending pair (G4 to Eb4)
export function playError(): void {
  playPhrase([
    { freq: 392, dur: 0.16, type: 'triangle', level: 0.55, release: 0.12 },
    { freq: 311, at: 0.14, dur: 0.22, type: 'triangle', level: 0.55, release: 0.16 },
  ]);
}

// Grade reveal sounds
export function playGradeGreat(): void {
  playPhrase([
    { freq: 523, dur: 0.12, level: 0.65, shimmer: 0.1 },
    { freq: 659, at: 0.09, dur: 0.12, level: 0.65, shimmer: 0.1 },
    { freq: 784, at: 0.18, dur: 0.22, level: 0.65, shimmer: 0.12, release: 0.16 },
  ]);
}

export function playGradeGood(): void {
  playPhrase([
    { freq: 523, dur: 0.12, level: 0.6, shimmer: 0.1 },
    { freq: 659, at: 0.1, dur: 0.18, level: 0.6, shimmer: 0.1, release: 0.12 },
  ]);
}

export function playGradeBad(): void {
  playPhrase([
    { freq: 392, dur: 0.14, type: 'triangle', level: 0.5 },
    { freq: 330, at: 0.11, dur: 0.2, type: 'triangle', level: 0.5, release: 0.14 },
  ]);
}

export function playGradeTerrible(): void {
  playPhrase([
    { freq: 330, dur: 0.14, type: 'triangle', level: 0.5 },
    { freq: 247, at: 0.12, dur: 0.22, type: 'triangle', level: 0.5, release: 0.16 },
  ]);
}

// Filter change - quick soft tick (E5)
export function playFilter(): void {
  playPhrase([{ freq: 659, dur: 0.07, pluck: true, level: 0.45 }]);
}

// Sort change - light two-tap (A4, D5)
export function playSort(): void {
  playPhrase([
    { freq: 440, dur: 0.05, pluck: true, level: 0.45 },
    { freq: 587, at: 0.05, dur: 0.07, pluck: true, level: 0.45 },
  ]);
}

// Page transition - soft upward sweep (rising A-major arpeggio)
export function playPageTransition(): void {
  playPhrase([
    { freq: 440, dur: 0.08, pluck: true, level: 0.4 },
    { freq: 554, at: 0.04, dur: 0.08, pluck: true, level: 0.4 },
    { freq: 659, at: 0.08, dur: 0.1, pluck: true, level: 0.4 },
  ]);
}

// Load complete - calm three-note arpeggio (C5, E5, G5)
export function playLoadComplete(): void {
  playPhrase([
    { freq: 523, dur: 0.16, level: 0.55, shimmer: 0.08 },
    { freq: 659, at: 0.13, dur: 0.16, level: 0.55, shimmer: 0.08 },
    { freq: 784, at: 0.26, dur: 0.28, level: 0.55, shimmer: 0.1, release: 0.2 },
  ]);
}

// You're on the clock - a two-note horn that cuts through a noisy room.
// Slightly louder than the UI blips on purpose: this is the one sound the
// user must not miss while looking at the TV. Still square-wave for bite;
// the master lowpass keeps it from grating.
export function playOnTheClock(): void {
  playPhrase([
    { freq: 392, dur: 0.22, type: 'square', level: 0.5, attack: 0.02, release: 0.14 },
    { freq: 587, at: 0.18, dur: 0.36, type: 'square', level: 0.55, attack: 0.02, release: 0.24 },
  ]);
}

// Export button click (E5, A5)
export function playExport(): void {
  playPhrase([
    { freq: 659, dur: 0.1, level: 0.55, shimmer: 0.1 },
    { freq: 880, at: 0.09, dur: 0.16, level: 0.55, shimmer: 0.1, release: 0.12 },
  ]);
}

// Toggle mute
export function toggleMute(): boolean {
  isMuted = !isMuted;
  if (masterGain) {
    masterGain.gain.value = isMuted ? 0 : MASTER_VOLUME;
  }
  return isMuted;
}

export function getMuted(): boolean {
  return isMuted;
}

export function setMuted(muted: boolean): void {
  isMuted = muted;
  if (masterGain) {
    masterGain.gain.value = isMuted ? 0 : MASTER_VOLUME;
  }
}

// Initialize audio context on first user interaction
export function initAudio(): void {
  try {
    getAudioContext();
  } catch {
    // No audio available: stay silent.
  }
}
