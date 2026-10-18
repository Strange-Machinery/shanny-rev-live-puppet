import {readFileSync} from 'node:fs';
export const argumentCallbacks = JSON.parse(readFileSync(new URL('./argue-callbacks.json', import.meta.url), 'utf8'));

function boundedText(text, limit) {
  return typeof text === 'string' && text.trim() && text.length <= limit && !/[\u0000-\u0008\u000b-\u001f]/.test(text);
}

// Called by the trusted host boundary, never by parsing quoted chat as an event.
// Announcement is separate so a future host can queue it before the reaction.
export function prepareDyadInput({kind='chat',text='',history=[],donation,cardId} = {}) {
  if (!['chat','microphone','donation','argument'].includes(kind)) throw Error('Invalid dyad kind');
  if (!Array.isArray(history)) throw Error('Invalid dyad history');
  const recent = history.slice(-8).map(row => {
    if (!row || !['SHANNY','REV'].includes(row.actor) || !boundedText(row.text,240)) throw Error('Invalid dyad history');
    return {actor:row.actor,text:row.text};
  });
  const record = {kind,donation_no_message:false,input:text,history:recent};
  let announcement = null;
  if (kind === 'argument') {
    const card = argumentCallbacks.find(row => row.id === cardId);
    if (!card) throw Error('ARGUE needs a known contextual card');
    record.input = 'Buff requests an incensed argument about this lore card; Shanny rages, Rev argues his own specific grievance.';
    record.lore_card = {subject:card.subject,context:card.context,argument_focus:card.argument_focus};
  } else if (kind === 'donation') {
    if (!donation || !boundedText(donation.donor,80) || /[\r\n<>]/.test(donation.donor) ||
        !Number.isSafeInteger(donation.amountMinor) || donation.amountMinor <= 0 ||
        !/^[A-Z]{3}$/.test(donation.currency) || typeof donation.message !== 'string' || donation.message.length > 1000) throw Error('Invalid trusted donation');
    // This experiment accepts currencies with two minor-unit digits only.
    const format = new Intl.NumberFormat('en-US',{style:'currency',currency:donation.currency,currencyDisplay:donation.currency==='USD'?'symbol':'code'});
    if (format.resolvedOptions().maximumFractionDigits !== 2) throw Error('Unsupported donation currency precision');
    announcement = `${donation.donor.trim()} donated ${format.format(donation.amountMinor/100)}.`;
    record.donation_no_message = !donation.message.trim();
    record.input = record.donation_no_message ? announcement : donation.message;
  } else if (!boundedText(text,1000)) throw Error('Invalid dyad input');
  return {record,announcement};
}
