// Soft chiptune-style sound effects using Web Audio API
// Sine/triangle waves with gentle envelopes for low-friction UI feedback

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let isMuted = false;

// Master volume (0-1) - kept low so the sounds sit under the UI
const MASTER_VOLUME = 0.08;

function getAudioContext(): AudioContext {
  if (!audioContext) {
    audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    masterGain = audioContext.createGain();
    masterGain.gain.value = MASTER_VOLUME;
    masterGain.connect(audioContext.destination);
  }
  return audioContext;
}

function getMasterGain(): GainNode {
  getAudioContext();
  return masterGain!;
}

// Create an oscillator with smooth envelope.
// `level` (0-1) scales the per-note volume so individual tones can sit further
// under the master without clipping the envelope.
function createTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  fadeIn = 0.02,
  fadeOut = 0.12,
  level = 1
): void {
  if (isMuted) return;

  const ctx = getAudioContext();
  const gain = getMasterGain();
  const now = ctx.currentTime;

  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.value = frequency;

  // Exponential ramps feel softer than linear for both attack and release
  const peak = Math.max(0.0001, level);
  envelope.gain.setValueAtTime(0.0001, now);
  envelope.gain.exponentialRampToValueAtTime(peak, now + fadeIn);
  envelope.gain.setValueAtTime(peak, now + Math.max(fadeIn, duration - fadeOut));
  envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  oscillator.connect(envelope);
  envelope.connect(gain);

  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

// Navigation click - soft, short blip
export function playClick(): void {
  createTone(520, 0.09, 'sine', 0.015, 0.07, 0.6);
}

// Hover sound - barely there
export function playHover(): void {
  createTone(440, 0.05, 'sine', 0.01, 0.04, 0.35);
}

// Success - gentle two-note rise
export function playSuccess(): void {
  createTone(523, 0.14, 'sine', 0.02, 0.1, 0.7); // C5
  setTimeout(() => createTone(784, 0.18, 'sine', 0.02, 0.14, 0.7), 110); // G5
}

// Error - soft descending pair
export function playError(): void {
  createTone(392, 0.16, 'triangle', 0.02, 0.12, 0.55); // G4
  setTimeout(() => createTone(311, 0.22, 'triangle', 0.02, 0.16, 0.55), 140); // Eb4
}

// Grade reveal sounds - softened
export function playGradeGreat(): void {
  createTone(523, 0.12, 'sine', 0.02, 0.1, 0.65); // C5
  setTimeout(() => createTone(659, 0.12, 'sine', 0.02, 0.1, 0.65), 90); // E5
  setTimeout(() => createTone(784, 0.18, 'sine', 0.02, 0.14, 0.65), 180); // G5
}

export function playGradeGood(): void {
  createTone(523, 0.12, 'sine', 0.02, 0.1, 0.6); // C5
  setTimeout(() => createTone(659, 0.16, 'sine', 0.02, 0.12, 0.6), 100); // E5
}

export function playGradeBad(): void {
  createTone(392, 0.14, 'triangle', 0.02, 0.1, 0.5); // G4
  setTimeout(() => createTone(330, 0.18, 'triangle', 0.02, 0.14, 0.5), 110); // E4
}

export function playGradeTerrible(): void {
  createTone(330, 0.14, 'triangle', 0.02, 0.1, 0.5); // E4
  setTimeout(() => createTone(247, 0.2, 'triangle', 0.02, 0.16, 0.5), 120); // B3
}

// Filter change - quick soft tick
export function playFilter(): void {
  createTone(620, 0.06, 'sine', 0.01, 0.05, 0.45);
}

// Sort change - light two-tap
export function playSort(): void {
  createTone(440, 0.05, 'sine', 0.01, 0.04, 0.45);
  setTimeout(() => createTone(587, 0.06, 'sine', 0.01, 0.05, 0.45), 50);
}

// Page transition - soft upward sweep
export function playPageTransition(): void {
  for (let i = 0; i < 3; i++) {
    setTimeout(() => createTone(440 + i * 80, 0.07, 'sine', 0.015, 0.06, 0.4), i * 40);
  }
}

// Load complete - calm three-note arpeggio (no busy chord at the end)
export function playLoadComplete(): void {
  createTone(523, 0.16, 'sine', 0.02, 0.12, 0.55); // C5
  setTimeout(() => createTone(659, 0.16, 'sine', 0.02, 0.12, 0.55), 130); // E5
  setTimeout(() => createTone(784, 0.24, 'sine', 0.02, 0.18, 0.55), 260); // G5
}

// Export button click
export function playExport(): void {
  createTone(660, 0.1, 'sine', 0.02, 0.08, 0.55);
  setTimeout(() => createTone(880, 0.14, 'sine', 0.02, 0.1, 0.55), 90);
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
  getAudioContext();
}
