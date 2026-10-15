import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupLiveLore,liveLoreStats} from '../src/live-lore-index.mjs';
test('compiled lore index',()=>{assert.equal(liveLoreStats().hooks,119);assert.ok(liveLoreStats().aliases>=600);assert.deepEqual(lookupLiveLore('Hi there'),[]);});
