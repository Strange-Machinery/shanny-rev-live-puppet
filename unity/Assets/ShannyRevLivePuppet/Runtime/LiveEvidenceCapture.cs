using System;
using System.IO;
using System.Collections;
using UnityEngine;
namespace ShannyRev.LivePuppet {
 // Opt-in diagnostic stills only; not utterance video rendering or an OBS replacement.
 public sealed class LiveEvidenceCapture : MonoBehaviour {
  private IEnumerator Start(){
   string root=Environment.GetEnvironmentVariable("LIVE_CAPTURE_ROOT");if(string.IsNullOrEmpty(root))yield break;
   Directory.CreateDirectory(root);yield return new WaitForSecondsRealtime(3);
   yield return Capture(root,"idle");
   foreach(var actor in FindObjectsByType<LivePuppetActor>(FindObjectsSortMode.None)){
    double deadline=Time.realtimeSinceStartupAsDouble+300;
    while(actor.JawWeight<2&&Time.realtimeSinceStartupAsDouble<deadline)yield return null;
    if(actor.JawWeight>=2)yield return Capture(root,actor.name.Replace(' ','_'));
   }
  }
  private IEnumerator Capture(string root,string name){
   yield return new WaitForEndOfFrame();var image=new Texture2D(Screen.width,Screen.height,TextureFormat.RGB24,false);
   image.ReadPixels(new Rect(0,0,Screen.width,Screen.height),0,0);image.Apply();
   File.WriteAllBytes(Path.Combine(root,name+".png"),image.EncodeToPNG());Destroy(image);
  }
 }
}
