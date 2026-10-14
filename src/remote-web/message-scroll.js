/**
 * Readable long paid-alert messages, without truncating public donor text.
 * One scroll per presentation nonce; repeated media-poll renders never rewind.
 * No DOM injection, no scroll beyond the clipped plaque and no timers survive
 * STOP, "Shut up", disconnection or a new paid alert.
 */
export function createMessageScroller({
  viewport,content,progress,
  now=()=>performance.now(),
  requestFrame=callback=>requestAnimationFrame(callback),
  cancelFrame=id=>cancelAnimationFrame(id),
  reducedMotion=()=>typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches
}={}){
  if(!viewport||!content||!progress)throw new Error('Donation message viewport required');
  let frame=null,key=null,active=false;
  const stopFrame=()=>{if(frame!==null){cancelFrame(frame);frame=null;}};
  const reset=()=>{
    stopFrame();active=false;key=null;
    viewport.scrollTop=0;
    progress.hidden=true;progress.textContent='';
  };
  const show=({text,nonce}={})=>{
    if(typeof text!=='string')throw new Error('Donation message must be text');
    const nextKey=String(nonce||'local')+':'+text;
    if(active&&key===nextKey)return;
    reset();active=true;key=nextKey;
    content.textContent=text;viewport.scrollTop=0;
    const height=Math.max(0,Number(viewport.clientHeight)||0);
    const total=Math.max(0,Number(content.scrollHeight)||0);
    const distance=Math.max(0,total-height);
    if(distance<=2||height<=0)return;
    const pages=Math.max(2,Math.ceil(total/height));
    progress.hidden=false;
    const label=value=>{
      const page=Math.min(pages,1+Math.floor((value/Math.max(1,distance))*(pages-1)));
      progress.textContent='↓ '+page+' / '+pages;
    };
    label(0);
    // Approximate an intelligible donation-reading pace; never hold the
    // popup open after native playback ends solely to finish scrolling.
    const travelMs=Math.min(85000,Math.max(8500,text.length*62));
    const leadMs=1800,started=now();
    const scroll=()=>{
      frame=null;
      if(!active||key!==nextKey)return;
      const elapsed=Math.max(0,now()-started-leadMs);
      const fraction=Math.min(1,elapsed/travelMs);
      if(reducedMotion()){
        // Page-jump in discrete readable increments rather than constant
        // automatic motion when the viewer prefers reduced animation.
        const step=Math.min(pages-1,Math.floor(fraction*pages));
        viewport.scrollTop=Math.min(distance,step*height);
      }else{
        viewport.scrollTop=distance*fraction;
      }
      label(viewport.scrollTop);
      if(fraction<1)frame=requestFrame(scroll);
    };
    frame=requestFrame(scroll);
  };
  return {show,reset};
}
