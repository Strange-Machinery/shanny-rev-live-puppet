/**
 * Provider event adapters. These are parsers, NOT authenticators. Call only from
 * an authenticated producer-owned feed (YouTube OAuth, Streamlabs socket token,
 * or an acknowledged StreamElements Astro subscription).
 *
 * IDs are payment/message IDs, never text/amount fingerprints. Source authority
 * prevents the same YouTube purchase playing again through an alert mirror.
 */
export const DEFAULT_DONATION_AUTHORITY=Object.freeze({
  superchat:'youtube',streamlabs_tip:'streamlabs',streamelements_tip:'streamelements'
});

function id(value) {
  if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0)value=String(value);
  return typeof value==='string'&&value.length>0&&value.length<=120&&
    /^[a-zA-Z0-9._:-]+$/.test(value)?value:null;
}
function currency(value) {return typeof value==='string'&&/^[A-Z]{3}$/.test(value)?value:null;}
function amount(value) {
  const number=typeof value==='string'&&value.trim()?Number(value):value;
  return typeof number==='number'&&Number.isFinite(number)&&number>0&&number<=1e12?number:null;
}
function micros(value) {
  if(!/^\d+$/.test(String(value??'')))return null;
  const n=Number(value);
  return Number.isSafeInteger(n)?amount(n/1e6):null;
}
function stamp(value) {
  if(typeof value!=='string'||!value||!Number.isFinite(Date.parse(value)))return null;
  return new Date(value).toISOString();
}
function safeName(value) {return typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,80):'';}
function speech(value,donor,sum,unit) {
  const raw=typeof value==='string'?value.replace(/[\x00-\x08\x0b-\x1f\x7f]/g,' ').trim():'';
  return raw?raw.slice(0,1000):(donor||'A supporter')+' donated '+unit+' '+sum.toFixed(2)+'.';
}
function paid({donation_id,source,kind,external_id,timestamp,donor,message,sum,unit}) {
  if(!donation_id||!external_id||sum===null||!unit)return null;
  return Object.freeze({donation_id,source,kind,external_id,timestamp,donor,
    text:speech(message,donor,sum,unit),amount:sum,currency:unit});
}
function allow(authority,key,source) {return authority[key]===source;}

/** A liveChatMessage superChatEvent or an authorized superChatEvents.list row.
 * Excludes Super Stickers, subscriptions, ordinary text, and gifts by default.
 */
export function normalizeYoutubeSuperChat(raw,{authority=DEFAULT_DONATION_AUTHORITY}={}) {
  if(!allow(authority,'superchat','youtube')||!raw||typeof raw!=='object')return [];
  const historical=raw.kind==='youtube#superChatEvent';
  if(!historical&&raw.snippet?.type!=='superChatEvent')return [];
  const s=raw.snippet||{};
  if(historical&&s.isSuperStickerEvent)return [];
  const details=historical?s:s.superChatDetails;
  const external=id(raw.id),sum=micros(details?.amountMicros),unit=currency(details?.currency);
  const donor=safeName(historical?s.supporterDetails?.displayName:raw.authorDetails?.displayName);
  const payment=paid({donation_id:external?'youtube:superchat:'+external:null,
    source:'youtube',kind:'superchat',external_id:external,
    timestamp:stamp(historical?s.createdAt:s.publishedAt),donor,
    message:historical?s.commentText:details?.userComment,sum,unit});
  return payment?[payment]:[];
}

/** Streamlabs Socket API "event" payload. message is ALWAYS an array.
 * Its YouTube superchat mirror is denied unless deliberately authoritative.
 */
export function normalizeStreamlabsEvent(frame,{authority=DEFAULT_DONATION_AUTHORITY}={}) {
  if(!frame||typeof frame!=='object'||!Array.isArray(frame.message))return [];
  // Streamlabs' own donation sample also appears with for:'youtube_account'.
  // Only type:'superchat' is treated as a mirrored YouTube purchase.
  const direct=frame.type==='donation'&&(!frame.for||['streamlabs','youtube_account','twitch_account'].includes(frame.for));
  const mirror=frame.type==='superchat'&&frame.for==='youtube_account';
  if(!direct&&!mirror)return [];
  if(!allow(authority,direct?'streamlabs_tip':'superchat','streamlabs'))return [];
  return frame.message.slice(0,50).map(row=>{
    if(!row||typeof row!=='object')return null;
    const external=id(row.id??row._id),unit=currency(row.currency);
    const sum=mirror?micros(row.amount):amount(row.amount);
    const donor=safeName(row.name||row.from);
    return paid({donation_id:external?(mirror?'youtube:superchat:':'streamlabs:donation:')+external:null,
      source:'streamlabs',kind:mirror?'superchat':'streamlabs_tip',external_id:external,
      timestamp:stamp(row.createdAt||row.created_at),donor,
      message:mirror?row.comment:row.message,sum,unit});
  }).filter(Boolean);
}

/** Astro channel.tips only; activity alerts can mirror it and are ignored.
 * A transaction is eligible only when SUCCESS and ALLOWED.
 */
export function normalizeStreamElementsTip(frame,{authority=DEFAULT_DONATION_AUTHORITY}={}) {
  if(!allow(authority,'streamelements_tip','streamelements')||
     frame?.type!=='message'||frame?.topic!=='channel.tips')return [];
  const d=frame.data;
  if(!d||d.status!=='success'||d.approved!=='allowed'||
    (frame.room&&d.channel!==frame.room))return [];
  const external=id(d._id),sum=amount(d.donation?.amount),unit=currency(d.donation?.currency);
  const donor=safeName(d.donation?.user?.username);
  const payment=paid({donation_id:external?'streamelements:tip:'+external:null,
    source:'streamelements',kind:'streamelements_tip',external_id:external,
    timestamp:stamp(d.createdAt),donor,message:d.donation?.message,sum,unit});
  return payment?[payment]:[];
}

/** Never give audience-supplied JSON the authority to select its own adapter.
 * The caller chooses source based on the authenticated connection.
 */
export function normalizeProviderEvent(source,raw,options) {
  switch(source) {
    case 'youtube':return normalizeYoutubeSuperChat(raw,options);
    case 'streamlabs':return normalizeStreamlabsEvent(raw,options);
    case 'streamelements':return normalizeStreamElementsTip(raw,options);
    default:throw new Error('Unknown authenticated provider');
  }
}
