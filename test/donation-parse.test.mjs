import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDonationText, DonationAdmission } from '../src/donations/parse.mjs';

test('only a leading standalone tag selects a donation reader', () => {
  assert.deepEqual(parseDonationText('  (REV) Let me explain. (shanny)'), {
    actor: 'REV', text: 'Let me explain. (shanny)', override: true
  });
  assert.equal(parseDonationText('Hello (rev) from chat').actor, 'SHANNY');
  assert.equal(parseDonationText('(rev)hello').actor, 'SHANNY');
  assert.deepEqual(parseDonationText('(ShAnNy) Sure.'), {
    actor: 'SHANNY', text: 'Sure.', override: true
  });
  assert.throws(() => parseDonationText(' (rev)    '), /1-1000/);
  assert.throws(() => parseDonationText(''), /1-1000/);
  assert.throws(() => parseDonationText('x'.repeat(1001)), /1-1000/);
});

test('deduplicate donation IDs and enforce bounded rate', () => {
  let time = 100_000;
  const admission = new DonationAdmission({
    maxPerMinute: 2, dedupeMs: 120_000, now: () => time
  });
  assert.equal(admission.admit({ donation_id:'a', text:'hi'}).status, 'accepted');
  assert.equal(admission.admit({ donation_id:'a', text:'hi'}).status, 'duplicate');
  assert.equal(admission.admit({ donation_id:'b', text:'(rev) hi'}).actor, 'REV');
  assert.equal(admission.admit({ donation_id:'c', text:'third'}).status, 'rate_limited');
  time += 60_000;
  assert.equal(admission.admit({ donation_id:'c', text:'third'}).status, 'accepted');
  assert.equal(admission.admit({ donation_id:'a', text:'repeat'}).status, 'duplicate');
  time += 61_000;
  assert.equal(admission.admit({ donation_id:'a', text:'repeat'}).status, 'accepted');
  assert.throws(() => admission.admit({ donation_id:'', text:'hi'}), /donation_id/);
});
