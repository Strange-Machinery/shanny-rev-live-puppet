export const actorMoods={SHANNY:['anger','rage','crying','smug','surprised'],REV:['pacifying','irritated','rage','skeptical','surprised']};
export function liveMood(actor,mood){
 if(!actorMoods[actor])throw new Error('Unknown expression actor');
 if(mood===undefined)return actor==='SHANNY'?'anger':'skeptical';
 if(!actorMoods[actor].includes(mood))throw new Error('Unknown actor expression mood');
 return mood;
}
