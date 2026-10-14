import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DonationLedger } from '../src/donations/ledger.mjs';
import { DonationAdmission } from '../src/donations/parse.mjs';
test('donation IDs survive runner restart; ledger contains no donation text or raw IDs',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ledger-'));const path=join(dir,'ids');
  try {
    const first=new DonationLedger(path);assert.equal(first.reserve('private-platform-payment-1'),true);
    assert.throws(()=>new DonationLedger(path),/EEXIST/);first.close();
    const second=new DonationLedger(path);assert.equal(second.reserve('private-platform-payment-1'),false);second.close();
    assert.equal(readFileSync(path,'utf8').includes('private'),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('ledger capacity and torn crash journal fail closed without evicting donations',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ledger-'));const path=join(dir,'ids');
  try {
    const ledger=new DonationLedger(path,{maxEntries:1});ledger.reserve('one');assert.throws(()=>ledger.reserve('two'),/full/);ledger.close();
    appendFileSync(path,'broken');assert.throws(()=>new DonationLedger(path),/torn/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('session admission never evicts a recent ID to fit a new one',()=>{
  const admission=new DonationAdmission({maxEntries:1});admission.admit({donation_id:'one',text:'Hi'});
  assert.equal(admission.admit({donation_id:'two',text:'Hi'}).status,'busy');
  assert.equal(admission.admit({donation_id:'one',text:'Hi'}).status,'duplicate');
});
