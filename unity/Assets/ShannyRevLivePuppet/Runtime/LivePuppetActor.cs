using System.Collections.Generic;
using UnityEngine;

namespace ShannyRev.LivePuppet
{
    /// <summary>
    /// Deliberately tiny stage component. It animates optional blendshapes from
    /// the ACTUAL playing AudioSource; no Rhubarb, Timeline or baked animation.
    /// Tune morph names and gain against the production face mesh in Inspector.
    /// </summary>
    public sealed class LivePuppetActor : MonoBehaviour
    {
        [SerializeField] private AudioSource voice;
        [SerializeField] private SkinnedMeshRenderer face;
        [SerializeField] private string jawBlendshape = "JawOpen";
        [SerializeField] private string wideBlendshape = "";
        [SerializeField] private string puckerBlendshape = "";
        [SerializeField, Range(0f, 100f)] private float jawMaximum = 72f;
        [SerializeField, Range(0f, 100f)] private float wideMaximum = 25f;
        [SerializeField, Range(0f, 100f)] private float puckerMaximum = 20f;
        [SerializeField] private float rmsGain = 12f;
        [SerializeField] private float smoothingHz = 18f;

        private readonly Queue<AudioClip> pending = new Queue<AudioClip>();
        private readonly float[] samples = new float[256];
        private readonly float[] spectrum = new float[256];
        private AudioClip activeClip;
        private int jawIndex = -1;
        private int wideIndex = -1;
        private int puckerIndex = -1;
        private float jaw;
        private float wide;
        private float pucker;

        private void Awake()
        {
            var mesh = face != null ? face.sharedMesh : null;
            if (mesh == null) return;
            if (!string.IsNullOrEmpty(jawBlendshape))
                jawIndex = mesh.GetBlendShapeIndex(jawBlendshape);
            if (!string.IsNullOrEmpty(wideBlendshape))
                wideIndex = mesh.GetBlendShapeIndex(wideBlendshape);
            if (!string.IsNullOrEmpty(puckerBlendshape))
                puckerIndex = mesh.GetBlendShapeIndex(puckerBlendshape);
        }

        public void Enqueue(AudioClip clip, bool interrupt)
        {
            if (clip == null) return;
            if (interrupt) StopAll();
            pending.Enqueue(clip);
        }

        public void StopAll()
        {
            if (voice != null)
            {
                voice.Stop();
                voice.clip = null;
            }
            if (activeClip != null) Destroy(activeClip);
            activeClip = null;
            while (pending.Count > 0)
                Destroy(pending.Dequeue());
            jaw = wide = pucker = 0f;
            SetWeights();
        }

        private void OnDisable() { StopAll(); }

        private void Update()
        {
            if (voice == null) return;
            if (!voice.isPlaying)
            {
                if (activeClip != null)
                {
                    voice.clip = null;
                    Destroy(activeClip);
                    activeClip = null;
                }
                if (pending.Count > 0)
                {
                    activeClip = pending.Dequeue();
                    voice.clip = activeClip;
                    voice.Play();
                }
            }

            float jawTarget = 0f;
            float wideTarget = 0f;
            float puckerTarget = 0f;
            if (voice.isPlaying)
            {
                voice.GetOutputData(samples, 0);
                float energy = 0f;
                for (int i = 0; i < samples.Length; i++)
                    energy += samples[i] * samples[i];
                float rms = Mathf.Sqrt(energy / samples.Length);
                float open = Mathf.Clamp01((rms - 0.008f) * rmsGain);
                jawTarget = open * jawMaximum;

                if (wideIndex >= 0 || puckerIndex >= 0)
                {
                    // Rough spectral articulation only; NOT phoneme-accurate visemes.
                    voice.GetSpectrumData(spectrum, 0, FFTWindow.BlackmanHarris);
                    float low = 0.0001f;
                    float high = 0.0001f;
                    for (int i = 2; i < spectrum.Length; i++)
                    {
                        if (i < 24) low += spectrum[i];
                        else if (i < 96) high += spectrum[i];
                    }
                    float highRatio = high / (low + high);
                    wideTarget = open * Mathf.Clamp01(highRatio * 2.3f) * wideMaximum;
                    puckerTarget = open * (1f - Mathf.Clamp01(highRatio * 2f)) * puckerMaximum;
                }
            }

            float alpha = 1f - Mathf.Exp(-Mathf.Max(1f, smoothingHz) * Time.deltaTime);
            jaw = Mathf.Lerp(jaw, jawTarget, alpha);
            wide = Mathf.Lerp(wide, wideTarget, alpha);
            pucker = Mathf.Lerp(pucker, puckerTarget, alpha);
            SetWeights();
        }

        private void SetWeights()
        {
            if (face == null) return;
            if (jawIndex >= 0) face.SetBlendShapeWeight(jawIndex, jaw);
            if (wideIndex >= 0) face.SetBlendShapeWeight(wideIndex, wide);
            if (puckerIndex >= 0) face.SetBlendShapeWeight(puckerIndex, pucker);
        }
    }
}
