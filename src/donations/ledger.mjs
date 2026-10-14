import { openSync, closeSync, readFileSync, writeSync, fsyncSync, unlinkSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** At-most-once admission across crashes. Reserve BEFORE any speech request.
 * A crash after reservation can lose a read; it must never replay a paid ID.
 * Keep this file private and backed up. Capacity fails closed, never evicts IDs.
 */
export class DonationLedger {
  constructor(path, { maxEntries = 100_000 } = {}) {
    this.path = path;
    this.lockPath = path + '.lock';
    this.maxEntries = maxEntries;
    this.ids = new Set();
    this.lock = openSync(this.lockPath, 'wx', 0o600);
    try {
      this.fd = openSync(path, 'a+', 0o600);
      if (statSync(path).size > maxEntries * 65) throw new Error('Donation ledger capacity exceeded');
      const content = readFileSync(path, 'utf8');
      if (content && !content.endsWith('\n')) throw new Error('Donation ledger is torn; reconcile upstream before repair');
      for (const line of content.split('\n').filter(Boolean)) {
        if (!/^[a-f0-9]{64}$/.test(line)) throw new Error('Invalid donation ledger');
        this.ids.add(line);
      }
    } catch (error) { this.close(); throw error; }
  }
  reserve(id) {
    if (typeof id !== 'string' || !id.trim() || id.length > 128) throw new Error('Invalid durable donation ID');
    if (this.fd === undefined) throw new Error('Donation ledger closed');
    const digest = createHash('sha256').update(id).digest('hex');
    if (this.ids.has(digest)) return false;
    if (this.ids.size >= this.maxEntries) throw new Error('Donation ledger full; reconcile upstream');
    const row = Buffer.from(digest + '\n');
    if (writeSync(this.fd, row) !== row.length) throw new Error('Incomplete donation ledger write');
    fsyncSync(this.fd);
    this.ids.add(digest);
    return true;
  }
  has(id) {
    if (typeof id !== 'string' || !id.trim() || id.length > 128) throw new Error('Invalid durable donation ID');
    return this.ids.has(createHash('sha256').update(id).digest('hex'));
  }
  close() {
    if (this.fd !== undefined) { closeSync(this.fd); this.fd = undefined; }
    if (this.lock !== undefined) { closeSync(this.lock); this.lock = undefined; unlinkSync(this.lockPath); }
  }
}
