// Disposable, in-memory test service. Never proxies to or writes to Navidrome.
import { createServer } from 'node:http';

const albums = [
  ['雨夜', 'Tooku 测试音乐库', '#91a2a4', '#324e55'], ['微光', 'Tooku 测试音乐库', '#e0ba99', '#965b4e'],
  ['Quiet', 'Tooku 测试音乐库', '#d9d8c5', '#707964'], ['Drift', 'Tooku 测试音乐库', '#aebcdd', '#586088'],
  ['午后', 'Tooku 测试音乐库', '#d7a7af', '#985973'], ['Sunday', 'Tooku 测试音乐库', '#c3c3bc', '#4a5058'],
].map(([name, artist, from, to], i) => ({ id: `album-${i}`, name, artist, artistId: 'artist-1', coverArt: `cover-${i}`, songCount: 3, year: 2026, from, to }));
const songs = albums.flatMap((album, i) => ['序曲', '慢慢地听', '回声'].map((title, j) => ({ id: `song-${i}-${j}`, title, artist: album.artist, album: album.name, albumId: album.id, coverArt: album.coverArt, duration: 12, track: j + 1, suffix: 'wav', bitRate: 256 })));
const artists = [{ id: 'artist-1', name: 'Tooku 测试音乐库', albumCount: albums.length }];
const starred = new Set();
const playlists = new Map([['playlist-1', { id: 'playlist-1', name: '测试 · 一个安静的下午', owner: 'fixture', changed: '0', entry: songs.slice(0, 4) }]]);
let serial = 1;
const sampleRate = 16000; const sampleCount = sampleRate * 12; const wav = Buffer.alloc(44 + sampleCount * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(sampleCount * 2, 40);
for (let i = 0; i < sampleCount; i++) wav.writeInt16LE(Math.round(Math.sin(i / sampleRate * Math.PI * 2 * 220) * 800), 44 + i * 2);
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, 'http://127.0.0.1:44534'); const params = url.searchParams;
  if (req.method === 'POST') { let body = ''; for await (const chunk of req) body += chunk; for (const [key, value] of new URLSearchParams(body)) params.append(key, value); }
  const method = url.pathname.split('/').at(-1)?.replace('.view', '');
  if (method === 'getCoverArt') {
    const album = albums.find((a) => a.coverArt === params.get('id')) ?? albums[0];
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${album.from}"/><stop offset="1" stop-color="${album.to}"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/><circle cx="350" cy="245" r="145" fill="white" opacity=".11"/><circle cx="270" cy="330" r="145" fill="white" opacity=".08"/><text x="45" y="70" font-family="sans-serif" font-size="14" fill="white" opacity=".7" letter-spacing="6">TOOKU • TEST COLLECTION</text><text x="45" y="500" font-family="sans-serif" font-size="68" fill="white">${album.name}</text><text x="48" y="550" font-family="sans-serif" font-size="16" fill="white" opacity=".7">LOCAL FIXTURE — NOT YOUR LIBRARY</text></svg>`); return;
  }
  if (method === 'stream') {
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    res.setHeader('Content-Type', 'audio/wav'); res.setHeader('Accept-Ranges', 'bytes');
    if (range) { const start = Number(range[1]); const end = Math.min(range[2] ? Number(range[2]) : wav.length - 1, wav.length - 1); if (start >= wav.length) { res.writeHead(416, { 'Content-Range': `bytes */${wav.length}` }); res.end(); return; } res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${wav.length}`, 'Content-Length': end - start + 1 }); res.end(wav.subarray(start, end + 1)); }
    else { res.setHeader('Content-Length', wav.length); res.end(wav); } return;
  }
  let result = {};
  const withStar = (items) => items.map((item) => ({ ...item, starred: starred.has(item.id) ? '2026-10-13' : undefined }));
  const describeList = (item) => ({ ...item, songCount: item.entry.length });
  switch (method) {
    case 'ping': result = { serverVersion: 'TEST FIXTURE · 非真实 Navidrome' }; break;
    case 'getOpenSubsonicExtensions': result = { openSubsonicExtensions: [{ name: 'songLyrics', versions: [1] }, { name: 'formPost', versions: [1] }] }; break;
    case 'getMusicFolders': result = { musicFolders: { musicFolder: [{ id: 'fixture', name: '仅测试数据' }] } }; break;
    case 'getAlbumList2': { const offset = Number(params.get('offset') ?? 0); result = { albumList2: { album: withStar(albums.slice(offset, offset + 30)) } }; break; }
    case 'getAlbum': result = { album: { ...withStar(albums.filter((a) => a.id === params.get('id')))[0], song: withStar(songs.filter((s) => s.albumId === params.get('id'))) } }; break;
    case 'getArtists': result = { artists: { index: [{ name: 'T', artist: artists }] } }; break;
    case 'getArtist': result = { artist: { ...artists[0], album: withStar(albums) } }; break;
    case 'search3': { const q = (params.get('query') ?? '').toLowerCase(); const offset = Number(params.get('songOffset') ?? 0); result = { searchResult3: { song: withStar(songs.filter((s) => `${s.title}${s.album}${s.artist}`.toLowerCase().includes(q)).slice(offset, offset + 30)), album: withStar(albums.filter((a) => a.name.toLowerCase().includes(q)).slice(offset, offset + 30)), artist: artists.filter((a) => a.name.toLowerCase().includes(q)).slice(offset, offset + 30) } }; break; }
    case 'getStarred2': result = { starred2: { song: withStar(songs.filter((s) => starred.has(s.id))), album: withStar(albums.filter((a) => starred.has(a.id))), artist: artists.filter((a) => starred.has(a.id)) } }; break;
    case 'star': case 'unstar': for (const key of ['id', 'albumId', 'artistId']) for (const id of params.getAll(key)) { if (method === 'star') starred.add(id); else starred.delete(id); } break;
    case 'getPlaylists': result = { playlists: { playlist: [...playlists.values()].map(describeList) } }; break;
    case 'getPlaylist': result = { playlist: describeList(playlists.get(params.get('id'))) }; break;
    case 'createPlaylist': { const id = params.get('playlistId') ?? `playlist-${++serial}`; const existing = playlists.get(id); const item = { ...existing, id, name: params.get('name') ?? existing?.name ?? '测试歌单', owner: 'fixture', changed: String(++serial), entry: params.getAll('songId').map((id) => songs.find((s) => s.id === id)).filter(Boolean) }; playlists.set(id, item); result = { playlist: describeList(item) }; break; }
    case 'updatePlaylist': { const item = playlists.get(params.get('playlistId')); item.name = params.get('name') ?? item.name; item.changed = String(++serial); break; }
    case 'deletePlaylist': playlists.delete(params.get('id')); break;
    case 'getLyricsBySongId': result = { lyricsList: { structuredLyrics: [{ synced: true, offset: 0, lang: 'zho', line: [{ start: 0, value: '此处是测试歌词' }, { start: 3000, value: '听见安静的声音' }, { start: 6000, value: '每一首，都由你选择' }, { start: 9000, value: '旋律慢慢回到身边' }] }] } }; break;
    case 'scrobble': break;
    default: res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ 'subsonic-response': { status: 'failed', error: { code: 70 } } })); return;
  }
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1', openSubsonic: true, ...result } }));
});
server.listen(44534, '127.0.0.1', () => console.log('Disposable Tooku test fixture: http://127.0.0.1:44534 (memory only)'));
