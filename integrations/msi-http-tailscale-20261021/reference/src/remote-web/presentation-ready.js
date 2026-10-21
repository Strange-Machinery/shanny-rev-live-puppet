/** Confirm real playback; only the OBS compositor needs foreground paint frames. */
export async function waitForPresentationReady({video,liveDisplay=false,
  frame=callback=>globalThis.requestAnimationFrame(callback)}){
  await video.play();
  const ready=()=>!video.paused&&!video.muted&&video.readyState>=2;
  if(!ready())throw Error('Selected output has not started playback.');
  // Live Show must also work covered or minimized. requestAnimationFrame can
  // remain suspended there indefinitely, even though media playback works.
  if(!liveDisplay)await new Promise(resolve=>frame(()=>frame(resolve)));
  if(!ready())throw Error('Selected output stopped before presentation.');
}
