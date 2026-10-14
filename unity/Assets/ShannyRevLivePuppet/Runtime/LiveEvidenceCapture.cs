using System;
using System.IO;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
namespace ShannyRev.LivePuppet {
 // Opt-in diagnostic stills only; not utterance video rendering or an OBS replacement.
 public sealed class LiveEvidenceCapture : MonoBehaviour {
  private IEnumerator Start(){
   string root=Environment.GetEnvironmentVariable("LIVE_CAPTURE_ROOT");if(string.IsNullOrEmpty(root))yield break;
   Directory.CreateDirectory(root);yield return new WaitForSecondsRealtime(3);
   yield return Capture(root,"idle");
   var actors=FindObjectsByType<LivePuppetActor>(FindObjectsSortMode.None);var saved=new HashSet<string>();double deadline=Time.realtimeSinceStartupAsDouble+300;
   while(Time.realtimeSinceStartupAsDouble<deadline){
    foreach(var actor in actors){string key=actor.name.Replace(' ','_')+"_"+actor.Mood;
     if(actor.JawWeight>=12&&saved.Add(key))yield return Capture(root,key);
    }
    yield return null;
   }
  }
  private IEnumerator Capture(string root,string name){
   yield return new WaitForEndOfFrame();var target=Camera.main?Camera.main.targetTexture:null;
   int width=target?target.width:Screen.width,height=target?target.height:Screen.height;
   var prior=RenderTexture.active;if(target)RenderTexture.active=target;
   var image=new Texture2D(width,height,TextureFormat.RGB24,false);
   image.ReadPixels(new Rect(0,0,width,height),0,0);image.Apply();RenderTexture.active=prior;
   File.WriteAllBytes(Path.Combine(root,name+".png"),image.EncodeToPNG());Destroy(image);
  }
 }
}
