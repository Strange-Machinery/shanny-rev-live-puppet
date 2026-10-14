"""Offline CPU-only faster-whisper; explicit local model, never download."""
import argparse, json, os, wave
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--audio', required=True)
    args = parser.parse_args()
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    model = Path(args.model).resolve(strict=True)
    audio = Path(args.audio).resolve(strict=True)
    if not model.is_dir() or not (model / 'model.bin').is_file():
        raise ValueError('Select an existing CTranslate2 Whisper model directory')
    if audio.stat().st_size > 3_000_000:
        raise ValueError('Test WAV exceeds 3 MB')
    with wave.open(str(audio), 'rb') as handle:
        if handle.getnchannels() != 1 or handle.getsampwidth() != 2 or handle.getframerate() not in (16000, 48000):
            raise ValueError('Use PCM16 mono WAV at 16 or 48 kHz')
        duration = handle.getnframes() / handle.getframerate()
        if not 0 < duration <= 30:
            raise ValueError('Test one final utterance of at most 30 seconds')
    from faster_whisper import WhisperModel
    engine = WhisperModel(str(model), device='cpu', compute_type='int8', local_files_only=True, cpu_threads=4)
    segments, _ = engine.transcribe(str(audio), language='en', beam_size=1, vad_filter=True)
    segments = list(segments)
    text = ' '.join(segment.text.strip() for segment in segments).strip()
    if len(text) > 1000:
        raise ValueError('Transcript exceeds test budget')
    print(json.dumps(dict(text=text, final=True, source='OFFLINE_WAV',
                         vad_start_ms=round(segments[0].start * 1000) if segments else None,
                         vad_end_ms=round(segments[-1].end * 1000) if segments else None)))

if __name__ == '__main__':
    main()
