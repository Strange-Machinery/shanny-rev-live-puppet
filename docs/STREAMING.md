# Streaming investigation

Inspected the installed pinned OmniVoice model implementation and existing LIVE/python/omnivoice_live_worker.py on 2026-10-13. `OmniVoice.generate` returns `list[np.ndarray]`; this worker calls it synchronously, synchronizes CUDA, converts the returned waveform, writes a temporary WAV, atomically replaces the final file, and only then emits RESULT. No PCM chunk callback or yielding speech interface is exposed by this worker. Dataset iterators and CUDA streams in the installed package are not speech-audio streaming.

Splitting a completed WAV over HTTP would only stream transport after synthesis; it cannot reduce time to the first generated audio sample. Independently synthesizing short sentence segments could reduce per-segment wait but introduces prosody discontinuity and is not true incremental synthesis. Investigating an alternate incremental decoder would require validating the model's generation algorithm, audio continuity, cancellation and bounded ring buffering on this GPU. No incremental speech-audio implementation is claimed here.

The conversation path now streams **Qwen text** over bounded SSE. Once a complete,
validated first sentence arrives, its complete-WAV synthesis starts while Qwen
finishes the plan. The full plan must validate and match that sentence before any
release; invalid output or Stop discards the held work. This overlaps existing
stages without changing the pinned OmniVoice pipeline or voice references.
