/**
 * Public-facing Stank Tank browser overlay view model. Do not interpolate
 * untrusted donor text into HTML, CSS or URLs: stage-page.js uses textContent.
 * A missing/malformed public payload never guesses a donor or an amount.
 */
export function popupView(status){
  const hidden={visible:false,kind:'hidden',heading:'',donor:'',amount:'',message:''};
  if(!status||status.available!==true||status.presentation_visible!==true)return hidden;
  const p=status.popup;
  if(!p)return hidden;
  if(p.type==='hotmic')return {
    visible:true,kind:'hotmic',heading:'LIVE RESPONSE',
    donor:'',amount:'',message:''
  };
  if(p.type==='chat'&&typeof p.donor==='string'&&p.donor.length<=60&&
     typeof p.message==='string'&&p.message.length<=450)return {
    visible:true,kind:'chat',heading:'YOUTUBE LIVE CHAT',
    donor:p.donor,amount:'',message:p.message
  };
  if(p.type==='celebration')return {
    visible:true,kind:'celebration',heading:'MEMBERSHIP BOMB · MAKE IT RAIN',
    donor:'',amount:'',message:''
  };
  if(p.type==='test')return {
    visible:true,kind:'test',heading:'TEST DONATION',donor:'TEST ALERT',
    amount:'PREVIEW',message:typeof p.message==='string'?p.message.slice(0,1000):''
  };
  if(p.type!=='donation'||typeof p.donor!=='string'||p.donor.length>80||
     typeof p.message!=='string'||p.message.length>1000||
     typeof p.currency!=='string'||!/^[A-Z]{3}$/.test(p.currency)||
     !Number.isFinite(p.amount)||p.amount<=0||p.amount>1e12)
    return hidden;
  let formatted;
  try{formatted=new Intl.NumberFormat('en-US',{
    style:'currency',currency:p.currency,currencyDisplay:'symbol',
    maximumFractionDigits:2
  }).format(p.amount);}catch{return hidden;}
  return {
    visible:true,kind:'donation',heading:'DONATION ALERT',
    donor:p.donor.trim()||'ANONYMOUS SUPPORTER',
    amount:formatted+' '+p.currency,message:p.message
  };
}
