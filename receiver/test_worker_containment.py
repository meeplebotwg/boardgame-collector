"""Real setsid/no-pass_fds topology; synthetic delayed UI, no live services."""
import ctypes
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

import enrollment_worker as w


class ContainmentTests(unittest.TestCase):
    def setUp(self):
        libc = ctypes.CDLL(None)
        previous = ctypes.c_int()
        self.assertEqual(libc.prctl(37, ctypes.byref(previous), 0, 0, 0), 0)
        self.assertEqual(libc.prctl(36, 1, 0, 0, 0), 0)
        self.addCleanup(lambda: libc.prctl(36, previous.value, 0, 0, 0))

    def test_detached_helpers_die_before_both_locks_change_owner(self):
        # Reap escaped children even during RED; this process launches no other work.
        for mode in ('timeout', 'normal', 'abnormal', 'interrupt', 'terminate', 'launcher_death'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                (root / 'active.json').write_text('{"attempt":"synthetic"}')
                grandchild = (
                    'import os,time,pathlib; '
                    f'p=pathlib.Path({tmp!r}); '
                    '(p/"grandchild.pid").write_text(str(os.getpid())); '
                    'time.sleep(1.5); (p/"stale-ui").touch(); time.sleep(30)')
                helper = (
                    'import os,time,pathlib,subprocess,sys; '
                    f'p=pathlib.Path({tmp!r}); '
                    f'subprocess.Popen([sys.executable,"-c",{grandchild!r}],start_new_session=True); '
                    'time.sleep(.1); '
                    '(p/"helper.pid").write_text(str(os.getpid())); '
                    'time.sleep(1.5); (p/"stale-ui").touch(); time.sleep(30)')
                agent = (
                    'import os,subprocess,sys,time,pathlib; '
                    f'p=pathlib.Path({tmp!r}); '
                    '(p/"agent.pid").write_text(str(os.getpid())); '
                    f'subprocess.Popen([sys.executable,"-c",{helper!r}],start_new_session=True); '
                    'time.sleep(.2); ' +
                    ('sys.exit(0)' if mode == 'normal' else 'sys.exit(7)' if mode == 'abnormal' else 'time.sleep(30)'))
                launcher_code = (
                    'import sys,subprocess; import enrollment_worker as w\n'
                    f'with w.locked({str(root / "store.lock")!r}) as a, w.locked({str(root / "native.lock")!r}) as b:\n'
                    ' try:\n'
                    f'  w.invoke([sys.executable,"-c",{agent!r}], input="",text=True,pass_fds=(a.fileno(),b.fileno()),timeout=.6,cwd={tmp!r},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)\n'
                    ' except subprocess.TimeoutExpired: pass\n')
                launcher = subprocess.Popen([sys.executable, '-c', launcher_code],
                    env=dict(os.environ, PYTHONPATH=str(Path(w.__file__).parent)),
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                pids = []
                verified = False
                try:
                    deadline = time.monotonic() + 5
                    while not all((root / name).exists() for name in ('agent.pid', 'helper.pid', 'grandchild.pid')):
                        self.assertLess(time.monotonic(), deadline, 'helper did not start')
                        time.sleep(.01)
                    pids = [int((root / name).read_text()) for name in ('agent.pid', 'helper.pid', 'grandchild.pid')]
                    if mode in ('interrupt', 'terminate', 'launcher_death'):
                        launcher.send_signal({'interrupt': signal.SIGINT, 'terminate': signal.SIGTERM,
                                              'launcher_death': signal.SIGKILL}[mode])
                    launcher.wait(timeout=5)
                    deadline = time.monotonic() + 5
                    while True:
                        try:
                            with w.locked(root / 'store.lock'), w.locked(root / 'native.lock'):
                                self.assertFalse((root / 'active.json').exists(), 'token must be revoked before ownership changes')
                                self.assertFalse((root / '.containment').exists())
                                self.assertTrue(all(not Path(f'/proc/{pid}').exists() for pid in pids),
                                                'root/detached helper alive or unreaped at ownership change')
                                time.sleep(1.6)
                                self.assertFalse((root / 'stale-ui').exists())
                            verified = True
                            break
                        except BlockingIOError:
                            self.assertLess(time.monotonic(), deadline, 'cleanup did not release locks')
                            time.sleep(.01)
                finally:
                    if launcher.poll() is None:
                        launcher.kill(); launcher.wait()
                    pids = [] if verified else [int(path.read_text()) for path in root.glob('*.pid') if path.read_text()]
                    for pid in pids:
                        try: os.kill(pid, signal.SIGKILL)
                        except ProcessLookupError: pass
                    deadline = time.monotonic() + 2
                    while time.monotonic() < deadline:
                        try:
                            pid, _ = os.waitpid(-1, os.WNOHANG)
                        except ChildProcessError:
                            break
                        if not pid: time.sleep(.01)


if __name__ == '__main__':
    unittest.main()
