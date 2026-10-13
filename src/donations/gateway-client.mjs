/**
 * Authenticated HTTP client for the standalone puppet gateway.
 * No public-network transport, platform hooks or token persistence.
 */
export function createLocalPuppetGateway({ url = 'http://127.0.0.1:8770',
  token, request = fetch, timeoutMs = 5000 } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(parsed.hostname) ||
      parsed.pathname !== '/' || parsed.username || parsed.password ||
      parsed.search || parsed.hash) {
    throw new Error('Live Puppet gateway must be a loopback HTTP origin');
  }
  if (typeof token !== 'string' || token.length < 12 ||
      typeof request !== 'function' ||
      !Number.isInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 30_000) {
    throw new Error('Invalid Puppet gateway credentials or timeout');
  }
  const origin = parsed.origin;
  async function call(method, path, body) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const reply = await request(origin + path, {
        method, redirect: 'error',
        headers: { Authorization: 'Bearer ' + token,
          ...(body === undefined ? {} : {'Content-Type': 'application/json'}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal
      });
      const raw = await reply.text();
      if (raw.length > 64_000) throw new Error('Oversized gateway response');
      let value;
      try { value = JSON.parse(raw); } catch {
        throw new Error('Malformed gateway JSON response');
      }
      if (!reply.ok) {
        const message = typeof value.error === 'string'
          ? value.error : 'Unknown gateway error';
        const error = new Error('Puppet gateway HTTP ' + reply.status + ': ' + message);
        error.status = reply.status;
        throw error;
      }
      return value;
    } finally {
      clearTimeout(timer);
    }
  }
  return Object.freeze({
    status: () => call('GET', '/v1/status'),
    metrics: () => call('GET', '/v1/metrics'),
    events: ({ after = 0, session_id } = {}) => {
      if (!Number.isSafeInteger(after) || after < 0 ||
          (session_id !== undefined && (typeof session_id !== 'string' ||
            !/^[a-z0-9-]{36}$/.test(session_id)))) {
        throw new Error('Invalid events cursor or session');
      }
      return call('GET', '/v1/events?after=' + after +
        (session_id ? '&session=' + encodeURIComponent(session_id) : ''));
    },
    speak: data => call('POST', '/v1/speak', data),
    release: data => call('POST', '/v1/release', data),
    discard: data => call('POST', '/v1/discard', data),
    panic: () => call('POST', '/v1/panic'),
    resume: () => call('POST', '/v1/resume')
  });
}
