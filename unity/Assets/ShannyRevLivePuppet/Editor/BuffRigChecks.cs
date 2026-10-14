#if BUFF_M16
using System;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using ShannyRevDemo;

public static class BuffRigChecks {
 public static void Run(){
  EditorSceneManager.OpenScene("Assets/BuffPresentation/BuffLive.unity");
  foreach(var body in UnityEngine.Object.FindObjectsByType<EpisodeBodyActionPlayer>(FindObjectsSortMode.None)){
   body.PrepareBuffLive();body.SampleBuffLive(0);
   Need(body.BuffRestArmAngle>15,"Idle must not be the authored T-pose: "+body.ActorId);
   float maxStep=0;int clock=48000;
   foreach(var alias in new[]{"conversation","directed_point","objection","open_explanation","quiet_listening","seated_listening"}){
    foreach(int stopAfter in new[]{8000,40000}){
     Need(body.TryBuffMotion(alias,clock),"Preloaded motion was rejected: "+alias);
     for(int s=clock;s<clock+stopAfter;s+=800){body.SampleBuffLive(s);maxStep=Mathf.Max(maxStep,body.BuffFrameStep);if(body.BuffFrameStep>15)Debug.Log("BUFF_STEP "+body.ActorId+" "+alias+" entry "+(s-clock)+" "+body.BuffFrameStepBone+" "+body.BuffFrameStep);}
     body.StopBuffMotion(clock+stopAfter);
     for(int s=clock+stopAfter;s<=clock+stopAfter+16000;s+=800){body.SampleBuffLive(s);maxStep=Mathf.Max(maxStep,body.BuffFrameStep);if(body.BuffFrameStep>15)Debug.Log("BUFF_STEP "+body.ActorId+" "+alias+" release "+(s-clock)+" "+body.BuffFrameStepBone+" "+body.BuffFrameStep);}
     Need(body.BuffIdleError<.1f,"Motion failed to return to seated idle: "+alias);clock+=96000;
    }
   }
   var mouth=body.GetComponent<CharacterMouthRouter>();Need(mouth!=null,"Original mouth owner missing");
   mouth.ValidateConfiguration();mouth.ApplyCanonicalWeights(new Vector3(60,20,10));
   var routes=new SerializedObject(mouth).FindProperty("routes");
   for(int i=0;i<routes.arraySize;i++){
    var row=routes.GetArrayElementAtIndex(i);var renderer=(SkinnedMeshRenderer)row.FindPropertyRelative("renderer").objectReferenceValue;
    int index=renderer.sharedMesh.GetBlendShapeIndex(row.FindPropertyRelative("blendShapeName").stringValue);
    float expected=new Vector3(60,20,10)[row.FindPropertyRelative("channel").enumValueIndex]*row.FindPropertyRelative("gain").floatValue;
    Need(Mathf.Abs(renderer.GetBlendShapeWeight(index)-expected)<.001f,"Routed mouth weight mismatch");
   }
   var face=body.GetComponent<EpisodeExpressionPlayer>();face.EnableCandidateBlinks(true);
   var signatures=new System.Collections.Generic.HashSet<string>();
   foreach(string mood in body.ActorId=="SHANNY"?new[]{"anger","rage","crying","smug","surprised"}:new[]{"pacifying","irritated","rage","skeptical","surprised"}){
    mouth.ApplyCanonicalWeights(new Vector3(60,20,10));face.SampleBuffFace(clock,mood,true,60);clock+=48000;
    var observation=face.CaptureObservation();
    var jawRoute=routes.GetArrayElementAtIndex(0);var jawFace=(SkinnedMeshRenderer)jawRoute.FindPropertyRelative("renderer").objectReferenceValue;
    int jawIndex=jawFace.sharedMesh.GetBlendShapeIndex(jawRoute.FindPropertyRelative("blendShapeName").stringValue);
    Need(jawFace.GetBlendShapeWeight(jawIndex)>38,"Expression erased the speech jaw");
    signatures.Add(string.Join(",",observation.weights.Where(w=>w.shape!="Jaw_Open"&&w.shape!="jawOpen").Select(w=>Mathf.Round(w.value))));
   }
   Need(signatures.Count==5,"Mood profiles did not produce distinct expressions");
   mouth.Clear();Need(!mouth.HasVisibleNonRestWeights,"Mouth did not clear");
   Need(maxStep<15,"Visible pose discontinuity: "+body.ActorId+" "+maxStep);
   Debug.Log("BUFF_RIG_CHECK_PASS "+body.ActorId+" routes="+mouth.RouteCount+" max_frame_step="+maxStep+" rest_arm_angle="+body.BuffRestArmAngle);
  }
 }
 static void Need(bool condition,string reason){if(!condition)throw new Exception(reason);}
}
#endif
