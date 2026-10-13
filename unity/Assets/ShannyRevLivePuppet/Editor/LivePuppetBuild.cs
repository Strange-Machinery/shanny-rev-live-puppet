using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;
using ShannyRev.LivePuppet;

public static class LivePuppetBuild
{
    public static void Build()
    {
        string source = Environment.GetEnvironmentVariable("LIVE_SOURCE_SCENE");
        if (string.IsNullOrEmpty(source)) throw new Exception("LIVE_SOURCE_SCENE must identify a private copied scene.");
        var stagingYaw = new Dictionary<string,float>();
        foreach (Match match in Regex.Matches(File.ReadAllText(source), @"demoFacingYawDegrees:\s*([-\d.]+)\s+actorId:\s*(SHANNY|REV)"))
            stagingYaw[match.Groups[2].Value] = float.Parse(match.Groups[1].Value,CultureInfo.InvariantCulture);
        var scene = EditorSceneManager.OpenScene(source);
        var actors = scene.GetRootGameObjects().SelectMany(x => x.GetComponentsInChildren<Transform>(true)).Where(x => x.name == "SHANNY CHARACTER" || x.name == "REV CHARACTER").Select(x=>x.gameObject).ToArray();
        if (actors.Length != 2) throw new Exception("Expected two production character roots.");
        foreach (var actor in actors) actor.transform.SetParent(null, true);
        foreach (var root in scene.GetRootGameObjects()) if (!actors.Contains(root)) UnityEngine.Object.DestroyImmediate(root);
        var inventory = new List<string>();
        var live = new List<LivePuppetActor>();
        Bounds bounds = new Bounds(); bool first = true;
        foreach (var root in actors.OrderBy(x => x.name == "SHANNY CHARACTER" ? 0 : 1)) {
            foreach (var t in root.GetComponentsInChildren<Transform>(true)) GameObjectUtility.RemoveMonoBehavioursWithMissingScript(t.gameObject);
            foreach (var component in root.GetComponentsInChildren<MonoBehaviour>(true)) UnityEngine.Object.DestroyImmediate(component);
            foreach (var animator in root.GetComponentsInChildren<Animator>(true)) animator.enabled = false;
            string actorId = root.name.StartsWith("SHANNY") ? "SHANNY" : "REV";
            string idlePath = Environment.GetEnvironmentVariable("LIVE_" + actorId + "_IDLE") ??
                (actorId == "SHANNY" ? "Assets/P5Alpha/Stage/Shanny/SHANNY_StandingHold.anim" : "Assets/P5Alpha/Stage/REV/REV_StandingHold.anim");
            var idle = AssetDatabase.LoadAssetAtPath<AnimationClip>(idlePath);
            var visual = root.GetComponentsInChildren<Transform>(true).Single(x=>x.name=="Visual");
            if (idle == null) throw new Exception("Copy the approved private standing-hold clip: " + idlePath);
            var sample = UnityEngine.Object.Instantiate(idle); sample.legacy = true;
            sample.SampleAnimation(visual.gameObject,0); UnityEngine.Object.DestroyImmediate(sample);
            if (!stagingYaw.TryGetValue(actorId,out float yaw) || float.IsNaN(yaw) || Mathf.Abs(yaw)>360) throw new Exception("Missing approved staging yaw for " + actorId);
            var hips=visual.GetComponentsInChildren<Transform>(true).Single(x=>x.name==(actorId=="SHANNY"?"CC_Base_Hip":"pelvis"));
            var parentRotation=hips.parent.rotation;
            hips.localRotation=(Quaternion.Inverse(parentRotation)*Quaternion.AngleAxis(yaw,Vector3.up)*parentRotation)*hips.localRotation;
            foreach (var audio in root.GetComponentsInChildren<AudioSource>(true)) UnityEngine.Object.DestroyImmediate(audio);
            string suffix = root.name.StartsWith("SHANNY") ? "Jaw_Open" : "jawOpen";
            SkinnedMeshRenderer face = null; string exact = null;
            foreach (var skin in root.GetComponentsInChildren<SkinnedMeshRenderer>(true)) {
                var mesh = skin.sharedMesh; if (mesh == null) continue;
                if (skin.enabled && skin.gameObject.activeInHierarchy) { if(first){bounds=skin.bounds;first=false;}else bounds.Encapsulate(skin.bounds); }
                for (int i=0;i<mesh.blendShapeCount;i++) {
                    string name = mesh.GetBlendShapeName(i);
                    inventory.Add(root.name + " | " + skin.name + " | " + name);
                    if ((name == suffix || name.EndsWith("."+suffix,StringComparison.Ordinal)) && (face == null || skin.name.Contains("Body"))) {face=skin;exact=name;}
                }
            }
            if (face == null) throw new Exception("No verified jaw morph for " + root.name);
            var actor = root.AddComponent<LivePuppetActor>(); actor.Configure(root.AddComponent<AudioSource>(),face,exact); live.Add(actor);
            inventory.Add("SELECTED " + root.name + " | " + face.name + " | " + exact);
        }
        File.WriteAllLines(Path.Combine(Directory.GetCurrentDirectory(),"blendshape-inventory.txt"),inventory);
        var camera = new GameObject("Live Camera").AddComponent<Camera>(); camera.gameObject.AddComponent<AudioListener>();
        camera.transform.position = bounds.center + new Vector3(0,0,Mathf.Max(3,bounds.size.x*1.1f)); camera.transform.LookAt(bounds.center);
        camera.backgroundColor = new Color(.055f,.06f,.075f); camera.clearFlags = CameraClearFlags.SolidColor;
        var key = new GameObject("Live Key").AddComponent<Light>(); key.type=LightType.Directional; key.intensity=1.6f; key.transform.rotation=Quaternion.Euler(30,155,0);
        RenderSettings.ambientLight = new Color(.5f,.5f,.5f);
        var renderer=AssetDatabase.LoadAssetAtPath<UniversalRendererData>("Assets/LiveRenderer.asset");
        if(renderer==null){renderer=ScriptableObject.CreateInstance<UniversalRendererData>();AssetDatabase.CreateAsset(renderer,"Assets/LiveRenderer.asset");}
        var pipeline=AssetDatabase.LoadAssetAtPath<UniversalRenderPipelineAsset>("Assets/LivePipeline.asset");
        if(pipeline==null){pipeline=UniversalRenderPipelineAsset.Create(renderer);AssetDatabase.CreateAsset(pipeline,"Assets/LivePipeline.asset");}
        GraphicsSettings.defaultRenderPipeline=pipeline;QualitySettings.renderPipeline=pipeline;
        QualitySettings.vSyncCount = 0;
        var client = new GameObject("Live Puppet Gateway").AddComponent<LivePuppetClient>(); client.Configure(live[0],live[1]);
        client.gameObject.AddComponent<LiveOperatorControls>(); client.gameObject.AddComponent<LiveEvidenceCapture>();
        EditorSceneManager.SaveScene(scene,"Assets/LivePuppet.unity");
        PlayerSettings.runInBackground=true; PlayerSettings.defaultScreenWidth=1280;PlayerSettings.defaultScreenHeight=720;
        PlayerSettings.fullScreenMode=FullScreenMode.Windowed;PlayerSettings.companyName="Strange Machinery";PlayerSettings.productName="Shanny Rev Live Puppet";
        var build=BuildPipeline.BuildPlayer(new BuildPlayerOptions{scenes=new[]{"Assets/LivePuppet.unity"},locationPathName="Build/LivePuppet.exe",target=BuildTarget.StandaloneWindows64,options=BuildOptions.Development});
        if(build.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded)throw new Exception("Live build failed: "+build.summary.result);
        Debug.Log("LIVE_BUILD_SUCCEEDED");
    }
}
