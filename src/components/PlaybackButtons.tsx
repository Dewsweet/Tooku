import { LoaderCircle, Play, Shuffle } from 'lucide-react';
import { IconButton } from './Common';

export function PlaybackButtons({ play, shuffle, disabled, preparing = false, playLabel, shuffleLabel }: {
  play: () => void; shuffle: () => void; disabled?: boolean; preparing?: boolean;
  playLabel?: string; shuffleLabel: string;
}) {
  return <>
    <button type="button" className="primary-button" aria-label={playLabel} disabled={disabled || preparing} onClick={play}>
      {preparing ? <LoaderCircle size={18} className="spin" /> : <Play size={18} fill="currentColor" />}
      {preparing ? '正在准备…' : '播放'}
    </button>
    <IconButton label={shuffleLabel} disabled={disabled || preparing} onClick={shuffle}><Shuffle size={21} /></IconButton>
  </>;
}
