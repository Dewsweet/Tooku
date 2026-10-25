import { expect, it } from 'vitest';
import { artistArtworkCandidates } from '../src/domain/artistArtwork';
import { artistSearchNames, normalizeArtistName } from '../src/domain/artistNames';
import { matchCandidates, parseCandidates } from '../scripts/probe-artist-artwork';

it('uses stable own-album artwork after the artist image, skipping duplicates and other album artists', () => {
  const albums = [
    { id: 'b', name: '第二张', artist: '歌手', artistId: 'artist', coverArt: 'b-art' },
    { id: 'compilation', name: '合辑', artist: '群星', artistId: 'various', coverArt: 'various-art' },
    { id: 'a', name: '第一张', artist: '歌手', artistId: 'artist', coverArt: 'a-art' },
    { id: 'copy', name: '另一个版本', artist: '歌手', coverArt: 'a-art' },
  ];
  const expected = [{ kind: 'artist', coverArt: 'portrait' }, { kind: 'album', coverArt: 'a-art', albumId: 'a' }, { kind: 'album', coverArt: 'b-art', albumId: 'b' }];
  expect(artistArtworkCandidates('artist', 'portrait', albums)).toEqual(expected);
  expect(artistArtworkCandidates('artist', 'portrait', [...albums].reverse())).toEqual(expected);
  expect(artistArtworkCandidates('artist', undefined, [])).toEqual([]);
  expect(albums[0].id).toBe('b');
});

it('extracts Chinese/Japanese search variants while retaining the original tag and punctuation', () => {
  expect(artistSearchNames(' 宇多田光（宇多田ヒカル） ')).toEqual(['宇多田光(宇多田ヒカル)', '宇多田光', '宇多田ヒカル']);
  expect(artistSearchNames('坂本龙一(坂本龍一)')).toEqual(['坂本龙一(坂本龍一)', '坂本龙一', '坂本龍一']);
  expect(artistSearchNames('S.E.N.S.')).toEqual(['S.E.N.S.']);
  expect(artistSearchNames('歌手（CV. 某人）')).toEqual(['歌手(CV. 某人)']);
  expect(artistSearchNames('歌手（Live）')).toEqual(['歌手(Live)']);
  expect(normalizeArtistName(' Ａｉｍｅｒ ')).toBe('aimer');
});

it('keeps alternative-name candidates provisional and same-name candidates ambiguous', () => {
  const candidate = { id: 'one', name: '宇多田ヒカル', aliases: [], imageUrl: undefined };
  expect(matchCandidates('宇多田光（宇多田ヒカル）', [candidate]).kind).toBe('derived-name');
  expect(matchCandidates('宇多田ヒカル', [candidate, { ...candidate, id: 'two' }]).kind).toBe('ambiguous');
  expect(matchCandidates('宇多田光', [{ ...candidate, aliases: ['宇多田光'] }]).kind).toBe('direct-name');
  expect(matchCandidates('宇多田光', [{ ...candidate, name: '宇多田光翻唱' }]).kind).toBe('unmatched');
});

it('accepts only public provider image URLs and never emits credentials from upstream fields', () => {
  expect(parseCandidates('netease', { code: 200, result: { artists: [{ id: 1, name: '歌手', alias: ['别名'], picUrl: 'http://p1.music.126.net/photo.jpg?param=600y600&token=never-save' }] } })).toEqual([{ id: '1', name: '歌手', aliases: ['别名'], imageUrl: 'https://p1.music.126.net/photo.jpg?param=600y600' }]);
  const values = ['http://127.0.0.1/private', 'https://p1.music.126.net.evil.test/photo.jpg', 'https://u:secret@y.gtimg.cn/photo.jpg'];
  for (const singerPic of values) expect(parseCandidates('qq', { code: 0, data: { singer: { list: [{ singerMID: 'mid', singerName: '歌手', singerPic }] } } })[0].imageUrl).toBeUndefined();
  expect(() => parseCandidates('netease', { code: 301 })).toThrow('upstream-business-error');
});
