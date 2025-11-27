import { useCallback, useEffect, useState } from 'react';
import * as sounds from '@/utils/sounds';

const SOUND_PREFS_KEY = 'ff-analyzer-sounds-enabled';

export function useSounds() {
  const [isMuted, setIsMuted] = useState(() => {
    const stored = localStorage.getItem(SOUND_PREFS_KEY);
    return stored === 'false';
  });

  // Initialize audio context on first user interaction
  useEffect(() => {
    const handleFirstInteraction = () => {
      sounds.initAudio();
      sounds.setMuted(isMuted);
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
    };

    document.addEventListener('click', handleFirstInteraction);
    document.addEventListener('keydown', handleFirstInteraction);

    return () => {
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('keydown', handleFirstInteraction);
    };
  }, [isMuted]);

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
    playGrade,
  };
}
