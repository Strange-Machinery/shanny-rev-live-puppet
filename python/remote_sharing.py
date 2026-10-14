"""Producer-only sharing lifecycle. Starts HTTPS only after the owner's button press."""
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import threading
import time
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler
from urllib.parse import urlparse
import webbrowser

FLAGS = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('The private HTTPS address redirected unexpectedly.')


class RemoteSharing:
    def __init__(self, engine, event):
        self.engine = engine; self.event = event
        self.bridge = None; self.tunnel = None; self.revision = 0
        self.folder = engine.repo / 'work/For Buff'
        self.link = None

    def start(self):
        self.close(); self.revision += 1
        captured = self.revision
        threading.Thread(target=self._start, args=(captured,), daemon=True).start()

    def _start(self, captured):
        bridge = tunnel = None
        try:
            tailscale = shutil.which('tailscale.exe') or str(Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Tailscale/tailscale.exe')
            def command(*args):
                return subprocess.check_output([tailscale, *args], text=True, timeout=15, creationflags=FLAGS)
            status = json.loads(command('status', '--json'))
            if status.get('BackendState') != 'Running':
                raise RuntimeError('The producer connection needs Tailscale signed in on this computer.')
            domain = status.get('Self', {}).get('DNSName', '').rstrip('.')
            if not domain.endswith('.ts.net') or '/' in domain or ':' in domain:
                raise RuntimeError('This computer does not have a verified Tailscale HTTPS name.')
            existing = json.loads(command('serve', 'status', '--json') or '{}')
            if existing:
                raise RuntimeError('This computer already shares another service. Producer connection setup needs review before changing it.')
            if captured != self.revision:
                return
            self.folder.mkdir(parents=True, exist_ok=True)
            key_file = self.engine.repo / 'work/sharing-key.local.json'
            if key_file.exists():
                key = json.loads(key_file.read_text(encoding='utf-8'))['key']
            else:
                key = secrets.token_hex(32)
                key_file.write_text(json.dumps({'key': key}), encoding='utf-8')
            if not isinstance(key, str) or len(key) != 64 or any(c not in '0123456789abcdef' for c in key):
                raise RuntimeError('The private launcher key needs repair.')
            origin = 'https://' + domain
            config = self.engine.repo / 'work/sharing.local.json'
            config.write_text(json.dumps({'endpoint': self.engine.endpoint, 'upstreamToken': self.engine.token,
                                         'publicOrigin': origin, 'token': key,
                                         'scratch': str(self.engine.repo / 'work/remote-audio')}), encoding='utf-8')
            node = self.engine.node or shutil.which('node.exe') or shutil.which('node')
            bridge = subprocess.Popen([node, str(self.engine.repo / 'src/remote-panel.mjs'), str(config)],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                      text=True, creationflags=FLAGS)
            self.bridge = bridge
            watchdog = threading.Timer(20, bridge.kill); watchdog.daemon = True; watchdog.start()
            try:
                def drain_bridge():
                    for _ in bridge.stderr:
                        pass
                threading.Thread(target=drain_bridge, daemon=True).start()
                line = bridge.stdout.readline()
                if not line:
                    raise RuntimeError('The producer connection could not start. Restart testing and try again.')
                port = json.loads(line)['port']
            finally:
                watchdog.cancel()
            if captured != self.revision:
                return
            # Foreground child owns this sharing session; no persistent background config.
            tunnel = subprocess.Popen([tailscale, 'funnel', '--https=443', 'http://127.0.0.1:' + str(port)],
                                      stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                      text=True, creationflags=FLAGS)
            self.tunnel = tunnel
            def read_tunnel():
                opened = False
                for line in tunnel.stdout:
                    # First-time Tailscale authorization is an owner browser action.
                    for word in line.split():
                        parsed = urlparse(word)
                        if not opened and parsed.scheme == 'https' and parsed.hostname == 'login.tailscale.com' and captured == self.revision:
                            opened = True
                            self.event('Authorize sharing in the Tailscale page that opened, then return here.')
                            webbrowser.open(word)
            threading.Thread(target=read_tunnel, daemon=True).start()
            self.event('Opening the private HTTPS connection…')
            opener = build_opener(ProxyHandler({}), NoRedirect())
            verified = False
            for _ in range(90):
                if captured != self.revision:
                    return
                if tunnel.poll() is not None:
                    raise RuntimeError('HTTPS sharing did not start. Check the Tailscale authorization page, then try again.')
                try:
                    request = Request(origin + '/api/status', headers={'Authorization': 'Bearer ' + key})
                    with opener.open(request, timeout=3) as response:
                        data = json.load(response)
                        verified = data.get('kind') == 'REMOTE_TESTING'
                    if verified:
                        break
                except Exception:
                    pass
                time.sleep(1)
            if not verified:
                raise RuntimeError('The HTTPS connection did not pass its check. Finish Tailscale authorization, then retry.')
            if captured != self.revision:
                return
            self.link = origin + '/#key=' + key
            launcher = self.folder / 'Buff Launcher.url'
            launcher.write_text('[InternetShortcut]\nURL=' + self.link + '\n', encoding='utf-8')
            self.event('Sharing is ready. Click Open Buff launcher folder and send him Buff Launcher.url. Keep this app open.')
            # Detect a lost local tunnel rather than leaving a false ready indicator.
            while captured == self.revision and tunnel.poll() is None and bridge.poll() is None:
                time.sleep(1)
            if captured == self.revision:
                self.event('Sharing stopped. Click Share testing with Buff to reconnect.')
        except Exception as error:
            if captured == self.revision:
                self.event(str(error))
        finally:
            if tunnel and tunnel.poll() is None:
                tunnel.terminate()
            if bridge and bridge.poll() is None:
                try:
                    bridge.stdin.close(); bridge.wait(timeout=5)
                except Exception:
                    bridge.kill()
            if self.bridge is bridge:
                self.bridge = None
            if self.tunnel is tunnel:
                self.tunnel = None

    def close(self):
        self.revision += 1; self.link = None
        self.event('Sharing is off. Buff cannot reach this testing session.')
        if self.tunnel and self.tunnel.poll() is None:
            self.tunnel.terminate()
        if self.bridge and self.bridge.poll() is None:
            try:
                self.bridge.stdin.close()
            except OSError:
                pass

    def open_folder(self):
        if self.folder.is_dir():
            os.startfile(str(self.folder))
