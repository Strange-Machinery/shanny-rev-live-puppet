#if BUFF_M16
using System;
using System.Linq;
using System.Collections.Generic;
using UnityEngine;
namespace ShannyRevDemo {
 // Shared by episode, short and live consumers of the existing body owner.
 public sealed partial class EpisodeBodyActionPlayer {
  readonly HashSet<RepertoireRole> preparedConversationRoles=new HashSet<RepertoireRole>();
  public bool M16LeftClearanceEnabled {get;set;}=true;
  void PrepareSelectedConversation(RepertoireAction action,RepertoireMotion motion,RepertoireRole role){
   if(!M16ProducerSelected(action,motion)||!preparedConversationRoles.Add(role))return;
   string alias=(action.name.StartsWith("m16_")?action.name.Substring(4):action.name).Replace('-','_');
   if(alias!="seated_listening"){
    Need(role.frames.Length>2&&role.frames[0].time==0&&Mathf.Abs(role.frames[1].time-1f/30f)<.0001f,"Unexpected selected M16 origin");
    role.frames[0].rotations=role.frames[1].rotations.ToArray();role.frames[0].hip_position=role.frames[1].hip_position;role.frames[0].eye_position=role.frames[1].eye_position;
   }
   if(!M16LeftClearanceEnabled||actorId!="SHANNY"||!(alias=="conversation"||alias=="open_explanation"||alias=="directed_point"||alias=="objection"))return;
   var chain=role.bones.Select((name,index)=>new{bone=frozen.Single(p=>p.bone.name==name).bone,index}).Where(x=>x.bone==armL||x.bone.IsChildOf(armL)).Select(x=>x.index).ToArray();
   Need(chain.Length>=3,"Complete left arm chain required");
   var delta=Quaternion.AngleAxis(-12,Vector3.up);
   foreach(var frame in role.frames)foreach(int index in chain)frame.rotations[index]=delta*frame.rotations[index];
  }
  public bool SharedConversationGazeEnabled=>theatricalTrack!=null&&theatricalTrack.mocap_first&&(actorId=="SHANNY"||actorId=="REV")&&FurnitureStateAt(0)=="seated";
  public bool SharedConversationGazeAt(int sample)=>SharedConversationGazeEnabled&&FurnitureStateAt(sample)=="seated"&&!(theatricalTrack.cigarette_actions??new CigaretteAction[0]).Any(a=>a.actor_id==actorId&&sample>=a.start_sample&&sample<a.end_sample)&&!(theatricalTrack.food_actions??new FoodAction[0]).Any(a=>a.actor_id==actorId&&sample>=a.start_sample&&sample<a.end_sample);
  Vector3 sharedHeadForward;Vector3[] sharedEyeForward;
  void PrepareSharedConversationGaze(){
   if(sharedEyeForward!=null)return;
   var before=frozen.Select(p=>Capture(p.bone)).ToArray();var eyesBefore=theatricalEyes.Select(t=>t.localRotation).ToArray();Apply(frozen);
   for(int i=0;i<theatricalEyes.Length;i++)theatricalEyes[i].localRotation=theatricalEyeRest[i];
   // The actor's source pose may already have a stage yaw. Derive anatomical
   // facing from the eye midpoint ahead of the head pivot, not global +Z.
   var front=Vector3.ProjectOnPlane(ConversationEyeCenter-gazeHead.position,Vector3.up);
   Need(front.sqrMagnitude>.00001f,"Cannot calibrate anatomical face direction");front.Normalize();
   sharedHeadForward=gazeHead.InverseTransformDirection(front);
   sharedEyeForward=theatricalEyes.Select(t=>t.InverseTransformDirection(front)).ToArray();
   Apply(before);for(int i=0;i<theatricalEyes.Length;i++)theatricalEyes[i].localRotation=eyesBefore[i];
  }
  public Vector3 SharedConversationHeadForward {get{PrepareSharedConversationGaze();return gazeHead.TransformDirection(sharedHeadForward);}}
  // Native body sampling always precedes this final, bounded head/eye pass.
  // Correction is recomputed from the current native pose, never accumulated.
  public void CompleteSharedConversationHead(Vector3 partner,float indirect,float weight){
   if(!SharedConversationGazeEnabled||weight<=0)return;
   PrepareSharedConversationGaze();
   var direction=Vector3.ProjectOnPlane(partner-ConversationEyeCenter,Vector3.up);
   if(direction.sqrMagnitude<.0001f)return;
   var forward=Vector3.ProjectOnPlane(gazeHead.TransformDirection(sharedHeadForward),Vector3.up);
   float yaw=Vector3.SignedAngle(forward,direction,Vector3.up);
   float budget=Mathf.Lerp(68,5,indirect);float correction=Mathf.Clamp(yaw,-budget,budget)*Mathf.Clamp01(weight);
   neck.rotation=Quaternion.AngleAxis(correction*.35f,Vector3.up)*neck.rotation;
   gazeHead.rotation=Quaternion.AngleAxis(correction*.65f,Vector3.up)*gazeHead.rotation;
   gazeHead.rotation=Quaternion.AngleAxis(-9*weight*indirect,gazeHead.TransformDirection(sharedHeadForward))*gazeHead.rotation;
   for(int i=0;i<frozen.Length;i++)expected[i]=Capture(frozen[i].bone);
  }
  public void CompleteSharedConversationEyes(Vector3 partner,float indirect,float weight){
   if(!SharedConversationGazeEnabled)return;
   PrepareSharedConversationGaze();
   for(int i=0;i<theatricalEyes.Length;i++){
    var eye=theatricalEyes[i];eye.localRotation=theatricalEyeRest[i];
    var target=partner+Vector3.up*(.18f*indirect);
    var delta=Quaternion.FromToRotation(eye.TransformDirection(sharedEyeForward[i]),target-eye.position);
    eye.rotation=Quaternion.RotateTowards(Quaternion.identity,delta,Mathf.Lerp(30,25,indirect)*Mathf.Clamp01(weight))*eye.rotation;
    eyeExpected[i]=eye.localRotation;
   }
  }
 }
}
#endif
