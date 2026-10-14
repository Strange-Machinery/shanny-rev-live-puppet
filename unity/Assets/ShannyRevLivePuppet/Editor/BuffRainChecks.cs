#if BUFF_M16
using System;
using System.IO;
using System.Linq;
using UnityEditor.SceneManagement;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using ShannyRevDemo;
public static class BuffRainChecks {
 public static void Run(){
  EditorSceneManager.OpenScene("Assets/BuffPresentation/BuffLive.unity");
  var bodies=UnityEngine.Object.FindObjectsByType<EpisodeBodyActionPlayer>(FindObjectsSortMode.None);
  foreach(var b in bodies){b.PrepareBuffLive();b.PrepareBuffRain();b.SampleBuffLive(0);}
  for(int run=0;run<2;run++){
   foreach(var b in bodies)b.BeginBuffRain();
   foreach(int sample in new[]{0,22080,96000,297600,384000,406080,480000,768000,892800,960000,bodies[0].BuffRainDurationSamples,96000,0}){
    foreach(var b in bodies){b.SampleBuffRain(sample);b.ValidatePoseGuard();
     var mouth=b.GetComponent<CharacterMouthRouter>();mouth.ApplyCanonicalWeights(new Vector3(45,12,15));
     b.GetComponent<EpisodeExpressionPlayer>().SampleBuffFace(sample,b.ActorId=="REV"?"irritated":"smug",true,45);
     var route=new SerializedObject(mouth).FindProperty("routes").GetArrayElementAtIndex(0);
     var mesh=(SkinnedMeshRenderer)route.FindPropertyRelative("renderer").objectReferenceValue;
     int jaw=mesh.sharedMesh.GetBlendShapeIndex(route.FindPropertyRelative("blendShapeName").stringValue);
     if(mesh.GetBlendShapeWeight(jaw)<25)throw new Exception("Rain erased speech articulation");
    }
    if(run==0&&sample==96000){var camera=Camera.main;camera.transform.position=new Vector3(3.6f,1.55f,2.35f);camera.transform.LookAt(new Vector3(.45f,1.20f,.8f));camera.fieldOfView=44;Capture("rain-2s.png");}
   }
   foreach(var b in bodies){b.EndBuffRain();b.SampleBuffLive(1100000);b.ValidatePoseGuard();if(b.BuffIdleError>.1f)throw new Exception("Rain did not restore seated idle");b.GetComponent<CharacterMouthRouter>().Clear();}
  }
  Capture("seated-after-rain.png");Debug.Log("BUFF_RAIN_CHECK_PASS: paired poses, 20s, backward seeks, repeat, mouths, guarded seated return");
 }
 public static void Capture(string name){
  foreach(var f in UnityEngine.Object.FindObjectsByType<FacialAttachmentFollower>(FindObjectsSortMode.None))f.SyncFace();
  // Editor rendering caches skinning within a frame. Bake sampled geometry so
  // successive deterministic poses really appear in the evidence images.
  var skins=UnityEngine.Object.FindObjectsByType<SkinnedMeshRenderer>(FindObjectsSortMode.None).Where(s=>s.enabled&&s.gameObject.activeInHierarchy&&!s.forceRenderingOff).ToArray();
  var displays=new GameObject[skins.Length];var meshes=new Mesh[skins.Length];
  for(int i=0;i<skins.Length;i++){
   var skin=skins[i];var go=displays[i]=new GameObject("BUFF_EDITOR_SAMPLED_"+skin.name);var mesh=meshes[i]=new Mesh();skin.BakeMesh(mesh,true);go.AddComponent<MeshFilter>().sharedMesh=mesh;
   var render=go.AddComponent<MeshRenderer>();render.sharedMaterials=skin.sharedMaterials;render.shadowCastingMode=skin.shadowCastingMode;render.receiveShadows=skin.receiveShadows;
   go.transform.SetPositionAndRotation(skin.transform.position,skin.transform.rotation);go.transform.localScale=skin.transform.lossyScale;
   var block=new MaterialPropertyBlock();skin.GetPropertyBlock(block);render.SetPropertyBlock(block);for(int n=0;n<render.sharedMaterials.Length;n++){block.Clear();skin.GetPropertyBlock(block,n);render.SetPropertyBlock(block,n);}
   skin.forceRenderingOff=true;
  }
  var camera=Camera.main;var prior=camera.targetTexture;var rt=new RenderTexture(1920,1080,24);rt.Create();camera.targetTexture=rt;
  for(int i=0;i<3;i++)RenderPipeline.SubmitRenderRequest(camera,new UniversalRenderPipeline.SingleCameraRequest{destination=rt});
  var old=RenderTexture.active;RenderTexture.active=rt;var image=new Texture2D(1920,1080,TextureFormat.RGB24,false);image.ReadPixels(new Rect(0,0,1920,1080),0,0);image.Apply();
  string folder=Path.GetFullPath("../buff-rain-checks");Directory.CreateDirectory(folder);File.WriteAllBytes(Path.Combine(folder,name),image.EncodeToPNG());
  RenderTexture.active=old;camera.targetTexture=prior;UnityEngine.Object.DestroyImmediate(image);rt.Release();UnityEngine.Object.DestroyImmediate(rt);
  for(int i=0;i<skins.Length;i++){skins[i].forceRenderingOff=false;UnityEngine.Object.DestroyImmediate(displays[i]);UnityEngine.Object.DestroyImmediate(meshes[i]);}
 }
}
#endif
