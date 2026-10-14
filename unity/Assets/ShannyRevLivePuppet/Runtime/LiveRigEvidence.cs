#if BUFF_M16
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
using ShannyRevDemo;
namespace ShannyRev.LivePuppet {
 // Opt-in observation only. Runs after face attachments and never writes a pose.
 [DefaultExecutionOrder(32002)]
 public sealed class LiveRigEvidence : MonoBehaviour {
  [Serializable] public class Row {public string actor,motion,mood;public bool speaking;public float time,open,wide,round,frame_step,idle_error,rest_arm_angle,face_jaw;public int routes;public EpisodeExpressionWeight[] expression;}
  [Serializable] public class Report {public List<Row> frames=new List<Row>();}
  string root;float next,flush;Report report=new Report();EpisodeBodyActionPlayer[] bodies;
  void Start(){root=Environment.GetEnvironmentVariable("LIVE_CAPTURE_ROOT");if(string.IsNullOrEmpty(root)){enabled=false;return;}bodies=FindObjectsByType<EpisodeBodyActionPlayer>(FindObjectsSortMode.None);}
  void LateUpdate(){
   if(Time.unscaledTime<next||report.frames.Count>=2400)return;next=Time.unscaledTime+.1f;
   foreach(var body in bodies){
    var voice=body.GetComponent<LivePuppetActor>();var weights=voice.MouthWeights;
    var face=body.GetComponentsInChildren<SkinnedMeshRenderer>().Single(s=>s.name=="Shanny_Body"||s.name=="CC_Base_Body");
    int index=Enumerable.Range(0,face.sharedMesh.blendShapeCount).Single(i=>face.sharedMesh.GetBlendShapeName(i)=="Jaw_Open"||face.sharedMesh.GetBlendShapeName(i)=="jawOpen"||face.sharedMesh.GetBlendShapeName(i).EndsWith(".Jaw_Open")||face.sharedMesh.GetBlendShapeName(i).EndsWith(".jawOpen"));
    report.frames.Add(new Row{actor=body.ActorId,motion=body.BuffMotion,mood=voice.Mood,speaking=voice.IsPlaying,time=Time.unscaledTime,open=weights.x,wide=weights.y,round=weights.z,face_jaw=face.GetBlendShapeWeight(index),frame_step=body.BuffFrameStep,idle_error=body.BuffIdleError,rest_arm_angle=body.BuffRestArmAngle,routes=body.GetComponent<CharacterMouthRouter>().RouteCount,expression=body.GetComponent<EpisodeExpressionPlayer>().CaptureObservation().weights});
   }
   if(Time.unscaledTime>=flush){flush=Time.unscaledTime+2;Directory.CreateDirectory(root);File.WriteAllText(Path.Combine(root,"rig-frames.json"),JsonUtility.ToJson(report));}
  }
 }
}
#endif
