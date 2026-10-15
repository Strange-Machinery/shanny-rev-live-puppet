"""Persistent, offline OmniVoice worker for Shanny & Rev LIVE.

This process keeps one verified production OmniVoice model resident and accepts
strict JSON-line GENERATE requests on stdin. Protocol responses are prefixed
with LIVE_WORKER so library/model stdout cannot be mistaken for control data.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import inspect
import json
import os
from pathlib import Path
import re
import sys
import time
import traceback
from live_episode_delivery import approved_routes, select_reference

PREFIX = "LIVE_WORKER "


def emit(payload):
    print(PREFIX + json.dumps(payload, separators=(",", ":"), ensure_ascii=False), flush=True)


def safe_output(root: Path, relative: str) -> Path:
    if not isinstance(relative, str) or not re.fullmatch(r"[A-Za-z0-9._/-]{1,256}", relative):
        raise ValueError("invalid worker output path")
    if relative.startswith("/") or ".." in Path(relative).parts:
        raise ValueError("worker output must remain relative")
    path = (root / relative).resolve()
    if root != path and root not in path.parents:
        raise ValueError("worker output escaped configured root")
    return path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-root", required=True, type=Path)
    parser.add_argument("--output-root", required=True, type=Path)
    parser.add_argument("--shanny-reference", required=True)
    parser.add_argument("--rev-reference", required=True)
    parser.add_argument("--seed", type=int, default=73001)
    parser.add_argument("--mood-references", default="{}")
    parser.add_argument("--approved-delivery-codes", default="{}")
    args = parser.parse_args()

    app_root = args.app_root.resolve(strict=True)
    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    os.chdir(app_root)
    sys.path.insert(0, str(app_root))

    try:
        import voice as production_voice

        base = production_voice.base
        saved = production_voice.saved
        report = {
            "schema_version": "shanny-rev-live/omnivoice-worker-runtime/v1",
            "status": "STARTING",
            "network_attempts": [],
        }
        base.forbid_network(report)
        os.environ["PATH"] = "C:/Dramatis/runtime/bin" + os.pathsep + os.environ.get("PATH", "")

        references, _, _ = production_voice.load_reference_catalog()
        selected = {
            "SHANNY": args.shanny_reference,
            "REV": args.rev_reference,
        }
        mood_references = json.loads(args.mood_references)
        allowed_moods = {"SHANNY": {"anger", "rage", "crying", "smug", "surprised"},
                         "REV": {"pacifying", "irritated", "rage", "skeptical", "surprised"}}
        if not isinstance(mood_references, dict) or any(actor not in allowed_moods for actor in mood_references):
            raise RuntimeError("Unknown mood-reference actor")
        prompt_choices = set(selected.items())
        for actor, choices in mood_references.items():
            if not isinstance(choices, dict) or any(mood not in allowed_moods[actor] for mood in choices):
                raise RuntimeError("Unknown voice mood")
            for reference_id in choices.values():
                if not isinstance(reference_id, str):
                    raise RuntimeError("Invalid mood reference")
                prompt_choices.add((actor, reference_id))
        requested_delivery = json.loads(args.approved_delivery_codes)
        episode_routes = {}
        if requested_delivery:
            # The episode catalog verifies every saved prompt and source receipt.
            from expanded_voices import load_library
            episode_routes = approved_routes(load_library(), references, requested_delivery)
            if not episode_routes.get('SHANNY') or not episode_routes.get('REV'):
                raise RuntimeError('Both characters need real, approved episode delivery references')
            for actor, codes in episode_routes.items():
                for variants in codes.values():
                    for candidate in variants:
                        prompt_choices.add((actor, candidate['reference_id']))
        for actor, reference_id in prompt_choices:
            if reference_id not in references or references[reference_id]["speaker"].upper() != actor:
                raise RuntimeError(f"{actor} reference is missing or belongs to another actor: {reference_id}")

        manifest, model_dir = base.verify_inputs(report, production_voice.NATIVE / "model-manifest.json")
        package_versions = {}
        for name in base.PACKAGES:
            try:
                package_versions[name] = importlib.metadata.version(name)
            except importlib.metadata.PackageNotFoundError:
                package_versions[name] = None

        dll_handles = base.add_windows_dll_directories(report)
        import numpy as np
        import torch
        import torchaudio
        from omnivoice import OmniVoice, VoiceClonePrompt, OmniVoiceGenerationConfig

        sys.path.insert(0, str(base.A))
        import omnivoice_local_transport as transport

        if base.sha_file(inspect.getfile(OmniVoice)) != base.SOURCE_SHA256:
            raise RuntimeError("native OmniVoice source changed")
        if torch.__version__ != "2.8.0+cu128" or torchaudio.__version__ != "2.8.0+cu128":
            raise RuntimeError("Torch pins changed")
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA unavailable")
        if production_voice.dataclasses.asdict(OmniVoiceGenerationConfig()) != base.EXPECTED_DEFAULTS:
            raise RuntimeError("OmniVoice generation defaults changed")
        if transport.NATIVE_GENERATION_SETTINGS != base.GENERATION:
            raise RuntimeError("native generation settings changed")

        load_started = time.perf_counter()
        model = OmniVoice.from_pretrained(
            str(model_dir),
            local_files_only=True,
            load_asr=False,
            train=False,
            device_map="cuda:0",
            dtype=torch.float16,
            attn_implementation="sdpa",
        )
        torch.cuda.synchronize()
        if model._asr_pipe is not None:
            raise RuntimeError("ASR unexpectedly loaded")

        prompts = {}
        saved.SEED = args.seed
        for actor, reference_id in sorted(prompt_choices):
            reference = references[reference_id]
            old_prompt = reference["saved_prompt"]
            selection = reference["reference_selection"]
            prompt_path = Path(old_prompt["path"])
            if base.sha_file(prompt_path) != old_prompt["sha256"]:
                raise RuntimeError(f"{actor} saved prompt bytes changed")
            if base.sha_file(selection["prepared_audio_path"]) != selection["prepared_audio_sha256"]:
                raise RuntimeError(f"{actor} prepared source reference changed")
            cache = old_prompt["cache_inputs"]
            if not production_voice.prompt_model_binding_matches(cache, manifest):
                raise RuntimeError(f"{actor} prompt model/source binding changed")
            prompt = VoiceClonePrompt.load(str(prompt_path), map_location="cpu")
            tokens = saved.tensor_record(prompt.ref_audio_tokens)
            text_hash = hashlib.sha256(prompt.ref_text.encode()).hexdigest()
            if tokens != old_prompt["tokens"] or prompt.ref_rms != old_prompt["ref_rms"] or text_hash != cache["reference_text_sha256"]:
                raise RuntimeError(f"{actor} loaded prompt evidence changed")
            prompts[(actor, reference_id)] = {
                "reference": reference,
                "old_prompt": old_prompt,
                "selection": selection,
                "prompt_path": prompt_path,
                "prompt": prompt,
                "tokens": tokens,
                "text_hash": text_hash,
            }

        emit({
            "type": "READY",
            "status": "READY",
            "model_load_ms": round((time.perf_counter() - load_started) * 1000.0, 3),
            "sample_rate_hz": model.sampling_rate,
            "references": selected,
            "delivery_codes": {actor: sorted(codes) for actor, codes in episode_routes.items()},
            "delivery_sample_counts": {actor: {code: len(variants) for code, variants in codes.items()}
                                       for actor, codes in episode_routes.items()},
            "pid": os.getpid(),
        })

        last_reference = {}
        for raw in sys.stdin:
            raw = raw.strip()
            if not raw:
                continue
            request_id = "unknown"
            try:
                message = json.loads(raw)
                kind = message.get("type")
                if kind == "SHUTDOWN":
                    emit({"type": "SHUTDOWN_ACK", "status": "OK"})
                    break
                if kind == "PING":
                    emit({"type": "PONG", "id": message.get("id")})
                    continue
                if kind != "GENERATE":
                    raise ValueError("unsupported worker request type")

                request_id = str(message.get("id", ""))
                actor = str(message.get("actor", ""))
                text = message.get("text")
                relative_path = message.get("relative_path")
                if not re.fullmatch(r"[A-Za-z0-9._:-]{1,128}", request_id):
                    raise ValueError("invalid request id")
                if actor not in ("SHANNY", "REV"):
                    raise ValueError("invalid actor")
                if not isinstance(text, str) or not text.strip() or len(text) > 1000:
                    raise ValueError("invalid speech text")
                output = safe_output(output_root, relative_path)
                output.parent.mkdir(parents=True, exist_ok=True)
                if output.exists():
                    raise ValueError("refusing to overwrite worker output")

                mood = message.get("mood")
                if mood is not None and mood not in allowed_moods[actor]:
                    raise ValueError("invalid expression mood")
                voice_code = message.get('voice_code')
                if voice_code is not None:
                    if not isinstance(voice_code, str) or voice_code not in episode_routes.get(actor, {}):
                        raise ValueError('Episode delivery code is not approved for actor')
                    # The approved episode S06 category has distinct
                    # medium and full intensity source variants. Qwen's
                    # existing face-affect choice disambiguates them without
                    # adding another token field or pitch modification.
                    intensity = ('full' if mood == 'rage' else 'medium') if (
                        actor == 'SHANNY' and voice_code == 'S06') else None
                    reference_id, next_selection = select_reference(
                        episode_routes, actor, voice_code, request_id, args.seed,
                        last_reference.get(actor), intensity=intensity)
                else:
                    reference_id = mood_references.get(actor, {}).get(mood, selected[actor])
                    next_selection = None
                item = prompts[(actor, reference_id)]
                prompt = item["prompt"]
                prompt_path = item["prompt_path"]
                torch.manual_seed(args.seed)
                torch.cuda.manual_seed_all(args.seed)
                torch.cuda.reset_peak_memory_stats()
                started = time.perf_counter()
                with torch.inference_mode():
                    generated = model.generate(
                        text=text,
                        **dict(base.CALL, voice_clone_prompt=prompt),
                        generation_config=OmniVoiceGenerationConfig(**base.GENERATION),
                    )
                torch.cuda.synchronize()
                generation_ms = (time.perf_counter() - started) * 1000.0
                if not isinstance(generated, list) or len(generated) != 1:
                    raise RuntimeError("wrong native output count")

                conversion_report = {
                    "package_versions": package_versions,
                    "saved_prompt": item["old_prompt"],
                    "reference": {
                        "wav_sha256": item["selection"]["prepared_audio_sha256"],
                        "declared_text_sha256": item["text_hash"],
                    },
                }
                wav_bytes, audio = saved.convert(
                    generated[0],
                    model.sampling_rate,
                    torch,
                    torchaudio,
                    transport,
                    manifest,
                    conversion_report,
                    prompt_path,
                )
                if base.sha_file(prompt_path) != item["old_prompt"]["sha256"]:
                    raise RuntimeError("saved prompt changed during generation")
                if saved.tensor_record(prompt.ref_audio_tokens) != item["tokens"]:
                    raise RuntimeError("saved prompt tokens changed during generation")

                temporary = output.with_suffix(output.suffix + ".tmp")
                temporary.write_bytes(wav_bytes)
                os.replace(temporary, output)
                if next_selection is not None:
                    last_reference[actor] = next_selection
                emit({
                    "type": "RESULT",
                    "id": request_id,
                    "status": "SUCCEEDED",
                    "actor": actor,
                    "mood": mood,
                    "voice_code": voice_code,
                    "reference_id": reference_id,
                    "relative_path": relative_path,
                    "generation_ms": round(generation_ms, 3),
                    "sha256": hashlib.sha256(wav_bytes).hexdigest(),
                    "bytes": len(wav_bytes),
                    "audio": audio,
                    "pid": os.getpid(),
                })
            except BaseException as error:
                emit({
                    "type": "RESULT",
                    "id": request_id,
                    "status": "FAILED",
                    "error": {
                        "type": type(error).__name__,
                        "message": str(error),
                    },
                })
    finally:
        # Keep DLL directory handles alive for the process lifetime.
        _ = locals().get("dll_handles")


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BaseException as error:
        emit({
            "type": "FATAL",
            "status": "FAILED",
            "error": {
                "type": type(error).__name__,
                "message": str(error),
                "traceback": traceback.format_exc(),
            },
        })
        raise
