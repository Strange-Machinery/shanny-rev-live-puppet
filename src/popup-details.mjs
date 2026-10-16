/**
 * Trust boundary for material allowed in Buff's public OBS alert.
 * Only a display name, formatted amount/currency and spoken message leave
 * the authenticated host. Transaction IDs, OAuth tokens and payment records
 * must never be published to viewer signaling.
 */
const SOURCES=new Set(['youtube','streamlabs','streamelements']);
export function preparePopupDetails({kind,donation,text,chatAuthor=null}={}){
  if(kind==='chat'){
    if(typeof text!=='string'||!text.trim()||text.length>450||
       typeof chatAuthor!=='string'||chatAuthor.length>60||
       /[\x00-\x1f\x7f]/.test(chatAuthor))
      throw new Error('Invalid live-chat popup');
    return Object.freeze({type:'chat',donor:chatAuthor||'YouTube viewer',message:text});
  }
  if(kind==='microphone')return Object.freeze({type:'hotmic'});
  if(kind!=='donation')throw new Error('Unknown popup origin');
  if(typeof text!=='string'||!text.trim()||text.length>1000)
    throw new Error('Popup donation message must be bounded speech');
  const message=text.trim();
  if(donation===undefined||donation===null)
    return Object.freeze({type:'test',message});
  if(typeof donation!=='object'||Array.isArray(donation)||
     !SOURCES.has(donation.provider)||
     typeof donation.donor!=='string'||donation.donor.length>80||
     !Number.isFinite(donation.amount)||donation.amount<=0||donation.amount>1e12||
     typeof donation.currency!=='string'||!/^[A-Z]{3}$/.test(donation.currency))
    throw new Error('Invalid verified donation display metadata');
  const donor=donation.donor.replace(/[\x00-\x1f\x7f]/g,' ').trim()||'Anonymous supporter';
  return Object.freeze({type:'donation',donor,amount:donation.amount,
    currency:donation.currency,message});
}
