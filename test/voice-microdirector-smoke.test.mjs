import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyEpisodeCode} from '../src/approved-delivery.mjs';
test('approved codes are actor-scoped',()=>{
 assert.equal(verifyEpisodeCode('SHANNY','S07'),true);
 assert.equal(verifyEpisodeCode('REV','S07'),false);
 assert.equal(verifyEpisodeCode('REV','R11'),true);
});
