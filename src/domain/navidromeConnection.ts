const messages = {
  origin: 'Tooku 请求来源校验失败，请检查 Nginx 的 Host 转发是否保留公开域名和端口。',
  private: '此部署未开放私网音乐服务器，请使用已配置的默认上游，或由部署者显式开启私网登记。',
  policy: '音乐服务器地址不在允许范围内，请检查域名解析和部署策略；私网地址需部署者显式开启。',
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
  let reason = Reflect.get(value, 'connectionError');
  // Old Tooku versions returned these fixed local errors without a reason code.
  if (reason === undefined) {
    const legacy = Reflect.get(value, 'error');
    reason = legacy === '仅允许同源访问。' ? 'origin'
      : legacy === '此部署未开放私网音乐服务器。' ? 'private'
      : legacy === '音乐服务器地址不在允许范围内。' ? 'policy' : undefined;
  }
  if (typeof reason !== 'string' || !Object.hasOwn(messages, reason)) return;
  const message = messages[reason as NavidromeConnectionReason];
  const status = Reflect.get(value, 'upstreamStatus');
  return reason === 'http' && typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? `${message}（HTTP ${status}）` : message;
}
