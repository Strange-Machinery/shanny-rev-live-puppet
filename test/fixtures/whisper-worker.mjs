import {createInterface} from 'node:readline';
const emit=value=>console.log('LIVE_WHISPER '+JSON.stringify(value));
emit({type:'READY'});
createInterface({input:process.stdin}).on('line',line=>{
  const message=JSON.parse(line);
  if(message.audioPath==='hang')return;
  if(message.audioPath==='malformed'){emit({type:'RESULT',id:message.id,result:{text:'bad',final:false}});return;}
  emit({type:'RESULT',id:message.id,result:{text:'Worker '+process.pid,final:true,source:'OFFLINE_WAV'}});
});
