import {makeMicroInput as original} from './blackout-microdirector.mjs';
import {lookupLiveLore} from './live-lore-index.mjs';
export {echoFlags} from './blackout-microdirector.mjs';
export function makeMicroInput(input){return {...original(input),contextual_grievance_hooks:lookupLiveLore(input.text)};}
