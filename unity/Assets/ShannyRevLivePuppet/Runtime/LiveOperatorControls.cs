using UnityEngine;
namespace ShannyRev.LivePuppet {
 public sealed class LiveOperatorControls : MonoBehaviour {
  private LivePuppetClient client;
  private void Awake(){client=GetComponent<LivePuppetClient>();Application.targetFrameRate=60;}
  private void OnGUI(){
   GUI.Box(new Rect(12,12,360,142),"Shanny & Rev — Live Puppet");
   GUI.Label(new Rect(24,40,330,25),client.Muted?"MUTED — show may resume":client.Connected?"Puppet voice ready":"Connecting to local gateway");
   if(GUI.Button(new Rect(24,72,330,35),"SHUT UP — RESUME SHOW"))client.Panic();
   if(GUI.Button(new Rect(24,115,330,28),"Enable puppet voice"))client.ResumeLive();
  }
 }
}
