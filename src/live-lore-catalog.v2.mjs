import {LIVE_LORE_V1} from './live-lore-catalog.v1.mjs';
import {LIVE_LORE_EXTRAS_A} from './live-lore-extras-a.mjs';
import {LIVE_LORE_EXTRAS_B} from './live-lore-extras-b.mjs';
import {LIVE_LORE_EXTRAS_C} from './live-lore-extras-c.mjs';

// 119 source-tagged candidate callback families, compiled once at startup.
// The live matcher selects at most one current-superchat hook by default.
// Disputed community stories remain recognizable, never asserted as facts.
export const LIVE_LORE_V2=Object.freeze([
  ...LIVE_LORE_V1,...LIVE_LORE_EXTRAS_A,...LIVE_LORE_EXTRAS_B,...LIVE_LORE_EXTRAS_C
].map(row=>Object.freeze({...row,terms:Object.freeze([...row.terms])})));
