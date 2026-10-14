#if BUFF_M16
using System;
using System.Collections.Generic;
using UnityEngine;
namespace ShannyRevDemo {
 public sealed partial class EpisodeExpressionPlayer {
  static readonly Dictionary<string,Dictionary<string,float>> BuffFaces=BuildBuffFaces();
  int buffFaceSample=-1;
  static Dictionary<string,Dictionary<string,float>> BuildBuffFaces(){
   var result=new Dictionary<string,Dictionary<string,float>>();
   foreach(string actor in new[]{"SHANNY","REV"})foreach(string mood in new[]{"anger","rage","crying","smug","surprised","pacifying","irritated","skeptical"}){
    var w=new Dictionary<string,float>();
    Action<string,float> pair=(name,value)=>{
     if(actor=="SHANNY"){w[name+"_L"]=value;w[name+"_R"]=value;}
     else {string canonical=name=="Brow_Drop"?"browDown":name=="Brow_Raise_Outer"?"browOuterUp":name=="Eye_Squint"?"eyeSquint":name=="Eye_Wide"?"eyeWide":name=="Mouth_Frown"?"mouthFrown":name=="Mouth_Smile"?"mouthSmile":"cheekSquint";w[canonical+"Left"]=value;w[canonical+"Right"]=value;}
    };
    Action<float> inner=value=>{if(actor=="SHANNY"){w["Brow_Raise_Inner_L"]=value;w["Brow_Raise_Inner_R"]=value;}else w["browInnerUp"]=value;};
    switch(mood){
     case "rage":pair("Brow_Drop",32);pair("Eye_Wide",26);pair("Cheek_Squint",22);pair("Mouth_Frown",26);if(actor=="SHANNY"){w["Brow_Compress_L"]=28;w["Brow_Compress_R"]=28;}break;
     case "crying":inner(32);pair("Brow_Raise_Outer",10);pair("Mouth_Frown",30);pair("Eye_Squint",18);break;
     case "smug":pair("Mouth_Smile",30);pair("Eye_Squint",18);pair("Brow_Raise_Outer",18);break;
     case "surprised":inner(28);pair("Brow_Raise_Outer",30);pair("Eye_Wide",32);break;
     case "pacifying":inner(22);pair("Brow_Raise_Outer",10);pair("Mouth_Smile",12);pair("Eye_Squint",6);break;
     case "skeptical":pair("Eye_Squint",14);pair("Mouth_Frown",9);if(actor=="REV"){w["browOuterUpLeft"]=29;w["browDownRight"]=15;}break;
     case "irritated":pair("Eye_Squint",14);pair("Mouth_Frown",15);pair("Cheek_Squint",7);if(actor=="REV"){w["browDownLeft"]=10;w["browDownRight"]=18;w["browOuterUpLeft"]=15;w["mouthFrownRight"]=18;}break;
     default:pair("Brow_Drop",24);pair("Eye_Squint",18);pair("Cheek_Squint",16);pair("Mouth_Frown",20);break;
    }
    result[actor+":"+mood]=w;
   }
   return result;
  }
  public void SampleBuffFace(int sample,string mood,bool speaking,float open){
   Initialize();ValidateBindings();
   if(string.IsNullOrEmpty(mood)||!BuffFaces.TryGetValue(actorId+":"+mood,out var targets))targets=BuffFaces[actorId+":"+(actorId=="SHANNY"?"anger":"skeptical")];
   float delta=buffFaceSample<0?1:Mathf.Clamp((sample-buffFaceSample)/48000f,0,.1f);buffFaceSample=sample;
   float alpha=1-Mathf.Exp(-12*delta);
   // Voice energy supplies emphasis without waiting for phoneme analysis or an AI pass.
   float emphasis=speaking ? .78f+Mathf.Clamp01(open/72f)*.35f+.10f*Mathf.Sin(sample/48000f*8) : .60f;
   foreach(var binding in bindings){
    if(binding.shape=="Jaw_Open"||binding.shape=="jawOpen")continue;
    if(binding.shape.StartsWith("Eye_Blink")||binding.shape.StartsWith("eyeBlink")){binding.renderer.SetBlendShapeWeight(binding.index,0);continue;}
    float value=targets.TryGetValue(binding.shape,out float target)?Mathf.Clamp(target*emphasis,0,35):binding.baseline;
    binding.renderer.SetBlendShapeWeight(binding.index,Mathf.Lerp(binding.renderer.GetBlendShapeWeight(binding.index),value,alpha));
   }
   SampleCandidateBlinks(sample);
  }
 }
}
#endif
