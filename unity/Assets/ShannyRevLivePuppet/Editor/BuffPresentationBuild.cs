#if BUFF_M16
using System;
using System.IO;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering.Universal;
using ShannyRevDemo;
using ShannyRev.LivePuppet;
using Object=UnityEngine.Object;

public static class BuffPresentationBuild {
 public static void Build(){
  if(!File.Exists("BUFF_ISOLATED_PRESENTATION"))throw new Exception("Separate Buff presentation project required");
  var scene=EditorSceneManager.OpenScene("Assets/FullPerformanceCandidate/Scenes/FurnitureStage.unity");
  var bodies=Object.FindObjectsByType<EpisodeBodyActionPlayer>(FindObjectsSortMode.None).OrderBy(b=>b.ActorId=="SHANNY"?0:1).ToArray();
  if(bodies.Length!=2)throw new Exception("Two original body owners required");
  File.WriteAllLines("buff-scene-inventory.txt",scene.GetRootGameObjects().SelectMany(r=>r.GetComponentsInChildren<MonoBehaviour>(true)).Where(c=>c).Select(c=>c.name+" | "+c.GetType().FullName));
  // Remove offline episode clocks/caches, retaining the actual room, chairs and render pipeline.
  foreach(var root in scene.GetRootGameObjects())foreach(var c in root.GetComponentsInChildren<MonoBehaviour>(true)){
   if(!c||c is EpisodeBodyActionPlayer||c is CharacterMouthRouter||c is EpisodeExpressionPlayer||c is StanktankSet.StanktankChair||c is UniversalAdditionalCameraData||c is UniversalAdditionalLightData||c is FacialAttachmentFollower||c is WartGrowthRig||c is PhysicalRefined02.ShannyLidResponse)continue;
   Object.DestroyImmediate(c);
  }
  foreach(var animator in Object.FindObjectsByType<Animator>(FindObjectsInactive.Include,FindObjectsSortMode.None))animator.enabled=false;
  foreach(var audio in Object.FindObjectsByType<AudioSource>(FindObjectsInactive.Include,FindObjectsSortMode.None))Object.DestroyImmediate(audio);
  var track=AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/BuffPresentation/Resources/BuffTrack.json");
  var expressions=AssetDatabase.LoadAssetAtPath<TextAsset>("Assets/BuffPresentation/Resources/BuffExpressions.json");
  var actors=new LivePuppetActor[2];
  for(int i=0;i<bodies.Length;i++){
   var b=bodies[i];b.ResetToRest();b.SecondaryReplayEnabled=false;b.ConfigureTheatricalForBuild(track,Vector3.zero);
   string suffix=b.ActorId=="SHANNY"?"Jaw_Open":"jawOpen";SkinnedMeshRenderer face=null;string exact=null;
   foreach(var skin in b.GetComponentsInChildren<SkinnedMeshRenderer>(true)){
    for(int n=0;n<skin.sharedMesh.blendShapeCount;n++){string name=skin.sharedMesh.GetBlendShapeName(n);
     if((name==suffix||name.EndsWith("."+suffix,StringComparison.Ordinal))&&(face==null||skin.name.Contains("Body"))){face=skin;exact=name;}
    }
   }
   if(!face)throw new Exception("Original jaw morph unavailable");
   actors[i]=b.gameObject.AddComponent<LivePuppetActor>();actors[i].Configure(b.gameObject.AddComponent<AudioSource>(),face,exact);
   var mouth=b.GetComponent<CharacterMouthRouter>();
   if(!mouth)throw new Exception("Original coordinated mouth routes unavailable for "+b.ActorId);
   actors[i].ConfigureMouth(mouth);
   var expression=b.GetComponent<EpisodeExpressionPlayer>()??b.gameObject.AddComponent<EpisodeExpressionPlayer>();
   expression.ConfigureForBuild(b.ActorId,expressions);
   Debug.Log("BUFF_MOUTH_ROUTES: "+b.ActorId+" "+mouth.RouteCount);
  }
  foreach(var listener in Object.FindObjectsByType<AudioListener>(FindObjectsInactive.Include,FindObjectsSortMode.None))Object.DestroyImmediate(listener);
  var originalCamera=Object.FindObjectsByType<Camera>(FindObjectsInactive.Include,FindObjectsSortMode.None).Single(c=>c.name=="Main Camera");
  var camera=new GameObject("Buff StankTank Camera").AddComponent<Camera>();camera.CopyFrom(originalCamera);
  camera.transform.SetPositionAndRotation(originalCamera.transform.position,originalCamera.transform.rotation);
  foreach(var old in Object.FindObjectsByType<Camera>(FindObjectsInactive.Include,FindObjectsSortMode.None))if(old!=camera){old.enabled=false;old.tag="Untagged";}
  camera.enabled=true;camera.tag="MainCamera";
  camera.GetUniversalAdditionalCameraData().renderPostProcessing=true;camera.gameObject.AddComponent<AudioListener>();camera.gameObject.AddComponent<LiveStageStream>();
  var stage=new GameObject("Buff Live Stage");stage.AddComponent<LivePuppetClient>().Configure(actors[0],actors[1]);
  stage.AddComponent<LiveM16Stage>();stage.AddComponent<LiveOperatorControls>();stage.AddComponent<LiveEvidenceCapture>();stage.AddComponent<LiveRigEvidence>();
  QualitySettings.vSyncCount=0;PlayerSettings.runInBackground=true;PlayerSettings.defaultScreenWidth=1280;PlayerSettings.defaultScreenHeight=720;
  // Runtime cash uses Shader.Find. A Resources material retains its shader and
  // default variant in the player, even though no bill exists in the saved scene.
  var paperShader=Shader.Find("Universal Render Pipeline/Unlit")??Shader.Find("Unlit/Texture");
  if(!paperShader||!paperShader.isSupported)throw new Exception("Supported paper shader required for rain player");
  const string paperPath="Assets/BuffPresentation/Resources/BuffPaperMaterial.mat";
  var paper=AssetDatabase.LoadAssetAtPath<Material>(paperPath);
  if(!paper){paper=new Material(paperShader);AssetDatabase.CreateAsset(paper,paperPath);}else{paper.shader=paperShader;EditorUtility.SetDirty(paper);}
  if(paper.HasProperty("_Cull"))paper.SetFloat("_Cull",0);AssetDatabase.SaveAssets();
  PlayerSettings.fullScreenMode=FullScreenMode.Windowed;PlayerSettings.companyName="Strange Machinery";PlayerSettings.productName="Buff StankTank";
  EditorSceneManager.SaveScene(scene,"Assets/BuffPresentation/BuffLive.unity");
  var result=BuildPipeline.BuildPlayer(new BuildPlayerOptions{scenes=new[]{"Assets/BuffPresentation/BuffLive.unity"},locationPathName="Build/BuffStankTank.exe",target=BuildTarget.StandaloneWindows64,options=BuildOptions.Development});
  if(result.summary.result!=UnityEditor.Build.Reporting.BuildResult.Succeeded)throw new Exception("Buff presentation build failed");
  Debug.Log("BUFF_PRESENTATION_BUILD_SUCCEEDED");
 }
}
#endif
