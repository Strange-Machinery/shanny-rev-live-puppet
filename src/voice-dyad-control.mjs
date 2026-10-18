import {voiceDyadLiteCodes} from './voice-dyad-lite.mjs';

/** Producer switch for saved voices only. Never selects a dialogue writer. */
export function createVoiceDyadControl({config,getCodes,eligible=true,isBusy=()=>false,getTurn=()=>null}){
  let active=config.dyadEnabled!==false,changing=false;
  const turns=new WeakMap();
  const available=()=>eligible&&Object.entries(voiceDyadLiteCodes).every(([actor,moods])=>
    [...new Set(Object.values(moods))].every(code=>getCodes()?.[actor]?.includes(code)));
  const enabled=()=>active&&available();
  const status=()=>({kind:'voice-dyad-lite',enabled:enabled(),available:available(),changing,
    state:changing?'saving':enabled()?'ready':'off',writer:'gold',extra_model_calls:0,
    error:active&&!available()?'Required saved voice categories are unavailable.':''});
  return {status,
    forTurn(){
      const turn=getTurn();
      if(!turn)return enabled();
      // A new response may enter while persistence is awaiting disk I/O.
      // Keep its first voice choice for the whole response, including read rows.
      if(!turns.has(turn))turns.set(turn,enabled());
      return turns.get(turn);
    },
    async setEnabled(value){
      if(typeof value!=='boolean')throw Error('Dyad requires an on/off choice.');
      if(!available())throw Error('Dyad saved voices are unavailable.');
      if(changing||isBusy())throw Error('Finish the exchange or press STOP before changing Dyad.');
      const previous=config.dyadEnabled;changing=true;config.dyadEnabled=value;
      try{
        await config.save?.();active=value;changing=false;
        return {...status(),message:value?'Dyad on · enhanced saved voices; GOLD dialogue.':'Dyad off · standard voices; GOLD dialogue.'};
      }catch(error){
        if(previous===undefined)delete config.dyadEnabled;else config.dyadEnabled=previous;
        throw error;
      }finally{changing=false;}
    }
  };
}
