/**
 * Per-superchat grounding for the EXISTING one-pass Qwen director.
 * No network, embedding, model, disk read, transcript lookup or retry.
 *
 * Qwen is intentionally NOT fed all prior character notes or old episode
 * samples: those high-salience nouns are often copied into unrelated replies.
 */
const WORDS=/[a-z0-9][a-z0-9'-]*/gi;
const STOP=new Set([
 'a','about','again','all','also','an','and','are','at','be','because',
 'been','but','by','can','chat','could','did','do','does','donation',
 'donated','donor','for','from','go','had','has','have','he','her','hey','him',
 'his','how','i','in','is','it','its','just','like','me','more','my',
 'of','on','or','our','please','rev','shanny','so','some','superchat',
 'tell','than','that','the','their','them','then','there','these','they',
 'this','those','to','too','up','us','was','we','were','what','when',
 'where','who','why','will','with','would','you','your','yours'
]);
const FOOD=/\b(?:bread|sandwich(?:es)?|ingredient(?:s)?|recipe(?:s)?|flour|dough|toast|crust|cookies?|pizza|burger|fries|ramen|kitchen|cooking|baking|bake|cheese|potatoes?|soup|lunch|dinner|breakfast|hungry|meal|food)\b/i;
const QUOTED_FOOD_LORE=new Set([
 'emergency-cookies','diet-coke','air-fryer','shanny-kitchen-nightmares',
 'shanny-hungry-smash','rev-hungry-boy','burger-fries-demand','boba-tea',
 'foodie-beauty','foodie-beauty-crusade','foodie-donation'
]);

export function focusTerms(text,{limit=5}={}){
 if(typeof text!=='string'||!text.trim())return [];
 if(!Number.isInteger(limit)||limit<0||limit>12)throw Error('Invalid focus term budget');
 const seen=new Set();
 for(const word of (text.toLowerCase().match(WORDS)||[])){
   const token=word.replace(/^'+|'+$/g,'');
   if(token.length<3||STOP.has(token))continue;
   seen.add(token);
   if(seen.size>=limit)break;
 }
 return [...seen];
}
export function hasCurrentFoodTopic(input,hookIds=[]){
 if(FOOD.test(String(input||'')))return true;
 return Array.isArray(hookIds)&&hookIds.some(id=>QUOTED_FOOD_LORE.has(id));
}
export function detectTopicDrift({input,hooks=[],plan}){
 if(typeof input!=='string'||!plan||!Array.isArray(plan.lines))return null;
 const hookIds=hooks.map(x=>x?.id);
 const spoken=[String(plan.hinge||''),...plan.lines.map(x=>String(x?.text||''))].join(' ');
 // A real question about food, or an explicitly matched culinary lore card,
 // remains eligible. Never impose a global food-word ban.
 if(!hasCurrentFoodTopic(input,hookIds)&&FOOD.test(spoken))
   return 'UNRELATED_FOOD_THEME';
 return null;
}
