import { createContext, useContext, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { lyricsApi } from '../../api/lyrics';
import { useApi } from '../../components/Common';
import { defaultLyricsSettings, type LyricCandidate, type LyricDocument, type LyricSource, type ProviderId, type TrackDescriptor } from '../../domain/lyrics/types';
import { canUseLyricCandidate } from '../../domain/lyrics/matching';
import { lyricHash, normalizeLyrics } from '../../domain/lyrics/normalize';
import type { Track } from '../../domain/models';
import { useLyricsProfiles } from '../../state/lyrics';

export const LyricsApiContext = createContext(lyricsApi);
export const describeTrack = (track: Track): TrackDescriptor => ({ title: track.title, artists: track.artists?.length ? track.artists.map((a) => a.name) : [track.artist], album: track.album, durationMs: track.duration === undefined ? undefined : track.duration * 1000 });
export function useLyrics(track?: Track) {
  const api = useApi(); const network = useContext(LyricsApiContext); const client = useQueryClient();
  const settings = useLyricsProfiles((s) => s.profiles[api.identity] ?? defaultLyricsSettings);
  const refresh = useLyricsProfiles((s) => s.refreshes[JSON.stringify([api.identity, track?.id])] ?? 0);
  const choice = settings.tracks[track?.id ?? ''];
  // Read legacy modes without rewriting an account document just by opening it.
  const mode: LyricSource = choice?.mode === 'netease' || choice?.mode === 'qq' ? choice.mode : choice?.mode === 'network' ? settings.order[0] : 'local';
  const localEnabled = Boolean(track && mode === 'local');
  const local = useQuery({ queryKey: [api.identity, 'lyrics', track?.id], enabled: localEnabled, retry: false, queryFn: ({ signal }) => api.lyrics(track!.id, track!.artist, track!.title, signal) });
  const localDocument = useMemo<LyricDocument | undefined>(() => local.data ? local.data.document ?? { version: 1, source: 'local', recordId: track!.id, tracks: [{ role: 'original', lines: local.data.lines, offsetMs: local.data.offsetMs }], instrumental: local.data.instrumental } : undefined, [local.data, track]);
  const localLyrics = useMemo(() => localDocument ? normalizeLyrics(localDocument) : undefined, [localDocument]);
  const needNetwork = Boolean(track && settings.enabled && (mode !== 'local' || local.isSuccess && !localLyrics?.instrumental && !localLyrics?.lines.some((line) => line.text.trim())));
  const providers: ProviderId[] = mode === 'local' ? settings.order : settings.order.filter((provider) => provider === mode);
  const remote = useQuery({
    queryKey: [api.identity, 'network-lyrics', 'v3', track?.id, track && describeTrack(track), mode, providers, choice?.bindings, settings.enabled, refresh],
    enabled: needNetwork, staleTime: 300000, retry: false,
    queryFn: async ({ signal }) => {
      const budget = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
      const candidates: LyricCandidate[] = [];
      const errors: string[] = [];
      for (const provider of providers) {
        if (budget.aborted) break;
        try {
          const binding = choice?.bindings?.[provider];
          let ids = binding ? [binding] : [];
          if (!binding) {
            const found = await network.search(describeTrack(track!), [provider], budget, refresh > 0);
            candidates.push(...found.candidates);
            errors.push(...found.errors.map((error) => error.code));
            ids = found.candidates.filter((candidate) => candidate.provider === provider && canUseLyricCandidate(describeTrack(track!), candidate)).slice(0, 2).map((candidate) => candidate.id);
          }
          for (const id of ids) {
            if (budget.aborted) break;
            try {
              const result = await client.fetchQuery({ queryKey: [api.identity, 'tooku-lyrics', provider, id, refresh], staleTime: 300000, retry: false, queryFn: ({ signal: fetchSignal }) => network.lyrics(provider, id, AbortSignal.any([budget, fetchSignal]), refresh > 0) });
              const normalized = normalizeLyrics(result.document);
              if (normalized.instrumental || normalized.lines.some((line) => line.text.trim())) return { ...result, candidates, errors };
            } catch (error) {
              if (signal.aborted) throw error;
              errors.push(error instanceof Error ? error.message : 'unavailable');
            }
          }
        } catch (error) {
          if (signal.aborted) throw error;
          errors.push(error instanceof Error ? error.message : 'unavailable');
        }
      }
      // Playback has one quiet empty state. Operational failures remain in service status.
      return { document: undefined, candidates, errors, cached: false, stale: false };
    },
  });
  const document = needNetwork ? remote.data?.document : mode === 'local' ? localDocument : undefined;
  const hash = useMemo(() => document ? lyricHash(document) : '', [document]);
  const saved = document && choice?.edits?.[document.source]; const edit = saved && saved.hash === hash ? saved : undefined;
  const lyrics = useMemo(() => document ? normalizeLyrics(document, edit) : undefined, [document, edit]);
  return {
    lyrics, document, hash, edit, choice, settings, mode,
    source: document?.source ?? mode, candidates: remote.data?.candidates ?? [],
    loading: localEnabled && local.isPending || needNetwork && remote.isPending,
    error: localEnabled && !needNetwork ? local.error : null,
    retry: async () => { if (needNetwork && track) { useLyricsProfiles.getState().refresh(api.identity, track.id); return; } return local.refetch(); },
  };
}
