/** Bound the response while reading it, rather than after allocating it. */
export async function readJson(reply, maxBytes = 64_000) {
  if (Number(reply.headers.get('content-length')) > maxBytes) {
    await reply.body?.cancel();
    throw new Error('Oversized JSON response');
  }
  const chunks = [];
  let size = 0;
  if (reply.body) {
    const reader = reply.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); throw new Error('Oversized JSON response'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Malformed JSON response'); }
}
