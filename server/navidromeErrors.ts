import { DataError } from './store.ts';
import { navidromeConnectionMessage, type NavidromeConnectionReason } from '../src/domain/navidromeConnection.ts';

export class NavidromeConnectionError extends DataError {
  connectionError: NavidromeConnectionReason;
  upstreamStatus?: number;
  constructor(reason: NavidromeConnectionReason, upstreamStatus?: number) {
    super(['origin', 'private', 'policy'].includes(reason) ? 403 : 502, navidromeConnectionMessage({ connectionError: reason, upstreamStatus })!);
    this.connectionError = reason;
    this.upstreamStatus = upstreamStatus;
  }
}

export function connectionFailure(error: unknown): NavidromeConnectionError {
  if (error instanceof NavidromeConnectionError) return error;
  if (error instanceof AggregateError) {
    const failures = error.errors.map(connectionFailure);
    return failures.find((failure) => failure.connectionError !== 'interrupted') ?? new NavidromeConnectionError('network');
  }
  const code = error && typeof error === 'object' ? Reflect.get(error, 'code') : undefined;
  const reason = typeof code === 'string' && (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(code)) ? 'tls'
    : code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'dns'
    : code === 'ETIMEDOUT' ? 'timeout' : code === 'ECONNREFUSED' ? 'refused'
    : code === 'ENETUNREACH' || code === 'EHOSTUNREACH' ? 'network' : 'interrupted';
  return new NavidromeConnectionError(reason);
}
