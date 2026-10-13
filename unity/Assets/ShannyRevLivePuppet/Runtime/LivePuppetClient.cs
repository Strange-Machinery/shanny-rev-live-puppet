using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Networking;

namespace ShannyRev.LivePuppet
{
    /// <summary>
    /// Authenticated loopback polling adapter: no ASR, no Qwen, no voice model,
    /// no source recording and no network listener in Unity.
    /// Requests completed WAV clips, queues each actor in event order.
    /// </summary>
    public sealed class LivePuppetClient : MonoBehaviour
    {
        [SerializeField] private string endpoint = "http://127.0.0.1:8770";
        [SerializeField] private string operatorToken = "";
        [SerializeField] private LivePuppetActor shanny;
        [SerializeField] private LivePuppetActor rev;
        [SerializeField, Range(0.05f, 1.0f)] private float pollSeconds = 0.1f;

        [Serializable] private sealed class Status
        {
            public string schema_version;
            public long cursor;
        }

        [Serializable] private sealed class EventPage
        {
            public string schema_version;
            public long cursor;
            public StageEvent[] events;
        }

        [Serializable] private sealed class StageEvent
        {
            public string type;
            public string id;
            public string actor;
            public string delivery;
            public string audio_path;
            public long seq;
        }

        private const string Version = "shanny-rev-live-puppet/v1";
        private readonly Queue<StageEvent> shannyQueue = new Queue<StageEvent>();
        private readonly Queue<StageEvent> revQueue = new Queue<StageEvent>();
        private long cursor;
        private int generation;
        private bool baselineReady;

        private void OnDisable() { StopLocal(); }

        private void StopLocal()
        {
            generation++;
            shannyQueue.Clear();
            revQueue.Clear();
            if (shanny != null) shanny.StopAll();
            if (rev != null) rev.StopAll();
        }

        /// <summary>Attach to a UI button or other operator kill control.</summary>
        public void Panic()
        {
            StopLocal();
            if (isActiveAndEnabled) StartCoroutine(NotifyPanic());
        }

        private IEnumerator NotifyPanic()
        {
            using (var request = new UnityWebRequest(endpoint + "/v1/panic", "POST"))
            {
                request.uploadHandler = new UploadHandlerRaw(new byte[0]);
                request.downloadHandler = new DownloadHandlerBuffer();
                request.SetRequestHeader("Authorization", "Bearer " + operatorToken);
                yield return request.SendWebRequest();
                if (request.result != UnityWebRequest.Result.Success)
                    Debug.LogWarning("Live puppet server panic did not confirm: " + request.error);
            }
        }

        private IEnumerator Start()
        {
            if (string.IsNullOrEmpty(operatorToken))
            {
                Debug.LogError("Live puppet token missing; refusing connection.");
                yield break;
            }
            StartCoroutine(Drain(shannyQueue, shanny));
            StartCoroutine(Drain(revQueue, rev));
            while (isActiveAndEnabled)
            {
                if (!baselineReady)
                {
                    using (var req = UnityWebRequest.Get(endpoint + "/v1/status"))
                    {
                        req.SetRequestHeader("Authorization", "Bearer " + operatorToken);
                        yield return req.SendWebRequest();
                        if (req.result == UnityWebRequest.Result.Success)
                        {
                            var status = JsonUtility.FromJson<Status>(
                                req.downloadHandler.text);
                            if (status != null && status.schema_version == Version)
                            {
                                cursor = status.cursor;
                                baselineReady = true;
                            }
                        }
                    }
                    if (!baselineReady)
                    {
                        yield return new WaitForSecondsRealtime(1f);
                        continue;
                    }
                }

                using (var req = UnityWebRequest.Get(endpoint + "/v1/events?after=" + cursor))
                {
                    req.SetRequestHeader("Authorization", "Bearer " + operatorToken);
                    yield return req.SendWebRequest();

                    if (req.responseCode == 409)
                    {
                        // Never skip a missing segment while a character keeps speaking.
                        Debug.LogWarning("Live puppet event history gap; clearing stage.");
                        StopLocal();
                        baselineReady = false;
                    }
                    else if (req.result == UnityWebRequest.Result.Success)
                    {
                        var page = JsonUtility.FromJson<EventPage>(
                            req.downloadHandler.text);
                        if (page != null && page.schema_version == Version)
                        {
                            if (page.events != null)
                            {
                                foreach (var item in page.events)
                                {
                                    if (item.type == "panic") StopLocal();
                                    else if (item.type == "speech.ready")
                                    {
                                        if (item.actor == "SHANNY")
                                            shannyQueue.Enqueue(item);
                                        else if (item.actor == "REV")
                                            revQueue.Enqueue(item);
                                    }
                                }
                            }
                            cursor = page.cursor;
                        }
                    }
                }
                yield return new WaitForSecondsRealtime(pollSeconds);
            }
        }

        private IEnumerator Drain(Queue<StageEvent> events, LivePuppetActor actor)
        {
            while (isActiveAndEnabled)
            {
                if (events.Count == 0)
                {
                    yield return null;
                    continue;
                }
                var item = events.Dequeue();
                int capturedGeneration = generation;
                if (actor == null || string.IsNullOrEmpty(item.audio_path) ||
                    !item.audio_path.StartsWith("/v1/audio/", StringComparison.Ordinal))
                    continue;
                // Server and clip endpoint are the same local host; never follow an
                // arbitrary remote URL in text returned by an external AI.
                using (var req = UnityWebRequestMultimedia.GetAudioClip(
                    endpoint + item.audio_path, AudioType.WAV))
                {
                    req.SetRequestHeader("Authorization", "Bearer " + operatorToken);
                    yield return req.SendWebRequest();
                    if (req.result != UnityWebRequest.Result.Success)
                    {
                        Debug.LogWarning("Live puppet audio unavailable: " + req.error);
                        continue;
                    }
                    var clip = DownloadHandlerAudioClip.GetContent(req);
                    if (capturedGeneration != generation || !isActiveAndEnabled)
                    {
                        if (clip != null) Destroy(clip);
                        continue;
                    }
                    actor.Enqueue(clip, item.delivery == "interrupt");
                }
            }
        }
    }
}
