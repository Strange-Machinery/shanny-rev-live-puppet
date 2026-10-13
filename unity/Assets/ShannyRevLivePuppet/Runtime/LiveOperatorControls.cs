using UnityEngine;
namespace ShannyRev.LivePuppet {
 public sealed class LiveOperatorControls : MonoBehaviour {
  private LivePuppetClient client;
  private string line="Buff, are you listening to me?";
  private bool interrupt;
  private void Awake(){client=GetComponent<LivePuppetClient>();Application.targetFrameRate=30;}
  private void OnGUI(){
   GUI.Box(new Rect(12,12,360,270),"Shanny & Rev — Live Puppet");
   GUI.Label(new Rect(24,40,330,25),client.Muted?"MUTED — show may resume":client.Connected?"Puppet voice ready":"Connecting to local gateway");
   if(GUI.Button(new Rect(24,72,330,35),"SHUT UP — STOP PUPPETS"))client.Panic();
   if(GUI.Button(new Rect(24,115,330,28),"Enable puppet voice"))client.ResumeLive();
   line=GUI.TextField(new Rect(24,152,330,26),line,1000);
   interrupt=GUI.Toggle(new Rect(24,182,330,24),interrupt,"Interrupt current speech");
   GUI.enabled=client.Connected&&!client.Muted;
   if(GUI.Button(new Rect(24,212,160,28),"Shanny says it"))client.Speak("SHANNY",line,interrupt);
   if(GUI.Button(new Rect(194,212,160,28),"Rev says it"))client.Speak("REV",line,interrupt);
   GUI.enabled=true;GUI.Label(new Rect(24,248,330,24),client.OperatorStatus);
  }
 }
}
