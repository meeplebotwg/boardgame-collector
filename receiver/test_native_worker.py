"""Native helper safety at real subprocess seams, with synthetic executable transports."""
import json
import os
from pathlib import Path
import subprocess
import shutil
import struct
import sys
import tempfile
import time
import unittest

import enrollment_worker as w
import meeple_receiver as m
import test_enrollment as fixtures
import test_receiver


# Resolve before fixture setup prepends its fake executables to PATH.
REAL_FFMPEG = shutil.which('ffmpeg')


class NativeWorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.config = fixtures.EnrollmentTests.worker(self)
        self.work = {'version': 1, 'job': 'a' * 32, 'attempt': 'b' * 32,
                     'group_url': w.GROUP_URL, 'mode': 'direct_add', 'eligibility': 'google',
                     'allow_fallback': False, 'deadline': int(time.time()) + 100,
                     'item': {'id': '1' * 64, 'email': 'synthetic@example.org', 'status': 'received'},
                     'ui': w.ui_config(self.config)}
        self.path = self.root / 'request.json'
        self.save()
        w.save_json(self.root / 'active.json', {'attempt': self.work['attempt']})

    def save(self):
        self.path.write_text(json.dumps(self.work))

    def cli(self, *args):
        return subprocess.run([sys.executable, str(Path(w.__file__)), '--request', str(self.path), *args],
                              text=True, capture_output=True, timeout=20)

    def observe(self):
        ui = w.NativeUI(self.path)
        observation = {'membership': 'absent', 'invitation': 'absent',
                       'member_capture': ui.capture(), 'invite_capture': ui.capture()}
        ui.observe('before', observation)
        return ui

    @unittest.skipUnless(REAL_FFMPEG, 'real ffmpeg is required for capture integration')
    def test_capture_encodes_real_png_with_generated_output_options(self):
        assert REAL_FFMPEG is not None
        # Replace only the screen input with lavfi. The actual helper subprocess,
        # ffmpeg option parser, encoder, output file and provenance stay real.
        # No X server (especially the live browser display) is contacted.
        adapter = self.root / 'lavfi-ffmpeg'
        adapter.write_text('#!' + sys.executable + '\n' +
            'import os,sys\n' +
            'args = sys.argv[1:]\n' +
            'args[args.index("-f"):args.index("-i") + 2] = '
            '["-f", "lavfi", "-i", "color=c=black:size=16x16:rate=1"]\n' +
            'os.execv(' + repr(REAL_FFMPEG) + ', [' + repr(REAL_FFMPEG) + '] + args)\n')
        adapter.chmod(0o700)
        self.work['ui']['ffmpeg'] = str(adapter)
        self.save()
        result = self.cli('capture')
        self.assertEqual(result.returncode, 0, result.stderr)
        name = result.stdout.strip()
        image = self.root / name
        png = image.read_bytes()
        self.assertEqual(png[:8], b'\x89PNG\r\n\x1a\n')
        self.assertEqual(struct.unpack('>II', png[16:24]), (16, 16))
        decoded = subprocess.run([REAL_FFMPEG, '-v', 'error', '-i', str(image),
                                  '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
                                 capture_output=True, check=True, timeout=15)
        self.assertEqual(decoded.stdout, bytes(16 * 16 * 3))
        self.assertEqual(image.stat().st_mode & 0o777, 0o600)
        self.assertEqual(w.load_json(self.root / (name + '.json')),
                         {'attempt': self.work['attempt'], 'stage': 'before'})

    def commands(self):
        import ast
        return [ast.literal_eval(line)[3:] for line in (self.root / 'commands').read_text().splitlines()]

    def test_keys_hold_release_in_reverse_order_and_settle_focus(self):
        for key, names in [('Control-l', ['ctrl', 'l']), ('Home', ['home']),
                           ('Escape', ['esc']), ('Shift-Tab', ['shift', 'tab'])]:
            result = self.cli('key', key)
            self.assertEqual(result.returncode, 0, result.stderr)
            args = self.commands()[-1]
            expected = ['--delay', '0']
            for name in names: expected += ['keydown', name]
            expected += ['pause', '0.2']
            for name in reversed(names): expected += ['keyup', name]
            expected += ['pause', '0.5']
            self.assertEqual(args, expected)

    def test_fixed_navigation_and_email_use_paced_released_characters(self):
        for command, text in [('open-members', w.GROUP_URL), ('email', self.work['item']['email'])]:
            (self.root / 'commands').unlink(missing_ok=True)
            result = self.cli(command)
            self.assertEqual(result.returncode, 0, result.stderr)
            calls = self.commands()
            if command == 'open-members':
                self.assertIn('ctrl', calls[0])
                self.assertEqual(calls[0][-2:], ['pause', '0.5'])
                self.assertIn('enter', calls[-1])
                calls = calls[1:-1]
            typed = []
            for args in calls:
                self.assertEqual(args[:4], ['--delay', '0', 'pause', '0.5'])
                events = args[4:-2]
                self.assertLessEqual(len(events) // 8, 64)
                for i in range(0, len(events), 8):
                    down, char, pause, hold, up, released, gap, delay = events[i:i+8]
                    self.assertEqual((down, pause, hold, up, released, gap, delay),
                                     ('keydown', 'pause', '0.05', 'keyup', char, 'pause', '0.03'))
                    typed.append(char)
            self.assertEqual(''.join(typed), text)

    def test_escape_uses_real_vnc_keyname_and_no_arbitrary_text_or_url(self):
        self.assertEqual(self.cli('key', 'Escape').returncode, 0)
        self.assertIn("'esc'", (self.root / 'commands').read_text())
        previous = (self.root / 'commands').read_text()
        for args in [('type', 'injected'), ('open-members', 'https://evil.example.org'),
                     ('key', 'Return'), ('email', 'other@example.org'), ('click', '-1', '400')]:
            self.assertNotEqual(self.cli(*args).returncode, 0)
        self.assertEqual((self.root / 'commands').read_text(), previous)

    def test_submission_requires_both_absent_correct_checkbox_and_eligibility(self):
        ui = self.observe()
        commands = (self.root / 'commands').read_text()
        for mode, eligibility, direct, fallback in [
            ('reconcile', 'google', 'yes', 'no'), ('direct_add', 'non_google', 'yes', 'no'),
            ('direct_add', 'unknown', 'yes', 'no'), ('direct_add', 'google', 'no', 'no'),
            ('direct_add', 'google', 'yes', 'yes'), ('invite', 'non_google', 'yes', 'no')]:
            self.work.update(mode=mode, eligibility=eligibility); self.save()
            with self.assertRaises(ValueError):
                w.NativeUI(self.path).submit(5, 5, direct, fallback)
        self.assertEqual((self.root / 'commands').read_text(), commands)
        self.work.update(mode='invite', eligibility='non_google'); self.save()
        ui = w.NativeUI(self.path)
        ui.submit(5, 5, 'no', 'no')
        commands = (self.root / 'commands').read_text()
        with self.assertRaises(FileExistsError):
            ui.submit(5, 5, 'no', 'no')
        self.assertEqual((self.root / 'commands').read_text(), commands)

    def test_pending_invitation_and_member_precheck_prohibit_submit(self):
        ui = self.observe()
        path = self.root / 'before.json'
        before = w.load_json(path)
        commands = (self.root / 'commands').read_text()
        for member, invitation in [('present', 'absent'), ('absent', 'present'), ('unknown', 'absent'), ('absent', 'unknown')]:
            path.write_text(json.dumps(dict(before, membership=member, invitation=invitation)))
            with self.assertRaises(ValueError):
                ui.submit(5, 5, 'yes', 'no')
        self.assertEqual((self.root / 'commands').read_text(), commands)

    def test_expired_finished_or_inactive_attempt_cannot_touch_ui(self):
        self.work['deadline'] = int(time.time()) - 1; self.save()
        self.assertNotEqual(self.cli('open-members').returncode, 0)
        self.work['deadline'] = int(time.time()) + 100; self.save()
        self.assertEqual(self.cli('finish', '--stop', 'login').returncode, 0)
        self.assertNotEqual(self.cli('open-members').returncode, 0)
        (self.root / 'response.json').unlink(); (self.root / 'active.json').unlink()
        self.assertNotEqual(self.cli('open-members').returncode, 0)
        self.assertFalse((self.root / 'commands').exists())

    def test_config_rejects_nonlocal_remote_and_unknown_fields(self):
        original = w.load_json(self.config)
        for changes in ({'display': 'remote:0'}, {'vnc_server': '192.0.2.1::5900'}, {'width': True}, {'url': 'anything'}, {'vncdo': 'relative'}):
            self.config.write_text(json.dumps(dict(original, **changes)))
            with self.assertRaises(ValueError): w.ui_config(self.config)

    def test_shared_native_lock_serializes_distinct_stores_and_cli_set(self):
        a, b = m.Store(self.root / 'a'), m.Store(self.root / 'b')
        job_a = a.intake(test_receiver.OWNER, test_receiver.batch())[0]
        job_b = b.intake(test_receiver.OWNER, test_receiver.batch())[0]
        evidence = self.root / 'manual.txt'; evidence.write_text('Synthetic operator only')
        calls = []
        def running(args, **kwargs):
            calls.append(args)
            for store, job in [(a, job_a), (b, job_b)]:
                with self.assertRaises(BlockingIOError):
                    m.run_job(store, job, True, mode='reconcile', ui_config=self.config)
            result = subprocess.run([sys.executable, str(Path(m.__file__)), '--data', str(a.root), 'set',
                                     job_a, '1' * 64, 'added', '--evidence-file', str(evidence)], capture_output=True)
            self.assertNotEqual(result.returncode, 0, 'manual set must not race a live worker')
            return subprocess.CompletedProcess(args, 0)
        self.assertEqual(m.run_job(a, job_a, True, mode='reconcile', ui_config=self.config, runner=running), 'needs_verification')
        self.assertEqual(len(calls), 1)
        self.assertEqual(a.read(job_a)['items'][0]['status'], 'needs_verification')
        self.assertEqual(b.read(job_b)['items'][0]['status'], 'received')

    def test_retained_ui_object_cannot_act_after_token_revocation(self):
        ui = w.NativeUI(self.path)
        (self.root / 'active.json').unlink()
        for action in (lambda: ui.click(5, 5), ui.capture):
            with self.assertRaises((OSError, ValueError)):
                action()
        self.assertFalse((self.root / 'commands').exists())

    def test_uncertain_containment_blocks_new_store_before_agent_launch(self):
        store = m.Store(self.root / 'other-store')
        job = store.intake(test_receiver.OWNER, test_receiver.batch())[0]
        (self.root / 'native.lock.containment').write_text('unproven cleanup')
        def forbidden(*args, **kwargs):
            self.fail('must not launch while prior cleanup is uncertain')
        self.assertEqual(m.run_job(store, job, True, mode='reconcile',
                                  ui_config=self.config, runner=forbidden), 'needs_verification')
        self.assertEqual(store.read(job)['items'][0]['status'], 'received')

    def test_supervisor_death_quarantines_display_and_revokes_attempt(self):
        import ctypes
        import signal
        libc = ctypes.CDLL(None)
        previous = ctypes.c_int()
        self.assertEqual(libc.prctl(37, ctypes.byref(previous), 0, 0, 0), 0)
        self.assertEqual(libc.prctl(36, 1, 0, 0, 0), 0)
        store = m.Store(self.root / 'death-store')
        job = store.intake(test_receiver.OWNER, test_receiver.batch())[0]
        pidfile = self.root / 'survivor.pid'
        script = ('import os,signal,time,pathlib; '
                  f'pathlib.Path({str(pidfile)!r}).write_text(str(os.getpid())); '
                  'os.kill(os.getppid(),signal.SIGKILL); time.sleep(30)')
        def killed(args, **kwargs):
            return w.invoke([sys.executable, '-c', script], **kwargs)
        try:
            self.assertEqual(m.run_job(store, job, True, mode='reconcile',
                                      ui_config=self.config, runner=killed), 'needs_verification')
            self.assertEqual(store.read(job)['items'][0]['status'], 'needs_verification')
            self.assertTrue((self.root / 'native.lock.containment').exists())
            request, = (store.root / 'jobs' / job).glob('*/request.json')
            self.assertFalse(request.with_name('active.json').exists())
            with self.assertRaises((OSError, ValueError)):
                w.NativeUI(request)
            def forbidden(*args, **kwargs):
                self.fail('supervisor death must not authorize another worker')
            self.assertEqual(m.run_job(store, job, True, mode='reconcile',
                                      ui_config=self.config, runner=forbidden), 'needs_verification')
        finally:
            if pidfile.exists():
                pid = int(pidfile.read_text())
                try: os.kill(pid, signal.SIGKILL)
                except ProcessLookupError: pass
                os.waitpid(pid, 0)
            libc.prctl(36, previous.value, 0, 0, 0)


if __name__ == '__main__':
    unittest.main()
