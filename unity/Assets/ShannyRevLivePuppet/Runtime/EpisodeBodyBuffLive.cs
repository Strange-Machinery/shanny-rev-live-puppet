#if BUFF_M16
using System;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;

namespace ShannyRevDemo {
 // Extends the existing final body owner; no independent retargeter or bone writer.
 public sealed partial class EpisodeBodyActionPlayer {
  readonly Dictionary<string,RepertoireAction> buffActions=new Dictionary<string,RepertoireAction>();
  BonePose[] buffIdle;
  BonePose[] buffEntry,buffRelease;
  int buffReleaseStart,buffReleaseEnd;
  int buffReleaseProgress,buffPreviousSample;
  RepertoireAction buffAction;
  RepertoireAction[] buffSlot=new RepertoireAction[1];
  static readonly RepertoireAction[] BuffEmpty=new RepertoireAction[0];
  public string BuffMotion => buffAction?.name ?? "seated_listening_hold";
  public float BuffIdleError => buffIdle==null?float.PositiveInfinity:buffIdle.Max(p=>Quaternion.Angle(p.bone.localRotation,p.rotation));
  public float BuffRestArmAngle => frozen.Where(p=>p.bone.name.IndexOf("Upperarm",StringComparison.OrdinalIgnoreCase)>=0||p.bone.name.StartsWith("upperarm",StringComparison.OrdinalIgnoreCase)).Max(p=>Quaternion.Angle(p.bone.localRotation,p.rotation));
  public float BuffFrameStep {get;private set;}
  public string BuffFrameStepBone {get;private set;}
  bool buffSampled;
  bool buffLeftClearance;
  BonePose[] buffNative;
  public bool CanBuffMotion(string alias)=>buffIdle!=null&&buffAction==null&&buffActions.ContainsKey(alias);
  public void PrepareBuffLive(bool leftClearance=true){
   buffLeftClearance=leftClearance;
   M16LeftClearanceEnabled=leftClearance;
   Initialize();SecondaryReplayEnabled=false;PrepareTheatrical();ValidatePoseGuard();
   Need(theatricalTrack.mocap_first,"Live stage requires M16 ownership rules");
   foreach(var a in theatricalTrack.repertoire_actions.Where(a=>a.actors.Contains(actorId))){
    var motion=RepertoireMotionFor(a);
    Need(M16ProducerSelected(a,motion),"Live bank is not producer selected");
    PrepareSelectedConversation(a,motion,motion.roles.Single(r=>r.actor_id==actorId));
    buffActions.Add(a.name,a);
   }
   Need(buffActions.Count==6&&buffActions.ContainsKey("seated_listening"),"Six preloaded actor-specific banks required");
   var hold=buffActions["seated_listening"];
   SampleEpisode(hold.native_start_sample+48000);
   buffIdle=frozen.Select(p=>Capture(p.bone)).ToArray();
   buffEntry=buffIdle;
   buffNative=buffIdle;
   // Foot targets in the fitted idle already contain its measured sole adjustment.
   float left=hold.left_sole_adjust_y,right=hold.right_sole_adjust_y;
   foreach(var a in buffActions.Values){a.left_sole_adjust_y-=left;a.right_sole_adjust_y-=right;}
   theatricalTrack.repertoire_actions=BuffEmpty;
  }
  void PrepareBuffLeftArmClearance(RepertoireAction action,RepertoireMotion motion){
   if(!buffLeftClearance||actorId!="SHANNY"||!(action.name=="conversation"||action.name=="open_explanation"||action.name=="directed_point"||action.name=="objection"))return;
   // Mirror the existing right-arm clearance method, more mildly. All fitted
   // left descendants rotate together, preserving native elbow/wrist local motion.
   var role=motion.roles.Single(r=>r.actor_id==actorId);
   var chain=role.bones.Select((name,index)=>new{bone=frozen.Single(p=>p.bone.name==name).bone,index}).Where(x=>x.bone==armL||x.bone.IsChildOf(armL)).Select(x=>x.index).ToArray();
   Need(chain.Length>=3,"Left arm clearance requires its complete captured chain");
   int upper=Array.IndexOf(role.bones,armL.name),fore=Array.IndexOf(role.bones,foreL.name),hand=Array.IndexOf(role.bones,handL.name);
   Need(upper>=0&&fore>=0&&hand>=0,"Left elbow/wrist fitting channels missing");
   var delta=Quaternion.AngleAxis(-12f,Vector3.up);float error=0;
   foreach(var frame in role.frames){
    var elbow=Quaternion.Inverse(frame.rotations[upper])*frame.rotations[fore];
    var wrist=Quaternion.Inverse(frame.rotations[fore])*frame.rotations[hand];
    foreach(int index in chain)frame.rotations[index]=delta*frame.rotations[index];
    var newElbow=Quaternion.Inverse(frame.rotations[upper])*frame.rotations[fore];var newWrist=Quaternion.Inverse(frame.rotations[fore])*frame.rotations[hand];
    error=Mathf.Max(error,QuaternionComponentError(elbow,newElbow),QuaternionComponentError(wrist,newWrist));
   }
   Need(error<.00001f,"Left clearance changed captured elbow/wrist motion");
   Debug.Log("BUFF_LEFT_ARM_CLEARANCE: "+action.name+" outward_degrees=12 frames="+role.frames.Length+" local_component_error="+error);
  }
  static float QuaternionComponentError(Quaternion a,Quaternion b){
   if(Quaternion.Dot(a,b)<0)b=new Quaternion(-b.x,-b.y,-b.z,-b.w);
   return Mathf.Max(Mathf.Abs(a.x-b.x),Mathf.Abs(a.y-b.y),Mathf.Abs(a.z-b.z),Mathf.Abs(a.w-b.w));
  }
  public bool TryBuffMotion(string alias,int sample){
   if(buffIdle==null||sample<0||buffAction!=null||!buffActions.TryGetValue(alias,out var a))return false;
   int duration=Mathf.RoundToInt(RepertoireMotionFor(a).duration_seconds*48000),fade=24000;
   a.start_sample=sample;a.native_start_sample=sample+fade;a.native_end_sample=sample+fade+duration;a.end_sample=sample+2*fade+duration;
   buffEntry=buffNative??frozen.Select(p=>Capture(p.bone)).ToArray();buffRelease=null;
   buffAction=a;buffSlot[0]=a;theatricalTrack.repertoire_actions=buffSlot;return true;
  }
  public void StopBuffMotion(int sample){
   if(buffAction==null)return;
   // A short line can finish during entry. Fade the actual current pose instead
   // of cancelling entry or changing the source clock to an earlier native frame.
   buffRelease=buffNative??frozen.Select(p=>Capture(p.bone)).ToArray();
   buffReleaseStart=sample;buffReleaseEnd=sample+14400;
   buffReleaseProgress=0;buffPreviousSample=sample;
   buffAction=null;theatricalTrack.repertoire_actions=BuffEmpty;
  }
  public void SampleBuffLive(int sample){
   Need(buffIdle!=null,"Preload live banks before Ready");ValidatePoseGuard();Apply(buffIdle);
   for(int i=0;i<theatricalEyes.Length;i++){theatricalEyes[i].localRotation=theatricalEyeRest[i];eyeExpected[i]=theatricalEyeRest[i];}
   if(buffRelease!=null){
    // Never consume the entire return blend on a single delayed render frame.
    buffReleaseProgress+=Mathf.Clamp(sample-buffPreviousSample,0,2400);buffPreviousSample=sample;
    float w=Mathf.SmoothStep(0,1,Mathf.Clamp01(buffReleaseProgress/14400f));
    for(int i=0;i<buffIdle.Length;i++){
     var bone=buffIdle[i].bone;bone.localPosition=Vector3.Lerp(buffRelease[i].position,buffIdle[i].position,w);
     bone.localRotation=Quaternion.Slerp(buffRelease[i].rotation,buffIdle[i].rotation,w);bone.localScale=buffIdle[i].scale;
    }
    if(buffReleaseProgress>=14400)buffRelease=null;
   }
   if(buffAction!=null&&sample>=buffAction.end_sample){buffAction=null;theatricalTrack.repertoire_actions=BuffEmpty;}
   if(buffAction!=null){
    if(sample<buffAction.native_start_sample)Apply(buffEntry);
    SampleRepertoireBase(sample);
   }
   BuffFrameStep=0;
   for(int i=0;i<frozen.Length;i++){
    var pose=Capture(frozen[i].bone);if(buffSampled){float step=Quaternion.Angle(buffNative[i].rotation,pose.rotation);if(step>BuffFrameStep){BuffFrameStep=step;BuffFrameStepBone=pose.bone.name;}}
    expected[i]=pose;Need(Finite(expected[i]),"Invalid live body pose");
   }
   buffSampled=true;
   buffNative=frozen.Select(p=>Capture(p.bone)).ToArray();
  }
 }
}

#endif
