#if BUFF_M16
using System;
using System.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using ShannyRevDemo;
public static class BuffGazeChecks {
 public static void Run(){
  EditorSceneManager.OpenScene("Assets/BuffPresentation/BuffLive.unity");
  var bodies=UnityEngine.Object.FindObjectsByType<EpisodeBodyActionPlayer>(FindObjectsSortMode.None).OrderBy(b=>b.ActorId).ToArray();
  foreach(var b in bodies){b.PrepareBuffLive();b.SampleBuffLive(0);}
  var rev=bodies.Single(b=>b.ActorId=="REV");
  var serialized=new SerializedObject(rev);var head=(Transform)typeof(EpisodeBodyActionPlayer).GetField("gazeHead",System.Reflection.BindingFlags.Instance|System.Reflection.BindingFlags.NonPublic).GetValue(rev);
  var nativeForward=rev.SharedConversationHeadForward;
  var camera=Camera.main;camera.transform.position=rev.ConversationEyeCenter+nativeForward*.85f+Vector3.up*.02f;camera.transform.LookAt(rev.ConversationEyeCenter);camera.fieldOfView=29;
  Quaternion[] first=null;
  foreach(float style in new[]{0f,1f,0f,1f}){
   foreach(var b in bodies)b.SampleBuffLive(96000);
   var all=bodies.SelectMany(b=>b.GetComponentsInChildren<Transform>(true)).ToArray();var before=all.Select(t=>t.localRotation).ToArray();
   var centers=bodies.Select(b=>b.ConversationEyeCenter).ToArray();
   if(!bodies.All(b=>b.SharedConversationGazeEnabled))throw new Exception("Shared gaze gate rejected seated actors");
   for(int i=0;i<2;i++)bodies[i].CompleteSharedConversationHead(centers[1-i],bodies[i].ActorId=="REV"?style:0,1);
   centers=bodies.Select(b=>b.ConversationEyeCenter).ToArray();
   for(int i=0;i<2;i++){bodies[i].CompleteSharedConversationEyes(centers[1-i],bodies[i].ActorId=="REV"?style:0,1);bodies[i].ValidatePoseGuard();}
   Debug.Log("BUFF_GAZE_STYLE "+style+" forward="+rev.SharedConversationHeadForward+" toward="+(centers[1]-centers[0]).normalized);
   for(int i=0;i<all.Length;i++)if(all[i].name!="head"&&all[i].name!="neck_01"&&!all[i].name.Contains("Head")&&!all[i].name.Contains("Neck")&&!all[i].name.Contains("Eye")&&!all[i].name.Contains("eye")&&Quaternion.Angle(before[i],all[i].localRotation)>0.05f)throw new Exception("Gaze changed unrelated bone "+all[i].name);
   if(style==1){
    var after=all.Select(t=>t.localRotation).ToArray();if(first!=null)for(int i=0;i<after.Length;i++)if(Quaternion.Angle(first[i],after[i])>.05f)throw new Exception("Gaze accumulated across repeat");first=after;
    rev.GetComponent<EpisodeExpressionPlayer>().SampleBuffFace(96000,"irritated",false,0);BuffRainChecks.Capture("rev-indirect.png");
   }else BuffRainChecks.Capture("rev-direct.png");
  }
  Debug.Log("BUFF_GAZE_CHECK_PASS: direct/indirect, repeated native samples, guards, unrelated bones preserved");
 }
}
#endif
