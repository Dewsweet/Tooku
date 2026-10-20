// Keep the native API proxy limited to the operations used for artist artwork.
export function isNavidromeProxyRequest(url: string, method = 'GET') {
  const path = url.split('?')[0];
  if (path.startsWith('/nd/rest/')) return true;
  if (path === '/nd/auth/login') return method === 'POST';
  if (/^\/nd\/api\/artist\/[a-zA-Z0-9_-]+$/.test(path)) return method === 'GET';
  return /^\/nd\/api\/artist\/[a-zA-Z0-9_-]+\/image$/.test(path) && ['POST', 'DELETE'].includes(method);
}
