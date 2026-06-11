import { useCallback, useEffect, useState } from 'react';
import * as sounds from '@/utils/sounds';

const SOUND_PREFS_KEY = 'ff-analyzer-sounds-enabled';

// Browsers refuse to start audio before a user gesture. One module-level
// pair of listeners covers the whole app; previously every useSounds()
// consumer (15+) registered its own and re-registered on each mute toggle.
let interactionListenersInstalled = false;
function installFirstInteractionInit(): void {
  if (interactionListenersInstalled || typeof document === 'undefined') return;
  interactionListenersInstalled = true;
  const handleFirstInteraction = () => {
    sounds.initAudio();
    sounds.setMuted(localStorage.getItem(SOUND_PREFS_KEY) === 'false');
    document.removeEventListener('click', handleFirstInteraction);
    document.removeEventListener('keydown', handleFirstInteraction);
  };
  document.addEventListener('click', handleFirstInteraction);
  document.addEventListener('keydown', handleFirstInteraction);
}

export function useSounds() {
  const [isMuted, setIsMuted] = useState(() => {
    const stored = localStorage.getItem(SOUND_PREFS_KEY);
    return stored === 'false';
  });

  useEffect(() => {
    installFirstInteractionInit();
  }, []);

  // Sync muted state with sounds utility
  useEffect(() => {
    sounds.setMuted(isMuted);
    localStorage.setItem(SOUND_PREFS_KEY, String(!isMuted));
  }, [isMuted]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev);
  }, []);

  const playClick = useCallback(() => sounds.playClick(), []);
  const playHover = useCallback(() => sounds.playHover(), []);
  const playSuccess = useCallback(() => sounds.playSuccess(), []);
  const playError = useCallback(() => sounds.playError(), []);
  const playFilter = useCallback(() => sounds.playFilter(), []);
  const playSort = useCallback(() => sounds.playSort(), []);
  const playPageTransition = useCallback(() => sounds.playPageTransition(), []);
  const playLoadComplete = useCallback(() => sounds.playLoadComplete(), []);
  const playExport = useCallback(() => sounds.playExport(), []);
  const playOnTheClock = useCallback(() => sounds.playOnTheClock(), []);

  const playGrade = useCallback((grade: 'great' | 'good' | 'bad' | 'terrible') => {
    switch (grade) {
      case 'great':
        sounds.playGradeGreat();
        break;
      case 'good':
        sounds.playGradeGood();
        break;
      case 'bad':
        sounds.playGradeBad();
        break;
      case 'terrible':
        sounds.playGradeTerrible();
        break;
    }
  }, []);

  return {
    isMuted,
    toggleMute,
    playClick,
    playHover,
    playSuccess,
    playError,
    playFilter,
    playSort,
    playPageTransition,
    playLoadComplete,
    playExport,
    playOnTheClock,
    playGrade,
  };
}
