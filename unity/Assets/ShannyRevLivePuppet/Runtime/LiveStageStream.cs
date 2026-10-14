#if BUFF_M16
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.Networking;
using Unity.WebRTC;

namespace ShannyRev.LivePuppet {
 [RequireComponent(typeof(Camera),typeof(AudioListener))]
 public sealed class LiveStageStream : MonoBehaviour {
  [Serializable] class PeerOffer {public string id,sdp;}
  [Serializable] class Ice {public string[] urls;public string username,credential;}
  [Serializable] class Command {public string id,alias;public string[] targets;}
  [Serializable] class CommandReceipt {public string id;public bool accepted;public int duration_ms;}
  [Serializable] class Poll {public PeerOffer[] peers;public Ice[] iceServers;public int control_epoch;public Command[] commands;}
  [Serializable] class Answer {public string id,sdp,error;}
  [Serializable] class State {public string state;}
  readonly Dictionary<string,RTCPeerConnection> peers=new Dictionary<string,RTCPeerConnection>();
  readonly object audioLock=new object();
  Camera cameraView;VideoStreamTrack video;AudioStreamTrack audio;MediaStream stream;
  string endpoint,token,state="starting";int sampleRate;bool closing;
  LiveM16Stage stage;int controlEpoch=-1;readonly Dictionary<string,bool> receipts=new Dictionary<string,bool>();
  IEnumerator Start(){
   endpoint=Environment.GetEnvironmentVariable("LIVE_MEDIA_URL");token=Environment.GetEnvironmentVariable("LIVE_PUPPET_TOKEN");
   if(string.IsNullOrEmpty(endpoint))yield break;
   stage=FindFirstObjectByType<LiveM16Stage>();
   while(stage!=null&&!stage.Ready)yield return null;
   if(!Uri.TryCreate(endpoint,UriKind.Absolute,out var uri)||uri.Scheme!="http"||uri.Host!="127.0.0.1"||!string.IsNullOrEmpty(uri.UserInfo)||uri.AbsolutePath!="/")throw new InvalidOperationException("Loopback stage signaling required");
   cameraView=GetComponent<Camera>();sampleRate=AudioSettings.outputSampleRate;
   Application.targetFrameRate=30;QualitySettings.vSyncCount=0;
   video=cameraView.CaptureStreamTrack(1920,1080);
   audio=new AudioStreamTrack();stream=new MediaStream();stream.AddTrack(video);stream.AddTrack(audio);
   StartCoroutine(WebRTC.Update());state="ready";
   while(!closing){
    state=stage!=null&&!stage.Ready?"body_error":"ready";
    using(var req=Request("/poll",JsonUtility.ToJson(new State{state=state}))){
     yield return req.SendWebRequest();
     if(req.result==UnityWebRequest.Result.Success){
      var poll=JsonUtility.FromJson<Poll>(req.downloadHandler.text);
      if(poll.control_epoch!=controlEpoch){controlEpoch=poll.control_epoch;stage?.StopMotions();receipts.Clear();}
      foreach(var command in poll.commands??new Command[0]){
       if(!receipts.TryGetValue(command.id,out bool accepted)){
        try{accepted=stage!=null&&stage.Play(command.alias,command.targets);}catch(Exception e){accepted=false;Debug.LogException(e);}
        receipts[command.id]=accepted;
       }
       using(var ack=Request("/command-receipt",JsonUtility.ToJson(new CommandReceipt{id=command.id,accepted=accepted,duration_ms=stage?.PresentationDurationMs??20000})))yield return ack.SendWebRequest();
      }
      var pending=new HashSet<string>((poll.commands??new Command[0]).Select(c=>c.id));
      foreach(var id in receipts.Keys.Where(id=>!pending.Contains(id)).ToArray())receipts.Remove(id);
      var ids=new HashSet<string>((poll.peers??new PeerOffer[0]).Select(p=>p.id));
      foreach(var id in peers.Keys.Where(id=>!ids.Contains(id)).ToArray())ClosePeer(id);
      foreach(var offer in poll.peers??new PeerOffer[0])if(!string.IsNullOrEmpty(offer.sdp)&&!peers.ContainsKey(offer.id)){
       var config=new RTCConfiguration{iceServers=(poll.iceServers??new Ice[0]).Select(s=>new RTCIceServer{urls=s.urls,username=s.username,credential=s.credential}).ToArray()};
       var pc=new RTCPeerConnection(ref config);peers.Add(offer.id,pc);StartCoroutine(AnswerOffer(offer,pc));
      }
     }else{foreach(var id in peers.Keys.ToArray())ClosePeer(id);}
    }
    yield return new WaitForSecondsRealtime(.25f);
   }
  }
  UnityWebRequest Request(string route,string body){
   var req=new UnityWebRequest(endpoint+route,"POST");req.uploadHandler=new UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(body));
   req.downloadHandler=new DownloadHandlerBuffer();req.SetRequestHeader("Authorization","Bearer "+token);req.SetRequestHeader("Content-Type","application/json");req.timeout=5;req.redirectLimit=0;return req;
  }
  bool Current(string id,RTCPeerConnection pc)=>!closing&&peers.TryGetValue(id,out var current)&&current==pc;
  IEnumerator AnswerOffer(PeerOffer offer,RTCPeerConnection pc){
   var description=new RTCSessionDescription{type=RTCSdpType.Offer,sdp=offer.sdp};
   var remote=pc.SetRemoteDescription(ref description);yield return remote;
   if(!Current(offer.id,pc))yield break;
   if(remote.IsError){yield return Fail(offer.id,"Stage offer rejected");yield break;}
   var sender=pc.AddTrack(video,stream);pc.AddTrack(audio,stream);
   var h264=RTCRtpSender.GetCapabilities(TrackKind.Video).codecs.Where(c=>c.mimeType=="video/H264").ToArray();
   if(h264.Length==0){yield return Fail(offer.id,"Hardware H264 encoder unavailable");yield break;}
   foreach(var transceiver in pc.GetTransceivers())if(transceiver.Sender.Track?.Kind==TrackKind.Video||transceiver.Receiver.Track?.Kind==TrackKind.Video){
    if(transceiver.SetCodecPreferences(h264)!=RTCErrorType.None){yield return Fail(offer.id,"H264 negotiation failed");yield break;}
   }
   var answer=pc.CreateAnswer();yield return answer;
   if(!Current(offer.id,pc))yield break;
   if(answer.IsError){yield return Fail(offer.id,"Stage answer failed");yield break;}
   var local=answer.Desc;var set=pc.SetLocalDescription(ref local);yield return set;
   if(!Current(offer.id,pc))yield break;
   if(set.IsError){yield return Fail(offer.id,"Stage connection setup failed");yield break;}
   var parameters=sender.GetParameters();
   foreach(var encoding in parameters.encodings){encoding.maxBitrate=12000000;encoding.minBitrate=4000000;encoding.maxFramerate=30;encoding.scaleResolutionDownBy=1;}
   if(sender.SetParameters(parameters).errorType!=RTCErrorType.None){yield return Fail(offer.id,"Stage quality settings rejected");yield break;}
   float until=Time.realtimeSinceStartup+8;
   while(Current(offer.id,pc)&&pc.GatheringState!=RTCIceGatheringState.Complete&&Time.realtimeSinceStartup<until)yield return null;
   if(!Current(offer.id,pc))yield break;
   using(var req=Request("/answer",JsonUtility.ToJson(new Answer{id=offer.id,sdp=pc.LocalDescription.sdp})))yield return req.SendWebRequest();
  }
  IEnumerator Fail(string id,string reason){
   using(var req=Request("/answer",JsonUtility.ToJson(new Answer{id=id,error=reason})))yield return req.SendWebRequest();
   ClosePeer(id);
  }
  void OnAudioFilterRead(float[] data,int channels){lock(audioLock){if(!closing&&audio!=null)audio.SetData(data,channels,sampleRate);}}
  void OnGUI(){if(cameraView&&cameraView.targetTexture)GUI.DrawTexture(new Rect(0,0,Screen.width,Screen.height),cameraView.targetTexture,ScaleMode.ScaleToFit,false);}
  void ClosePeer(string id){if(peers.TryGetValue(id,out var pc)){peers.Remove(id);pc.Close();pc.Dispose();}}
  void OnDestroy(){
   lock(audioLock){closing=true;audio?.Dispose();audio=null;}
   foreach(var id in peers.Keys.ToArray())ClosePeer(id);
   stream?.Dispose();video?.Dispose();
   if(cameraView&&cameraView.targetTexture){var rt=cameraView.targetTexture;cameraView.targetTexture=null;rt.Release();Destroy(rt);}
  }
 }
}

#endif
