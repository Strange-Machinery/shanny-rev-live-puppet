"""Offline CPU-only faster-whisper; explicit local model, never download."""
import argparse, json, os, sys, wave
from pathlib import Path

def transcribe(engine, audio_path):
    audio = Path(audio_path).resolve(strict=True)
    if audio.stat().st_size > 3_000_000:
        raise ValueError('Test WAV exceeds 3 MB')
    with wave.open(str(audio), 'rb') as handle:
        if handle.getnchannels() != 1 or handle.getsampwidth() != 2 or handle.getframerate() not in (16000, 48000):
            raise ValueError('Use PCM16 mono WAV at 16 or 48 kHz')
        duration = handle.getnframes() / handle.getframerate()
        if not 0 < duration <= 30:
            raise ValueError('Test one final utterance of at most 30 seconds')
    segments, _ = engine.transcribe(str(audio), language='en', beam_size=1, vad_filter=True)
    segments = list(segments)
    text = ' '.join(segment.text.strip() for segment in segments).strip()
    if len(text) > 1000:
        raise ValueError('Transcript exceeds test budget')
    return dict(text=text, final=True, source='OFFLINE_WAV',
                         vad_start_ms=round(segments[0].start * 1000) if segments else None,
                         vad_end_ms=round(segments[-1].end * 1000) if segments else None)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--audio')
    parser.add_argument('--serve', action='store_true')
    args = parser.parse_args()
    if not args.serve and not args.audio:
        parser.error('--audio or --serve is required')
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    model = Path(args.model).resolve(strict=True)
    if not model.is_dir() or not (model / 'model.bin').is_file():
        raise ValueError('Select an existing CTranslate2 Whisper model directory')
    from faster_whisper import WhisperModel
    engine = WhisperModel(str(model), device='cpu', compute_type='int8', local_files_only=True, cpu_threads=4)
    if not args.serve:
        print(json.dumps(transcribe(engine, args.audio)))
        return
    def emit(value):
        print('LIVE_WHISPER ' + json.dumps(value), flush=True)
    emit(dict(type='READY'))
    while True:
        raw = sys.stdin.buffer.readline(8193)
        if not raw:
            break
        if len(raw) > 8192:
            raise ValueError('Worker input exceeds limit')
        request = json.loads(raw)
        if request.get('type') == 'SHUTDOWN':
            break
        try:
            if request.get('type') != 'TRANSCRIBE':
                raise ValueError('Unknown request')
            emit(dict(type='RESULT', id=request['id'], result=transcribe(engine, request['audioPath'])))
        except Exception:
            emit(dict(type='RESULT', id=request.get('id'), error='Local Whisper failed; check the test WAV'))

if __name__ == '__main__':
    main()
