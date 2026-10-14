#if BUFF_M16
using System;
using System.Linq;
using UnityEngine;
namespace ShannyRevDemo {
 public sealed partial class EpisodeBodyActionPlayer {
  TheatricalTrack buffSeatedTrack,buffRainTrack;Vector3 buffSeatedMark;bool buffRain;
  TextAsset buffSeatedSchedule,buffRainSchedule;string buffSeatedHash,buffRainHash;
  public bool BuffRain=>buffRain;
  public int BuffRainDurationSamples=>Math.Max(buffRainTrack.money_rain_actions.Max(a=>a.end_sample),Math.Max(buffRainTrack.repertoire_actions.Max(a=>a.end_sample),(buffRainTrack.furniture_routines??new FurnitureRoutine[0]).Select(a=>a.seated_sample).DefaultIfEmpty(960000).Max()));
  public void PrepareBuffRain(){
   buffSeatedTrack=theatricalTrack;buffSeatedMark=transform.position;
   buffSeatedSchedule=theatricalSchedule;buffSeatedHash=theatricalHash;
   var asset=Resources.Load<TextAsset>("BuffRainTrack");Need(asset!=null,"Prepared paired rain track missing");
   buffRainTrack=JsonUtility.FromJson<TheatricalTrack>(asset.text);
   buffRainSchedule=asset;buffRainHash=EpisodePlaybackController.HashBytes(asset.bytes);
   Need(buffRainTrack.money_rain_actions.Length>=1&&buffRainTrack.repertoire_actions.All(a=>a.name=="twerk"&&a.actors.SequenceEqual(new[]{"SHANNY"})),"Unexpected paired choreography");
   // Allocate and validate fixed paper visuals while hidden, before Ready.
   BeginBuffRain();EndBuffRain();
  }
  public void BeginBuffRain(){
   Need(buffRainTrack!=null&&!buffRain,"Rain routine is not ready");
   ValidatePoseGuard();buffAction=null;buffRelease=null;
   ResetToRest();theatricalTrack=buffRainTrack;theatricalSchedule=buffRainSchedule;theatricalHash=buffRainHash;
   transform.position=new Vector3(.45f,0,actorId=="SHANNY"?.35f:1.35f);
   ClearSeatAction();PrepareFurniture();PrepareMovement();ValidateRepertoire();ValidateMoneyRain();
   buffRain=true;SampleEpisode(0);
   // Warm bill meshes before the presentation is acknowledged and exposed.
   if(actorId=="REV"){SampleEpisode(22080);SampleEpisode(0);}
  }
  public void SampleBuffRain(int sample){Need(buffRain,"Rain not active");SampleEpisode(Mathf.Clamp(sample,0,BuffRainDurationSamples));}
  public void EndBuffRain(){
   if(!buffRain)return;ValidatePoseGuard();ResetMoneyRain();
   theatricalTrack=buffSeatedTrack;theatricalSchedule=buffSeatedSchedule;theatricalHash=buffSeatedHash;transform.position=buffSeatedMark;ClearSeatAction();PrepareFurniture();PrepareMovement();
   Apply(buffIdle);buffEntry=buffIdle;buffNative=buffIdle;buffSampled=false;buffRelease=null;buffAction=null;buffRain=false;
   for(int i=0;i<frozen.Length;i++)expected[i]=Capture(frozen[i].bone);
   for(int i=0;i<theatricalEyes.Length;i++){theatricalEyes[i].localRotation=theatricalEyeRest[i];eyeExpected[i]=theatricalEyeRest[i];}
  }
 }
}
#endif
