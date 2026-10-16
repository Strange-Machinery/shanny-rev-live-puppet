"""No-network tests of the read-only YouTube collector."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location(
    'youtube_chat_collector', Path(__file__).with_name('youtube_chat_collector.py'))
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class CollectorTests(unittest.TestCase):
    def test_timestamp_milliseconds_seconds_invalid(self):
        self.assertEqual(collector.stamp_ms(1760000000123), 1760000000123)
        self.assertEqual(collector.stamp_ms(1760000000), 1760000000000)
        self.assertEqual(collector.stamp_ms('bad'), 0)

    def test_excludes_paid_and_old_items_and_closes_reader(self):
        now = 1760000000000
        author = types.SimpleNamespace(name='Viewer', isChatModerator=True,
                                       isChatSponsor=False)

        def item(ident, category, offset):
            return types.SimpleNamespace(id=ident, type=category,
                timestamp=now + offset, author=author, message='Rev, explain!')

        items = [item('old', 'textMessage', -20000),
                 item('paid', 'superChat', 1000),
                 item('sticker', 'superSticker', 1000),
                 item('member', 'newSponsor', 1000),
                 item('fresh', 'textMessage', 1000)]
        reader = types.SimpleNamespace(
            is_alive=lambda: True,
            get=lambda: types.SimpleNamespace(sync_items=lambda: items),
            terminate=mock.Mock())
        library = types.SimpleNamespace(create=mock.Mock(return_value=reader))
        out = io.StringIO()
        with mock.patch.dict(sys.modules, {'pytchat': library}), \
             mock.patch.object(collector.time, 'time', return_value=now / 1000), \
             mock.patch.object(collector.time, 'sleep', side_effect=KeyboardInterrupt), \
             contextlib.redirect_stdout(out):
            collector.watch('abcdefghijk')
        messages = [json.loads(row) for row in out.getvalue().splitlines()]
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]['id'], 'fresh')
        self.assertEqual(messages[0]['published_ms'], now + 1000)
        self.assertTrue(messages[0]['is_moderator'])
        self.assertEqual(messages[0]['type'], 'textMessage')
        reader.terminate.assert_called_once()

    def test_unicode_jsonl(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            collector.emit({'text': 'Shanny, ça va? 😅'})
        self.assertEqual(json.loads(out.getvalue())['text'], 'Shanny, ça va? 😅')
        self.assertEqual(out.getvalue().count('\n'), 1)


if __name__ == '__main__':
    unittest.main()
