import {actorMoods} from '../live-moods.mjs';

// Same generation schema as the installed full-dyad control.
const sentencePattern = /^[^.!?"\\\r\n]{1,200}[.!?]$/;
const rowSchema = {anyOf:Object.entries(actorMoods).map(([actor,moods]) => ({
  type:'object',additionalProperties:false,required:['actor','text','mood'],
  properties:{actor:{const:actor},text:{type:'string',pattern:sentencePattern.source},mood:{type:'string',enum:moods}}
}))};
const rageRowSchema = {...rowSchema,anyOf:rowSchema.anyOf.map(row => ({...row,properties:{...row.properties,mood:{const:'rage'}}}))};
export const dyadSchema = {anyOf:[false,true].map(bonus => ({
  type:'object',additionalProperties:false,required:['rage_bonus','lines','rev_reason'],
  properties:{rage_bonus:{const:bonus},lines:{type:'array',minItems:bonus?6:2,maxItems:bonus?8:3,
    ...(bonus?{prefixItems:[rowSchema,rowSchema,rowSchema],items:rageRowSchema}:{items:rowSchema})},
  rev_reason:{type:'string',maxLength:80}}
}))};
// Resolve only an explicit leading vocative; indirect addressees remain the
// writer's job. This is not lore retrieval or an extra inference call.
export function explicitAddressee(record) {
  if(record?.kind==='argument')return null;
  return /^\s*(?:hey\s+)?(rev|shanny)\s*[,!:]/i.exec(record?.input||'')?.[1].toUpperCase()||null;
}
export function schemaForRecord(record) {
  const first=explicitAddressee(record);
  if(!first)return dyadSchema;
  const firstRow={anyOf:rowSchema.anyOf.filter(row=>row.properties.actor.const===first)};
  return {anyOf:dyadSchema.anyOf.map(branch=>({...branch,properties:{...branch.properties,lines:{...branch.properties.lines,
    prefixItems:branch.properties.rage_bonus.const?[firstRow,rowSchema,rowSchema]:[firstRow]}}}))};
}
const exactKeys = (value, keys) => value && !Array.isArray(value) && typeof value === 'object' && Object.keys(value).sort().join(',') === keys;
const segments = new Intl.Segmenter('en', {granularity:'sentence'});

export function validateDyad(raw, record) {
  const p = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!exactKeys(p,'lines,rage_bonus,rev_reason') || typeof p.rage_bonus !== 'boolean' ||
      typeof p.rev_reason !== 'string' || p.rev_reason.length > 80 || !Array.isArray(p.lines)) throw Error('Invalid dyad response');
  if (p.rage_bonus ? p.lines.length < 6 || p.lines.length > 8 : p.lines.length < 2 || p.lines.length > 3) throw Error('Only rage earns 6–8 sentences');
  for (const [i,row] of p.lines.entries()) {
    if (!exactKeys(row,'actor,mood,text') || !actorMoods[row.actor]?.includes(row.mood) ||
        typeof row.text !== 'string' || !row.text.trim() || !sentencePattern.test(row.text) ||
        row.text.trim().split(/\s+/).length > 35 || [...segments.segment(row.text)].length !== 1 ||
        /[\u0000-\u001f<>\[\]{}*]|https?:|\b(?:SHANNY|REV)\s*:/i.test(row.text)) throw Error('Invalid dyad sentence');
    if (i >= 3 && row.mood !== 'rage') throw Error('Only rage may use bonus airtime');
    if (/\bwart[sz]\b/i.test(row.text) && (row.actor !== 'REV' || row.mood !== 'rage')) throw Error('WARTZ requires Rev rage');
    // Narrow known regression check, not a claim of general semantic safety.
    if (/\b(?:gut|stab|shoot|kill|murder)\s+(?:you|whoever|anyone|them|him|her)\b/i.test(row.text)) throw Error('Dyad returned a violent threat');
    if (/\b(?:I|we)\s+(?:will|shall|am going to|are going to)\s+(?:throw|hit|punch|kick)\b.*\b(?:you|your)\b/i.test(row.text) || /\b(?:I'll|we'll)\s+(?:throw|hit|punch|kick)\b.*\b(?:you|your)\b/i.test(row.text)) throw Error('Dyad returned a violent threat');
  }
  if (!['SHANNY','REV'].every(actor => p.lines.some(row => row.actor === actor))) throw Error('Both characters must participate');
  const first=explicitAddressee(record);
  if(first&&p.lines[0].actor!==first)throw Error('Invalid dyad addressee');
  return p;
}
