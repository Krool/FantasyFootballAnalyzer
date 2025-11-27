// 8-bit style sound effects using Web Audio API
// Smooth, low-volume sounds for satisfying UI feedback

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let isMuted = false;

// Master volume (0-1) - keeping it low and smooth
const MASTER_VOLUME = 0.15;

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

// Create an oscillator with smooth envelope
function createTone(
  frequency: number,
  duration: number,
  type: OscillatorType = 'square',
  fadeIn = 0.01,
  fadeOut = 0.05
): void {
  if (isMuted) return;

  const ctx = getAudioContext();
  const gain = getMasterGain();
  const now = ctx.currentTime;

  const oscillator = ctx.createOscillator();
  const envelope = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.value = frequency;

  // Smooth envelope to prevent clicks
  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(1, now + fadeIn);
  envelope.gain.setValueAtTime(1, now + duration - fadeOut);
  envelope.gain.linearRampToValueAtTime(0, now + duration);

  oscillator.connect(envelope);
  envelope.connect(gain);

  oscillator.start(now);
  oscillator.stop(now + duration);
}

// Create a chord (multiple tones)
function playChord(frequencies: number[], duration: number, type: OscillatorType = 'square'): void {
  frequencies.forEach((freq, i) => {
    setTimeout(() => createTone(freq, duration, type), i * 20);
  });
}

// Sound effect presets - all designed to be satisfying and non-intrusive

// Navigation click - soft blip
export function playClick(): void {
  createTone(800, 0.06, 'square', 0.005, 0.03);
}

// Hover sound - very subtle
export function playHover(): void {
  createTone(600, 0.03, 'sine', 0.005, 0.02);
}

// Success sound - ascending positive tone
export function playSuccess(): void {
  createTone(523, 0.08, 'square'); // C5
  setTimeout(() => createTone(659, 0.08, 'square'), 70); // E5
  setTimeout(() => createTone(784, 0.12, 'square'), 140); // G5
}

// Error sound - descending minor
export function playError(): void {
  createTone(440, 0.1, 'square'); // A4
  setTimeout(() => createTone(349, 0.15, 'square'), 100); // F4
}

// Grade reveal sounds - different tones for different grades
export function playGradeGreat(): void {
  // Triumphant ascending arpeggio
  createTone(523, 0.08, 'square'); // C5
  setTimeout(() => createTone(659, 0.08, 'square'), 60); // E5
  setTimeout(() => createTone(784, 0.08, 'square'), 120); // G5
  setTimeout(() => createTone(1047, 0.15, 'square'), 180); // C6
}

export function playGradeGood(): void {
  // Pleasant two-note confirmation
  createTone(523, 0.08, 'square'); // C5
  setTimeout(() => createTone(659, 0.12, 'square'), 80); // E5
}

export function playGradeBad(): void {
  // Subtle descending tone
  createTone(392, 0.1, 'square'); // G4
  setTimeout(() => createTone(330, 0.12, 'square'), 90); // E4
}

export function playGradeTerrible(): void {
  // Minor chord descend
  createTone(330, 0.1, 'square'); // E4
  setTimeout(() => createTone(277, 0.12, 'square'), 100); // C#4
}

// Filter change - quick blip
export function playFilter(): void {
  createTone(700, 0.04, 'triangle', 0.005, 0.02);
}

// Sort change - swipe sound
export function playSort(): void {
  createTone(500, 0.03, 'square');
  setTimeout(() => createTone(700, 0.03, 'square'), 30);
}

// Page transition - swoosh
export function playPageTransition(): void {
  for (let i = 0; i < 5; i++) {
    setTimeout(() => createTone(400 + i * 100, 0.04, 'sine', 0.005, 0.02), i * 20);
  }
}

// Load complete - achievement sound
export function playLoadComplete(): void {
  createTone(523, 0.1, 'square'); // C5
  setTimeout(() => createTone(659, 0.1, 'square'), 100); // E5
  setTimeout(() => createTone(784, 0.1, 'square'), 200); // G5
  setTimeout(() => {
    playChord([1047, 1319, 1568], 0.2, 'square'); // C major chord
  }, 300);
}

// Export button click
export function playExport(): void {
  createTone(880, 0.05, 'square');
  setTimeout(() => createTone(1100, 0.05, 'square'), 50);
  setTimeout(() => createTone(880, 0.08, 'square'), 100);
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
