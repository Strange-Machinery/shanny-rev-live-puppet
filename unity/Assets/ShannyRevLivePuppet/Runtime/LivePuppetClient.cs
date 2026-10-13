using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;

namespace ShannyRev.LivePuppet
{
    public sealed class LivePuppetClient : MonoBehaviour
    {
        [SerializeField] private string endpoint = "http://127.0.0.1:8770";
        [SerializeField] private LivePuppetActor shanny;
        [SerializeField] private LivePuppetActor rev;
        [SerializeField, Range(0.05f, 1f)] private float pollSeconds = 0.1f;
        private string token;
        private const string Version = "shanny-rev-live-puppet/v1";
        [Serializable] private sealed class Envelope {
            public string schema_version, session_id;
            public long cursor;
            public int epoch;
            public bool muted;
            public StageEvent[] events;
        }
        [Serializable] private sealed class StageEvent {
            public string type, id, actor, delivery, audio_path, session_id;
            public int epoch;
            public long seq;
            [NonSerialized] public double downloadedAt;
            [NonSerialized] public float transportMs;
        }
        [Serializable] private sealed class Receipt {
            public string id, actor, state, session_id;
            public int epoch, max_audio_sample;
            public float transport_decode_ms, queue_to_play_ms, peak_jaw_weight, idle_jaw_weight, average_fps, max_frame_ms;
        }
        private readonly Queue<StageEvent> shannyQueue = new Queue<StageEvent>();
        private readonly Queue<StageEvent> revQueue = new Queue<StageEvent>();
        private readonly Dictionary<string, StageEvent> playing = new Dictionary<string, StageEvent>();
        private long cursor;
        private int generation, epoch;
        private string session;
        private bool baselineReady, locallyMuted;
        private readonly string instanceId = Guid.NewGuid().ToString("D");
        [Serializable] private sealed class StageHeartbeat {
            public string session_id, instance_id;
            public int epoch;
            public bool shanny_playing, rev_playing, muted;
            public float shanny_jaw, rev_jaw;
        }
        public bool Connected => baselineReady;
        public bool Muted => locallyMuted;
        public void Configure(LivePuppetActor first, LivePuppetActor second) { shanny = first; rev = second; }
        private void OnEnable() {
            token = Environment.GetEnvironmentVariable("LIVE_PUPPET_TOKEN");
            string configured = Environment.GetEnvironmentVariable("LIVE_PUPPET_URL");
            if (!string.IsNullOrEmpty(configured)) endpoint = configured;
            if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) || uri.Scheme != "http" ||
                !(uri.Host == "127.0.0.1" || uri.Host == "[::1]" || uri.Host == "::1") ||
                uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) ||
                !string.IsNullOrEmpty(uri.Fragment) || string.IsNullOrEmpty(token)) {
                Debug.LogError("Live puppet requires a loopback endpoint and LIVE_PUPPET_TOKEN environment variable."); return;
            }
            endpoint = endpoint.TrimEnd('/');
            baselineReady = false;
            StartCoroutine(Run());
        }
        private void OnDisable() { StopAllCoroutines(); baselineReady = false; StopLocal(); }
        private void StopLocal() {
            generation++; shannyQueue.Clear(); revQueue.Clear();
            playing.Clear();
            if (shanny != null) shanny.StopAll();
            if (rev != null) rev.StopAll();
        }
        public void Panic() {
            locallyMuted = true; StopLocal(); baselineReady = false;
            if (isActiveAndEnabled) StartCoroutine(Control("panic"));
        }
        public void ResumeLive() { if (isActiveAndEnabled) StartCoroutine(Control("resume")); }
        private UnityWebRequest Prepare(UnityWebRequest req) {
            req.SetRequestHeader("Authorization", "Bearer " + token);
            req.timeout = 5; req.redirectLimit = 0; return req;
        }
        private IEnumerator Control(string action) {
            using (var req = Prepare(new UnityWebRequest(endpoint + "/v1/" + action, "POST"))) {
                req.downloadHandler = new DownloadHandlerBuffer();
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success) {
                    Debug.LogWarning("Live control failed; stage stays locally muted."); yield break;
                }
                if (action == "resume") locallyMuted = false;
                baselineReady = false;
            }
        }
        private IEnumerator Run() {
            // Configure() can be called immediately after AddComponent, before this first frame.
            yield return null;
            if (shanny == null || rev == null) { Debug.LogError("Both live actors must be assigned."); yield break; }
            shanny.Playback += OnPlayback;
            rev.Playback += OnPlayback;
            StartCoroutine(Drain(shannyQueue, shanny)); StartCoroutine(Drain(revQueue, rev));
            StartCoroutine(Heartbeat());
            try {
                while (isActiveAndEnabled) {
                    int captured = generation;
                    string route = baselineReady ? "/v1/events?after=" + cursor + "&session=" + session : "/v1/status";
                    using (var req = Prepare(UnityWebRequest.Get(endpoint + route))) {
                        yield return req.SendWebRequest();
                        if (captured != generation) continue;
                        if (req.result != UnityWebRequest.Result.Success) {
                            StopLocal(); baselineReady = false;
                        } else {
                            Envelope page = null;
                            try { page = JsonUtility.FromJson<Envelope>(req.downloadHandler.text); } catch (Exception) { }
                            if (page == null || page.schema_version != Version || string.IsNullOrEmpty(page.session_id)) {
                                StopLocal(); baselineReady = false;
                            } else if (!baselineReady) {
                                session = page.session_id; epoch = page.epoch; cursor = page.cursor;
                                if (page.muted) locallyMuted = true;
                                baselineReady = true;
                            } else if (page.session_id != session) {
                                StopLocal(); baselineReady = false;
                            } else {
                                if (epoch != page.epoch) { StopLocal(); epoch = page.epoch; }
                                if (page.muted) { locallyMuted = true; StopLocal(); }
                                if (page.events != null) foreach (var item in page.events) {
                                    if (item.epoch != epoch || item.session_id != session) continue;
                                    if (item.type == "panic") { locallyMuted = true; StopLocal(); }
                                    else if (item.type == "resume") locallyMuted = false;
                                    else if (item.type == "interrupt") StopLocal();
                                    else if (item.type == "speech.ready" && !locallyMuted) {
                                        var queue = item.actor == "SHANNY" ? shannyQueue : item.actor == "REV" ? revQueue : null;
                                        if (queue != null && queue.Count < 8) queue.Enqueue(item);
                                    }
                                }
                                cursor = page.cursor;
                            }
                        }
                    }
                    yield return new WaitForSecondsRealtime(baselineReady ? pollSeconds : 1f);
                }
            } finally { shanny.Playback -= OnPlayback; rev.Playback -= OnPlayback; }
        }
        private IEnumerator Heartbeat() {
            while (isActiveAndEnabled) {
                if (baselineReady) {
                    var row = new StageHeartbeat { session_id = session, epoch = epoch, instance_id = instanceId,
                        shanny_playing = shanny.IsPlaying, rev_playing = rev.IsPlaying,
                        shanny_jaw = shanny.JawWeight, rev_jaw = rev.JawWeight, muted = locallyMuted };
                    using (var req = Prepare(new UnityWebRequest(endpoint + "/v1/stage", "POST"))) {
                        req.uploadHandler = new UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(JsonUtility.ToJson(row)));
                        req.downloadHandler = new DownloadHandlerBuffer(); req.SetRequestHeader("Content-Type", "application/json");
                        yield return req.SendWebRequest();
                    }
                }
                yield return new WaitForSecondsRealtime(.25f);
            }
        }
        private IEnumerator Drain(Queue<StageEvent> queue, LivePuppetActor actor) {
            while (isActiveAndEnabled) {
                if (queue.Count == 0 || locallyMuted || !baselineReady) { yield return null; continue; }
                var item = queue.Dequeue(); int captured = generation;
                if (!Guid.TryParseExact(item.id, "D", out _) || item.audio_path != "/v1/audio/" + item.id) continue;
                double started = Time.realtimeSinceStartupAsDouble;
                using (var req = Prepare(UnityWebRequestMultimedia.GetAudioClip(endpoint + item.audio_path, AudioType.WAV))) {
                    yield return req.SendWebRequest();
                    if (req.result != UnityWebRequest.Result.Success) continue;
                    var clip = DownloadHandlerAudioClip.GetContent(req);
                    if (captured != generation || locallyMuted || !baselineReady) { if (clip != null) Destroy(clip); continue; }
                    item.downloadedAt = Time.realtimeSinceStartupAsDouble;
                    item.transportMs = (float)((item.downloadedAt - started) * 1000);
                    // Bound receipt metadata independently of the audio queues.
                    if (playing.Count >= 32) { Destroy(clip); continue; }
                    playing[item.id] = item;
                    if (!actor.Enqueue(clip, false, item.id)) playing.Remove(item.id);
                }
            }
        }
        private void OnPlayback(string id, string state, float peak, int sample, float fps, float frame) {
            if (!playing.TryGetValue(id, out var item)) return;
            var receipt = new Receipt { id = id, actor = item.actor, state = state,
                epoch = item.epoch, session_id = item.session_id, transport_decode_ms = item.transportMs,
                queue_to_play_ms = (float)((Time.realtimeSinceStartupAsDouble - item.downloadedAt) * 1000),
                peak_jaw_weight = peak, idle_jaw_weight = (item.actor == "SHANNY" ? shanny : rev).JawWeight,
                max_audio_sample = sample, average_fps = fps, max_frame_ms = frame };
            if (state != "started") { playing.Remove(id); receipt.queue_to_play_ms = 0; }
            Debug.Log("LIVE_PLAYBACK " + JsonUtility.ToJson(receipt));
            StartCoroutine(Acknowledge(receipt));
        }
        private IEnumerator Acknowledge(Receipt receipt) {
            using (var req = Prepare(new UnityWebRequest(endpoint + "/v1/playback", "POST"))) {
                req.uploadHandler = new UploadHandlerRaw(System.Text.Encoding.UTF8.GetBytes(JsonUtility.ToJson(receipt)));
                req.downloadHandler = new DownloadHandlerBuffer(); req.SetRequestHeader("Content-Type", "application/json");
                yield return req.SendWebRequest();
            }
        }
    }
}
