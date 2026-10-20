import { createContext, useContext, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lyricsApi } from '../../api/lyrics';
import { useApi } from '../../components/Common';
import { defaultLyricsSettings, providerNames, type LyricCandidate, type LyricDocument, type ProviderId, type TrackDescriptor } from '../../domain/lyrics/types';
import { lyricHash, normalizeLyrics } from '../../domain/lyrics/normalize';
import type { Track } from '../../domain/models';
import { useLyricsProfiles } from '../../state/lyrics';

export const LyricsApiContext = createContext(lyricsApi);
export const describeTrack = (track: Track): TrackDescriptor => ({ title: track.title, artists: track.artists?.length ? track.artists.map((a) => a.name) : [track.artist], album: track.album, durationMs: track.duration === undefined ? undefined : track.duration * 1000 });
export function useLyrics(track?: Track) {
  const api = useApi(); const network = useContext(LyricsApiContext); const client = useQueryClient();
  const settings = useLyricsProfiles((s) => s.profiles[api.identity] ?? defaultLyricsSettings);
  const refresh = useLyricsProfiles((s) => s.refreshes[JSON.stringify([api.identity, track?.id])] ?? 0);
  const choice = settings.tracks[track?.id ?? '']; const mode = choice?.mode ?? 'auto';
  const localEnabled = Boolean(track && (mode === 'auto' || mode === 'local'));
  const local = useQuery({ queryKey: [api.identity, 'lyrics', track?.id], enabled: localEnabled, retry: false, queryFn: ({ signal }) => api.lyrics(track!.id, track!.artist, track!.title, signal) });
  const localDocument = useMemo<LyricDocument | undefined>(() => local.data ? local.data.document ?? { version: 1, source: 'local', recordId: track!.id, tracks: [{ role: 'original', lines: local.data.lines, offsetMs: local.data.offsetMs }], instrumental: local.data.instrumental } : undefined, [local.data, track]);
  const localLyrics = useMemo(() => localDocument ? normalizeLyrics(localDocument) : undefined, [localDocument]);
  const needNetwork = Boolean(track && settings.enabled && mode !== 'local' && (mode !== 'auto' || local.isSuccess && !localLyrics?.instrumental && !localLyrics?.lines.some((l) => l.text.trim())));
  const providers: ProviderId[] = mode === 'netease' || mode === 'qq' ? settings.order.filter((p) => p === mode) : settings.order;
  const remote = useQuery({ queryKey: [api.identity, 'network-lyrics', track?.id, track && describeTrack(track), mode, providers, choice?.bindings, settings.enabled, refresh], enabled: needNetwork, staleTime: 300000, retry: false,
    queryFn: async ({ signal }) => {
      const budget = AbortSignal.any([signal, AbortSignal.timeout(15000)]); const candidates: LyricCandidate[] = []; const errors: string[] = [];
      for (const provider of providers) {
        try {
          const binding = choice?.bindings?.[provider]; let ids = binding ? [binding] : [];
          if (!binding) {
            const found = await network.search(describeTrack(track!), [provider], budget, refresh > 0); candidates.push(...found.candidates);
            if (found.errors.length) errors.push(`${providerNames[provider]}暂不可用`);
            ids = found.candidates[0]?.confident ? found.candidates.filter((c) => c.confident).slice(0, 2).map((c) => c.id) : [];
          }
          for (const id of ids) {
            const result = await client.fetchQuery({ queryKey: [api.identity, 'tooku-lyrics', provider, id, refresh], staleTime: 300000, retry: false, queryFn: ({ signal: fetchSignal }) => network.lyrics(provider, id, AbortSignal.any([budget, fetchSignal]), refresh > 0) });
            const normalized = normalizeLyrics(result.document);
            if (normalized.instrumental || normalized.lines.some((l) => l.text.trim())) return { ...result, candidates };
          }
        } catch (e) { if (signal.aborted) throw e; errors.push(e instanceof Error ? e.message : `${providerNames[provider]}暂不可用`); }
      }
      if (errors.length && !candidates.length) throw new Error([...new Set(errors)].join('；'));
      return { document: undefined, candidates, cached: false, stale: false };
    },
  });
  const document = needNetwork ? remote.data?.document : mode === 'auto' || mode === 'local' ? localDocument : undefined;
  const hash = useMemo(() => document ? lyricHash(document) : '', [document]);
  const saved = document && choice?.edits?.[document.source]; const edit = saved && saved.hash === hash ? saved : undefined;
  const lyrics = useMemo(() => document ? normalizeLyrics(document, edit) : undefined, [document, edit]);
  return { lyrics, document, hash, edit, choice, settings, mode, source: document?.source ?? (mode === 'netease' || mode === 'qq' ? mode : 'local'), candidates: remote.data?.candidates ?? [],
    loading: localEnabled && local.isPending || needNetwork && remote.isPending,
    error: needNetwork ? remote.error : localEnabled ? local.error : null,
    retry: async () => { if (needNetwork && track) { useLyricsProfiles.getState().refresh(api.identity, track.id); return; } return local.refetch(); },
  };
}
