#if BUFF_M16
using System;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;

namespace ShannyRevDemo {
 // Extends the existing final body owner; no independent retargeter or bone writer.
 public sealed partial class EpisodeBodyActionPlayer {
  readonly Dictionary<string,RepertoireAction> buffActions=new Dictionary<string,RepertoireAction>();
  // Uses the EXISTING final body owner's calibrated native middle_finger
  // finger-writer. No imported pose, hand mesh, duplicate animator, or rig edit.
  TheatricalCue buffCameraFlip;
  public bool BuffCameraFlipActive=>buffCameraFlip!=null;
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
  public bool CanBuffMotion(string alias)=>buffIdle!=null&&buffAction==null&&buffCameraFlip==null&&buffActions.ContainsKey(alias);
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
   if(buffIdle==null||sample<0||buffAction!=null||buffCameraFlip!=null||!buffActions.TryGetValue(alias,out var a))return false;
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
  /**
   * Camera-directed middle finger for a single genuinely incensed line.
   * Seated, ~2.3 seconds with a held peak, automatically releases.
   * All pose writes stay in EpisodeBodyActionPlayer, the EXISTING body owner.
   */
  public bool TryBuffCameraFlip(int sample){
   if(buffIdle==null||buffRain||sample<0||buffCameraFlip!=null||
      theatricalFingers==null||theatricalFingers.Length!=30||
      theatricalPalms==null||theatricalPalms.Length!=2||Camera.main==null)
     return false;
   // An explicit offensive response owns this arm for its brief duration.
   // Replace any competing auto "objection" bank without launching a
   // second animator or waiting for the sentence to finish.
   buffAction=null;buffRelease=null;theatricalTrack.repertoire_actions=BuffEmpty;
   buffCameraFlip=new TheatricalCue{
    action="middle_finger",variant=0,intensity=1f,
    start_sample=sample,peak_sample=sample+12000,
    hold_sample=sample+72000,end_sample=sample+111000
   };
   return true;
  }
  public void StopBuffCameraFlip(){
   if(buffCameraFlip==null)return;
   buffCameraFlip=null;
   // The next idle sample owns every finger again; don't leak the obscene
   // pose into the next donor, subsequent voice, or full-body rain.
   ResetHands();
  }
  void SampleBuffCameraFlip(int sample){
   if(buffCameraFlip==null)return;
   if(sample>=buffCameraFlip.end_sample){StopBuffCameraFlip();return;}
   float weight=Phase(buffCameraFlip,sample);
   if(weight<=0)return;
   Camera camera=Camera.main;
   if(camera==null){StopBuffCameraFlip();return;}
   Vector3 front=Vector3.ProjectOnPlane(camera.transform.position-chest.position,Vector3.up);
   if(front.sqrMagnitude<.0001f){StopBuffCameraFlip();return;}
   front.Normalize();
   // Raise the RIGHT arm into the already-authoritative stage camera view
   // with bounded upper/forearm weights; feet, hips, face, visemes and
   // partner gestures do not receive new owners.
   AimLimb(armR,foreR,(Vector3.up*.86f+front*.42f).normalized,weight*.74f);
   AimLimb(foreR,handR,(Vector3.up*.60f+front*.75f).normalized,weight*.62f);
   // The pre-existing rigorously calibrated native gesture curls the
   // index/ring/pinky and extends exactly the middle finger.
   ResetHands();
   SampleHands(buffCameraFlip,sample,1);
   // That older gesture aimed at the partner; rotate this PRESENTATION
   // variant toward the camera instead, without changing the hand rig.
   var palm=theatricalPalms[1];
   Vector3 audience=Vector3.ProjectOnPlane(camera.transform.position-palm.hand.position,Vector3.up);
   if(audience.sqrMagnitude>.0001f){
    var current=Quaternion.LookRotation(palm.hand.TransformDirection(palm.forward),
                                       palm.hand.TransformDirection(palm.normal));
    var facing=Quaternion.LookRotation(Vector3.up,audience.normalized);
    var target=facing*Quaternion.Inverse(current)*palm.hand.rotation;
    palm.hand.rotation=Quaternion.Slerp(palm.hand.rotation,target,weight*.82f);
   }
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
   SampleBuffCameraFlip(sample);
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
