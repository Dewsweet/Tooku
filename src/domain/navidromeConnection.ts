const messages = {
  dns: 'Tooku 服务端无法解析音乐服务器域名，请检查服务端 DNS。',
  tls: '音乐服务器 HTTPS 证书验证失败，请检查证书域名、有效期及完整证书链；私有 CA 需加入 Tooku 运行环境的信任库。',
  timeout: 'Tooku 服务端连接音乐服务器超时，请检查端口和网络路由。',
  refused: '音乐服务器拒绝连接，请检查端口和监听地址。',
  network: 'Tooku 服务端无法连通音乐服务器，请检查网络路由。',
  interrupted: '音乐服务器连接中断，请稍后重试。',
  redirect: '音乐 API 返回了重定向，请填写 Navidrome 最终服务地址，并检查反向代理的 /rest 路由。',
  http: '音乐 API 返回 HTTP 错误，请检查反向代理、访问限制及 /rest 路由。',
  protocol: '该地址未返回有效的音乐 API JSON，请检查 Navidrome 地址、子路径及反向代理的 /rest 路由。',
  size: '音乐 API 验证响应过大，请检查服务器地址与反向代理。',
} as const;

export type NavidromeConnectionReason = keyof typeof messages;

/** Only display our known diagnostics; never echo arbitrary upstream text. */
export function navidromeConnectionMessage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return;
  const reason = Reflect.get(value, 'connectionError');
  if (typeof reason !== 'string' || !Object.hasOwn(messages, reason)) return;
  const message = messages[reason as NavidromeConnectionReason];
  const status = Reflect.get(value, 'upstreamStatus');
  return reason === 'http' && typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? `${message}（HTTP ${status}）` : message;
}
