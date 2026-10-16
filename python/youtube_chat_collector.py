"""Read-only YouTube live text chat -> JSON Lines on stdout.

No OpenAI or Google API key required. Paid events are NOT emitted.
Install optional dependency: python -m pip install pytchat-ng
"""
import argparse
import json
import sys
import time


def emit(item):
    sys.stdout.write(json.dumps(item, ensure_ascii=False, separators=(',', ':')) + '\n')
    sys.stdout.flush()


def stamp_ms(value):
    try:
        value = float(value)
        if value <= 0:
            return 0
        return int(value if value > 1e11 else value * 1000)
    except (TypeError, ValueError, OverflowError):
        return 0


def watch(video_id):
    import pytchat  # optional, not required for fixture playback
    joined_ms = int(time.time() * 1000)
    retry = 1
    while True:
        chat = None
        connected_at = time.monotonic()
        saw_text = False
        try:
            chat = pytchat.create(video_id=video_id)
            while chat.is_alive():
                for message in chat.get().sync_items():
                    # Never turn a paid event into a plain chat reaction.
                    if message.type != 'textMessage':
                        continue
                    when = stamp_ms(getattr(message, 'timestamp', 0))
                    if not when or when < joined_ms - 10000:
                        continue
                    saw_text = True
                    author = getattr(message, 'author', None)
                    emit({
                        'source': 'youtube',
                        'type': 'textMessage',
                        'id': str(getattr(message, 'id', ''))[:160],
                        'text': str(getattr(message, 'message', ''))[:450],
                        'author': str(getattr(author, 'name', ''))[:60],
                        'published_ms': when,
                        'is_moderator': getattr(author, 'isChatModerator', False) is True,
                        'is_member': getattr(author, 'isChatSponsor', False) is True,
                    })
                time.sleep(0.4)
        except KeyboardInterrupt:
            return
        except Exception as error:
            print('Collector unavailable: ' + type(error).__name__, file=sys.stderr)
        finally:
            if chat is not None:
                try:
                    chat.terminate()
                except Exception:
                    pass
        # Collector never writes to YouTube, to local wallets or to Qwen.
        if saw_text or time.monotonic() - connected_at > 60:
            retry = 1
        else:
            retry = min(retry * 2, 30)
        try:
            time.sleep(retry)
        except KeyboardInterrupt:
            return


def main():
    p = argparse.ArgumentParser()
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument('--video-id')
    g.add_argument('--fixture')
    args = p.parse_args()
    if args.fixture:
        with open(args.fixture, encoding='utf-8') as rows:
            for line in rows:
                if line.strip():
                    emit(json.loads(line))
        return
    if len(args.video_id) != 11 or not all(x.isalnum() or x in '_-' for x in args.video_id):
        p.error('YouTube video ID must have 11 URL-safe characters')
    watch(args.video_id)


if __name__ == '__main__':
    main()
