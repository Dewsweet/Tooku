import { useEffect, useState } from 'react';
import { player, usePlayer } from './engine';
import { usePreferences } from '../../state/preferences';

export function useReducedMotion() {
  const preference = usePreferences((s) => s.reducedMotion);
  const [system, setSystem] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const change = () => setSystem(media.matches);
    media.addEventListener('change', change); return () => media.removeEventListener('change', change);
  }, []);
  return preference || system;
}

// Only the progress control refreshes per frame; the media element is the clock.
export function usePlaybackPosition() {
  const position = usePlayer((s) => s.position); const status = usePlayer((s) => s.status);
  const currentId = usePlayer((s) => s.currentId); const reduced = useReducedMotion();
  const [smooth, setSmooth] = useState(position);
  useEffect(() => {
    if (status !== 'playing' || reduced) return;
    let frame = 0; let previous = 0;
    const tick = (now: number) => {
      if (now - previous >= 40 && !document.hidden) { setSmooth(player.currentTime()); previous = now; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [status, currentId, reduced]);
  return status === 'playing' && !reduced ? Math.max(position, Math.abs(smooth - position) < 1 ? smooth : position) : position;
}
