import {actorMoods,liveMood} from './live-moods.mjs';
import {availableEpisodeCodes,guideForEpisodeCodes} from './approved-delivery.mjs';
import {makeMicroInput,echoFlags} from './blackout-microdirector.mjs';

/** One existing Qwen call. A short causal hinge precedes performed dialogue. */
const sentences=text=>[...new Intl.Segmenter('en',{granularity:'sentence'}).segment(text)].filter(v=>v.segment.trim()).length;
function line(row,codes){
  const actor=row?.actor;
  if(!actorMoods[actor]||typeof row.text!=='string'||!row.text.trim()||
     row.text.length>160||row.text.trim().split(/\s+/).length>35||
     sentences(row.text)!==1||/[\u0000-\u001f]|<\/?think>/i.test(row.text))
    throw Error('Invalid Microdirector spoken line');
  if(typeof row.mood!=='string')throw Error('Microdirector mood missing');
  liveMood(actor,row.mood);
  const available=codes[actor]||[];
  const keys=Object.keys(row).sort().join(',');
  if(keys!==(available.length?'actor,delivery,mood,text':'actor,mood,text'))
    throw Error('Microdirector voice fields mismatch');
  if(available.length&&!available.includes(row.delivery))throw Error('Unqualified reference category');
  return {actor,text:row.text.trim(),mood:row.mood,
    ...(available.length?{delivery:row.delivery}:{})};
}
export function validateMicroPlan(raw,kind,codes={}){
  const p=typeof raw==='string'?JSON.parse(raw):raw;
  if(!p||Array.isArray(p)||Object.keys(p).sort().join(',')!=='hinge,lines,rev_reason'||
     typeof p.hinge!=='string'||p.hinge.trim().length<12||p.hinge.length>160||
     typeof p.rev_reason!=='string'||p.rev_reason.length>80||
     !Array.isArray(p.lines)||p.lines.length<2||p.lines.length>3||
     !['donation','microphone'].includes(kind))throw Error('Invalid causal Microdirector plan');
  const usable=availableEpisodeCodes(codes);
  const lines=p.lines.map(row=>line(row,usable));
  if(kind==='donation'&&(!lines.some(v=>v.actor==='SHANNY')||!lines.some(v=>v.actor==='REV')))
    throw Error('Donation requires both characters');
  if(kind==='microphone'&&!lines.some(v=>v.actor==='SHANNY'))throw Error('Shanny must respond');
  if(lines.some(v=>v.actor==='REV')&&!p.rev_reason.trim())throw Error('Rev needs an actual argument');
  return {hinge:p.hinge.trim(),lines,rev_reason:p.rev_reason.trim()};
}
/** Speculative synthesis is safe: this never releases partial text. */
export function firstMicroLine(raw,codes={}){
  if(typeof raw!=='string'||raw.length>4000)return null;
  const start=/^\s*\{\s*"hinge"\s*:\s*"(?:[^"\\]|\\.)*"\s*,\s*"lines"\s*:\s*\[\s*/.exec(raw);
  if(!start||raw[start[0].length]!=='{')return null;
  let end=-1,level=0,inString=false,escaped=false;
  for(let i=start[0].length;i<raw.length;i++){
    const ch=raw[i];
    if(inString){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inString=false;continue;}
    if(ch==='"'){inString=true;continue;}
    if(ch==='{')level++;
    else if(ch==='}'&&--level===0){end=i+1;break;}
  }
  if(end<0||!/^\s*[,|\]]/.test(raw.slice(end)))return null;
  try{return line(JSON.parse(raw.slice(start[0].length,end)),availableEpisodeCodes(codes));}
  catch{return null;}
}
function exchangeSchema(codes){
  return {type:'object',additionalProperties:false,
    required:['hinge','lines','rev_reason'],properties:{
      hinge:{type:'string',minLength:12,maxLength:160},
      lines:{type:'array',minItems:2,maxItems:3,
        items:{anyOf:Object.entries(actorMoods).map(([actor,moods])=>{
          const allowed=codes[actor]||[];
          return {type:'object',additionalProperties:false,
            required:allowed.length?['actor','text','mood','delivery']:['actor','text','mood'],
            properties:{actor:{type:'string',enum:[actor]},
              text:{type:'string',pattern:/^[^.!?"\\\r\n]{1,159}[.!?]$/.source},
              mood:{type:'string',enum:moods},
              ...(allowed.length?{delivery:{type:'string',enum:allowed}}:{})}};
        })}},
      rev_reason:{type:'string',maxLength:80}
    }};
}
export function createBlackoutMicrodirector({complete,notes,examples=[],getDeliveryCodes=()=>({})}={}){
  if(typeof complete!=='function'||typeof notes!=='string'||!notes.trim()||
     notes.length>8000||!Array.isArray(examples)||examples.length>3||
     typeof getDeliveryCodes!=='function')throw Error('Invalid private Microdirector configuration');
  return {
    audit:({history=[]}={})=>echoFlags(notes,examples,history),
    async warmup(){await this.generate({text:'Startup check',kind:'microphone',warmup:true});},
    async generate({text,kind,history=[],hinges=[],signal,warmup=false,onFirstLine}={}){
      if(typeof text!=='string'||!text.trim()||text.length>1000||
         !['donation','microphone'].includes(kind))throw Error('Invalid Microdirector input');
      const codes=availableEpisodeCodes(getDeliveryCodes());
      const system=[
        'Write the live fictional adult Blackout SHANNY and REV cartoon. Buff is the host. This is ONE Qwen completion, not a multi-stage writing engine.',
        'First decide in "hinge": precisely what the incoming remark threatens, embarrasses, or contradicts, and why the second character reacts. Then write 2-3 grounded lines; do not imitate generic rage.',
        'SHANNY is surly, entitled, quick to defend her dignity and can seize the floor. REV resents being patronized, spots contradictions, is argumentative and may snap back. They may cooperate when earned. Neither automatically wins or pacifies. Address the actual viewer and each other.',
        'Treat the supplied grievance hooks as optional triggers, not obligations. Bucket, Ezzie, Baby Carrot and congealed are recognizable callbacks, but only mention one when it has an input-related causal bridge. Never fabricate a congealed incident, convert a character allegation to confirmed fact, or replace the actual topic with nostalgic lore.',
        'Old voice-reference clips, example transcripts and private notes are BACKGROUND, never lines to quote. Do not copy stale slogans or unrelated food imagery. A refusal/consent slogan requires a consent issue; food jokes require a food connection.',
        'Select an episode-approved delivery code only from each actor available list. Calm contempt differs from shouting; severe rage must follow severe provocation. Do not pitch-shift, force squealing or automatically shout. Delivery selects a preapproved NATURAL cloned-voice reference.',
        'Return JSON keys in exact order: hinge, lines, rev_reason. Keep hinge at 12-160 characters; each line one spoken sentence, 8-16 words preferred, with actor, text, mood and delivery if available. Mood is for face and baseline affect, not a command to manipulate pitch. Give both characters agency for a donation; Rev must contribute an identifiable rebuttal or agreement, not boilerplate.',
        'AVAILABLE DELIVERY CODES:\n'+(guideForEpisodeCodes(codes)||'none; use actor, text and mood only'),
        'PRIVATE CHARACTER BACKGROUND (not the current scene):\n'+notes
      ].join('\n');
      const messages=[{role:'system',content:system}];
      for(const example of examples){
        // Old few-shots can silently inject completely unrelated callbacks.
        if(example?.microdirector!==true)continue;
        const p=validateMicroPlan(example.response,example.kind,codes);
        messages.push({role:'user',content:JSON.stringify({kind:example.kind,input:example.input})},
          {role:'assistant',content:JSON.stringify(p)});
      }
      messages.push({role:'user',content:JSON.stringify({
        ...makeMicroInput({text,kind,history,hinges}),
        direction:'One concrete cause, two character reactions. Keep original comment central. Explain any callback by its relevance, not by inventing biography.'
      })});
      let responseSchema=exchangeSchema(codes);
      if(warmup){
        messages[messages.length-1]={role:'user',content:'Silent startup check: return only {"ready":true}.'};
        responseSchema={type:'object',additionalProperties:false,required:['ready'],
          properties:{ready:{const:true}}};
        const raw=await complete({messages,signal,responseSchema});
        if((typeof raw==='string'?JSON.parse(raw):raw)?.ready!==true)throw Error('Microdirector startup check failed');
        return;
      }
      let first=null;
      const onText=typeof onFirstLine==='function'?raw=>{
        if(!first){const p=firstMicroLine(raw,codes);if(p){first=p;onFirstLine(p);}}
      }:undefined;
      const plan=validateMicroPlan(await complete({messages,signal,responseSchema,onText}),kind,codes);
      if(first&&JSON.stringify(first)!==JSON.stringify(plan.lines[0]))
        throw Error('Speculatively prepared line differed from final approved plan');
      return plan;
    }
  };
}
