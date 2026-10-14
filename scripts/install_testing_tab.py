"""Add only the Testing UI hook to the inspected Studio launcher. Reversible."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import shutil

def install(app_dir, repo):
    app_dir = Path(app_dir).resolve(strict=True)
    repo = Path(repo).resolve(strict=True)
    demo = app_dir / 'demo.py'
    source = demo.read_text(encoding='utf-8')
    anchor = '        install(self,main)\n'
    hook = '        from live_testing_tab import install_testing\n        install_testing(self,main)\n'
    if anchor not in source:
        raise ValueError('Launcher layout differs from the inspected Studio; no files changed')
    if hook not in source:
        backup = app_dir / ('demo.testing-backup-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.py')
        shutil.copy2(demo, backup)
        source = source.replace(anchor, anchor + hook, 1)
        compile(source, str(demo), 'exec')
        demo.write_text(source, encoding='utf-8')
    loader = (
        '"""Additive offline Testing tab; implementation stays in standalone repository."""\n'
        'import importlib.util, sys\nfrom pathlib import Path\n'
        'REPO = Path(' + repr(str(repo)) + ')\n'
        'def install_testing(app, main):\n'
        '    sys.path.insert(0, str(REPO / "python"))\n'
        '    spec = importlib.util.spec_from_file_location("shanny_offline_testing", REPO / "python/testing_tab.py")\n'
        '    module = importlib.util.module_from_spec(spec)\n'
        '    spec.loader.exec_module(module)\n'
        '    return module.install_testing(app, main, repo=REPO)\n'
    )
    (app_dir / 'live_testing_tab.py').write_text(loader, encoding='utf-8')
    return dict(status='installed', launcher=str(demo), repo=str(repo), episode_pipeline_changed=False)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--app', required=True)
    parser.add_argument('--repo', default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args()
    print(json.dumps(install(args.app, args.repo)))
