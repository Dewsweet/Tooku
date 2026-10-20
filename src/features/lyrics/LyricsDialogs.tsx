import { useContext, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Modal } from '../../components/Modal';
import { Select } from '../../components/Select';
import { formatTime, QueryState } from '../../components/Common';
import { normalizeLyrics } from '../../domain/lyrics/normalize';
import { providerNames, type LyricCandidate, type LyricDocument, type LyricEdit, type LyricLayout, type ProviderId } from '../../domain/lyrics/types';
import type { Track } from '../../domain/models';
import { describeTrack, LyricsApiContext } from './useLyrics';

export function MatchLyrics({ track, providers, onSelect, onClose }: { track: Track; providers: ProviderId[]; onSelect: (candidate: LyricCandidate) => void; onClose: () => void }) {
  const network = useContext(LyricsApiContext); const [provider, setProvider] = useState<ProviderId>(providers[0]);
  const [keyword, setKeyword] = useState(`${track.title} ${track.artist}`); const [submitted, setSubmitted] = useState(keyword); const [attempt, setAttempt] = useState(0);
  const query = useQuery({ queryKey: ['lyric-candidates', describeTrack(track), provider, submitted, attempt], retry: false, queryFn: ({ signal }) => network.search(describeTrack(track), [provider], signal, true, submitted) });
  return <Modal title="选择网络歌词" onClose={onClose}>
    <form className="lyric-search" onSubmit={(e) => { e.preventDefault(); if (keyword.trim()) { setSubmitted(keyword.trim()); setAttempt((n) => n + 1); } }}><Select aria-label="歌词平台" value={provider} onChange={(value) => { if (value === 'netease' || value === 'qq') setProvider(value); }}>{providers.map((p) => <option key={p} value={p}>{providerNames[p]}</option>)}</Select><input aria-label="搜索歌词" value={keyword} maxLength={512} onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault(); }} /><button className="subtle-button" disabled={!keyword.trim() || query.isFetching}>搜索</button></form>
    <QueryState pending={query.isPending} error={query.error} retry={() => query.refetch()} pendingText="正在搜索歌词…" />
    {query.data?.errors.length ? <p role="alert">{providerNames[provider]}暂不可用，请稍后重试</p> : null}
    {query.data && !query.data.errors.length && !query.data.candidates.length && <p>没有匹配的歌曲</p>}
    <div className="lyric-candidates">{query.data?.candidates.map((c) => <button key={`${c.provider}-${c.id}`} onClick={() => onSelect(c)}><strong>{c.title}</strong><span>{c.artists.join(' / ')}</span><span>{c.album}{c.durationMs ? ` · ${formatTime(c.durationMs / 1000)}` : ''}</span></button>)}</div>
  </Modal>;
}
export function EditLyrics({ document, hash, current, onSave, onReset, onClose }: { document: LyricDocument; hash: string; current?: LyricEdit; onSave: (edit: LyricEdit) => void; onReset: () => void; onClose: () => void }) {
  const [draft, setDraft] = useState<LyricEdit>(current ?? { layout: 'auto', hash });
  const preview = useMemo(() => normalizeLyrics(document, draft), [document, draft]);
  return <Modal title="歌词排版" onClose={onClose}><form onSubmit={(e) => { e.preventDefault(); onSave({ ...draft, hash }); }}>
    <label>排版方式<Select value={draft.layout} onChange={(layout) => setDraft({ ...draft, layout: layout as LyricLayout })}><option value="auto">自动</option><option value="original">保持原样</option><option value="inline">同一行双语</option><option value="alternating">交替双语</option><option value="halves">前后分段</option></Select></label>
    {draft.layout === 'inline' && <label>分隔符<input aria-label="歌词分隔符" maxLength={16} value={draft.separator ?? ''} placeholder="自动识别连续空格或 /" onChange={(e) => setDraft({ ...draft, separator: e.target.value || undefined })} /></label>}
    {draft.layout === 'halves' && <label>原文行数<input aria-label="原文行数" type="number" min={1} max={10000} value={draft.splitAt ?? ''} placeholder="默认对半" onChange={(e) => setDraft({ ...draft, splitAt: e.target.value ? Math.max(1, Math.min(10000, Math.round(Number(e.target.value)))) : undefined })} /></label>}
    <label>延迟（毫秒）<input aria-label="歌词延迟" type="number" min={-600000} max={600000} step={100} value={draft.delayMs ?? 0} onChange={(e) => setDraft({ ...draft, delayMs: Math.max(-600000, Math.min(600000, Number(e.target.value))) })} /></label>
    <label className="lyric-check"><input type="checkbox" checked={draft.showTranslation !== false} onChange={(e) => setDraft({ ...draft, showTranslation: e.target.checked })} />显示译文</label>
    <label className="lyric-check"><input type="checkbox" checked={Boolean(draft.showRomanization)} onChange={(e) => setDraft({ ...draft, showRomanization: e.target.checked })} />显示罗马音</label>
    <div className="lyric-preview" aria-label="歌词排版预览">{preview.lines.slice(0, 4).map((l, i) => <p key={i}>{l.text}{draft.showTranslation !== false && l.translation?.map((t, j) => <span key={j}>{t}</span>)}{draft.showRomanization && l.romanization?.map((t, j) => <span key={`r-${j}`}>{t}</span>)}</p>)}</div>
    <div className="button-row"><button type="button" className="text-button" onClick={onReset}>恢复默认</button><button className="primary-button">保存</button></div>
  </form></Modal>;
}
