/**
 * Donation text is untrusted audience data. Only a leading, standalone
 * (shanny)/(rev) token selects the speaker. All later parentheses are spoken.
 */
export function parseDonationText(raw) {
  if (typeof raw !== 'string') throw new TypeError('Donation text must be a string');
  const head = raw.trimStart();
  const tag = /^\((shanny|rev)\)(?=\s|$)/i.exec(head);
  const actor = tag ? tag[1].toUpperCase() : 'SHANNY';
  const text = (tag ? head.slice(tag[0].length).trimStart() : head).trimEnd();
  if (!text || text.length > 1000) {
    throw new RangeError('Donation must contain 1-1000 readable characters');
  }
  return { actor, text, override: Boolean(tag) };
}

/** Bounded, in-memory, per-session idempotency and rate admission.
 * The upstream platform adapter must authenticate donation provenance.
 * On process restart it MUST reconcile platform IDs; this is not a ledger.
 */
export class DonationAdmission {
  constructor({ maxPerMinute = 8, maxEntries = 1024,
    dedupeMs = 60 * 60_000, now = Date.now } = {}) {
    if (![maxPerMinute, maxEntries, dedupeMs].every(v => Number.isSafeInteger(v) && v > 0)
      || typeof now !== 'function') throw new TypeError('Invalid donation admission limits');
    this.maxPerMinute = maxPerMinute;
    this.maxEntries = maxEntries;
    this.dedupeMs = dedupeMs;
    this.now = now;
    this.ids = new Map();
    this.acceptedAt = [];
  }

  admit({ donation_id, text }) {
    if (typeof donation_id !== 'string' || !donation_id.trim()
      || donation_id.length > 128) throw new TypeError('Invalid donation_id');
    const parsed = parseDonationText(text);
    const time = this.now();
    if (!Number.isFinite(time)) throw new Error('Invalid clock');
    for (const [id, accepted] of this.ids) {
      if (time - accepted >= this.dedupeMs) this.ids.delete(id);
    }
    this.acceptedAt = this.acceptedAt.filter(t => time - t < 60_000);
    if (this.ids.has(donation_id)) return { status: 'duplicate', donation_id };
    if (this.acceptedAt.length >= this.maxPerMinute) {
      return { status: 'rate_limited', donation_id };
    }
    while (this.ids.size >= this.maxEntries) this.ids.delete(this.ids.keys().next().value);
    this.ids.set(donation_id, time);
    this.acceptedAt.push(time);
    return { status: 'accepted', donation_id, ...parsed };
  }
}
