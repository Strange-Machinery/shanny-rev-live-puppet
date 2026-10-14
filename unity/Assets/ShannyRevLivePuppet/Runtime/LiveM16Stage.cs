#if BUFF_M16
using System;
using UnityEngine;
using ShannyRevDemo;
namespace ShannyRev.LivePuppet {
 [DefaultExecutionOrder(100)]
 public sealed class LiveM16Stage : MonoBehaviour {
  EpisodeBodyActionPlayer[] bodies;LivePuppetActor[] voices;EpisodeExpressionPlayer[] faces;bool[] speaking,autoMotion;double started;bool ready;
  public bool Ready=>ready;
  public int PresentationDurationMs=>rain?Math.Max(20000,(int)Math.Ceiling(bodies[0].BuffRainDurationSamples/48d)):20000;
  bool rain;int rainStart;
  float gazeWeight;int lastTalk=-960000,talkStart;bool wasTalking;
  float[] indirectBlend=new float[2];
  Camera view;Vector3 seatedCameraPosition;Quaternion seatedCameraRotation;float seatedFov;
  static string MotionFor(string actor,string mood)=>mood=="crying"?"quiet_listening":mood=="pacifying"?"open_explanation":mood=="rage"||actor=="SHANNY"&&(mood=="anger"||string.IsNullOrEmpty(mood))?"objection":"conversation";
  int Sample=>(int)Math.Min(int.MaxValue-4800000,(Time.realtimeSinceStartupAsDouble-started)*48000);
  public bool Play(string alias,string[] targets){
   if(!ready||targets==null||targets.Length<1||targets.Length>2)return false;
   if(alias=="presentation_end"){StopMotions();return targets.Length==2;}
   if(alias=="make_it_rain"||alias=="seated_response"){
    if(targets.Length!=2||!Array.Exists(targets,t=>t=="SHANNY")||!Array.Exists(targets,t=>t=="REV"))return false;
    StopMotions();if(alias=="make_it_rain"){foreach(var b in bodies)b.BeginBuffRain();rain=true;rainStart=Sample;view.transform.position=new Vector3(3.6f,1.55f,2.35f);view.transform.LookAt(new Vector3(.45f,1.20f,.8f));view.fieldOfView=44;}return true;
   }
   if(rain)return false;
   foreach(string target in targets){var b=Array.Find(bodies,x=>x.ActorId==target);if(b==null||!b.CanBuffMotion(alias))return false;}
   int sample=Sample;foreach(string target in targets)Array.Find(bodies,x=>x.ActorId==target).TryBuffMotion(alias,sample);return true;
  }
  public void StopMotions(){if(ready){foreach(var b in bodies){if(b.BuffRain)b.EndBuffRain();else b.StopBuffMotion(Sample);}if(rain){view.transform.SetPositionAndRotation(seatedCameraPosition,seatedCameraRotation);view.fieldOfView=seatedFov;}rain=false;Array.Clear(autoMotion,0,autoMotion.Length);}}
  void Start(){
   bodies=FindObjectsByType<EpisodeBodyActionPlayer>(FindObjectsSortMode.None);voices=new LivePuppetActor[bodies.Length];faces=new EpisodeExpressionPlayer[bodies.Length];speaking=new bool[bodies.Length];autoMotion=new bool[bodies.Length];
   for(int i=0;i<bodies.Length;i++){bodies[i].PrepareBuffLive();bodies[i].PrepareBuffRain();voices[i]=bodies[i].GetComponent<LivePuppetActor>();faces[i]=bodies[i].GetComponent<EpisodeExpressionPlayer>();faces[i]?.EnableCandidateBlinks(true);}
   started=Time.realtimeSinceStartupAsDouble;ready=true;Debug.Log("BUFF_M16_READY: twelve preloaded fitted banks; single body owner");
   view=Camera.main;seatedCameraPosition=view.transform.position;seatedCameraRotation=view.transform.rotation;seatedFov=view.fieldOfView;
  }
  void LateUpdate(){
   if(!ready)return;int sample=Sample;
   try {
   for(int i=0;i<bodies.Length;i++){
    bool now=voices[i]!=null&&voices[i].IsPlaying;
    // Artistic objection choice is explicit; it is not a qualified rage motion.
    if(!rain&&now&&!speaking[i])autoMotion[i]=bodies[i].TryBuffMotion(MotionFor(bodies[i].ActorId,voices[i].Mood),sample);
    if(!now&&speaking[i]&&autoMotion[i])bodies[i].StopBuffMotion(sample);
    speaking[i]=now;if(rain)bodies[i].SampleBuffRain(sample-rainStart);else bodies[i].SampleBuffLive(sample);
    string faceMood=voices[i]?.Mood;
    if(!rain&&!now&&bodies[i].ActorId=="REV"&&Array.Exists(voices,v=>v!=null&&v.IsPlaying&&(v.Mood=="anger"||v.Mood=="rage")))faceMood="irritated";
    faces[i]?.SampleBuffFace(sample,faceMood,now,voices[i]?.JawWeight??0);
   }
   if(!rain&&bodies.Length==2){
    bool talking=Array.Exists(voices,v=>v!=null&&v.IsPlaying);
    if(talking){lastTalk=sample;if(!wasTalking)talkStart=sample;}wasTalking=talking;
    gazeWeight=Mathf.MoveTowards(gazeWeight,sample-lastTalk<144000?1:0,.065f);
    var centers=Array.ConvertAll(bodies,b=>b.ConversationEyeCenter);
    var indirect=new bool[2];
    for(int i=0;i<2;i++){
     int partner=1-i;
     indirect[i]=bodies[i].ActorId=="REV"&&!speaking[i]&&sample-talkStart>72000;
     indirectBlend[i]=Mathf.MoveTowards(indirectBlend[i],indirect[i]?1:0,.065f);
     bodies[i].CompleteSharedConversationHead(centers[partner],indirectBlend[i],gazeWeight);
    }
    centers=Array.ConvertAll(bodies,b=>b.ConversationEyeCenter);
    for(int i=0;i<2;i++)bodies[i].CompleteSharedConversationEyes(centers[1-i],indirectBlend[i],gazeWeight);
   }
   } catch(Exception e){ready=false;Debug.LogException(e);foreach(var voice in voices)if(voice)voice.StopAll();}
  }
 }
}

#endif
