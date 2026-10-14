#if BUFF_M16
using System;
using System.IO;
using System.Linq;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using ShannyRevDemo;

public static class BuffElbowPreview {
 public static void Run(){
  string folder=Path.GetFullPath("../buff-left-elbow");Directory.CreateDirectory(folder);
  foreach(bool fitted in new[]{false,true}){
   EditorSceneManager.OpenScene("Assets/BuffPresentation/BuffLive.unity");
   var bodies=UnityEngine.Object.FindObjectsByType<EpisodeBodyActionPlayer>(FindObjectsSortMode.None);
   foreach(var body in bodies){body.PrepareBuffLive(fitted);body.SampleBuffLive(0);}
   var shanny=bodies.Single(b=>b.ActorId=="SHANNY");
   shanny.TryBuffMotion("conversation",48000);
   foreach(int tick in new[]{48000,96000,168000,264000}){
    shanny.SampleBuffLive(72000+tick);
    shanny.GetComponent<EpisodeExpressionPlayer>().SampleBuffFace(72000+tick,"anger",false,0);
    foreach(var follower in UnityEngine.Object.FindObjectsByType<FacialAttachmentFollower>(FindObjectsSortMode.None))follower.SyncFace();
    var target=new RenderTexture(1920,1080,24,RenderTextureFormat.ARGB32);target.Create();
    var camera=Camera.main;var prior=camera.targetTexture;camera.targetTexture=target;
    RenderPipeline.SubmitRenderRequest(camera,new UniversalRenderPipeline.SingleCameraRequest{destination=target});
    var old=RenderTexture.active;RenderTexture.active=target;var image=new Texture2D(1920,1080,TextureFormat.RGB24,false);
    image.ReadPixels(new Rect(0,0,1920,1080),0,0);image.Apply();
    File.WriteAllBytes(Path.Combine(folder,(fitted?"after":"before")+"-"+tick+".png"),image.EncodeToPNG());
    RenderTexture.active=old;camera.targetTexture=prior;UnityEngine.Object.DestroyImmediate(image);target.Release();UnityEngine.Object.DestroyImmediate(target);
   }
  }
  Debug.Log("BUFF_LEFT_ELBOW_PREVIEW_READY "+folder);
 }
}
#endif
