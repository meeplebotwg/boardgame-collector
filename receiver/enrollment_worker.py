"""Bounded, operator-gated native Groups helper. No Google API or login automation."""
import argparse
from contextlib import contextmanager
import fcntl
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import uuid

from meeple_receiver import JOB, RECORD, canonical, private_output

GROUP_URL = 'https://groups.google.com/g/boardgamenightwg/members'
MODES = {'direct_add', 'invite', 'reconcile'}
ELIGIBILITY = {'google', 'non_google', 'unknown'}
STOPS = {'none', 'login', 'captcha', 'permission', 'throttle', 'ambiguous', 'invitation_fallback', 'ineligible'}
STATES = {'present', 'absent', 'unknown'}
# Intentionally narrower than intake: a single ASCII mailbox, not a display name,
# recipient list, command or Unicode lookalike. Unsupported addresses need review.
MAILBOX = re.compile(r'[a-z0-9][a-z0-9._+\-]*@[a-z0-9](?:[a-z0-9.\-]*[a-z0-9])?\.[a-z]{2,63}')


def load_json(path):
    def unique(pairs):
        result = {}
        for k, v in pairs:
            if k in result:
                raise ValueError('Duplicate key')
            result[k] = v
        return result
    with Path(path).open() as f:
        text = f.read(32769)
    if len(text) > 32768:
        raise ValueError('Oversized worker document')
    return json.loads(text, object_pairs_hook=unique)


def save_json(path, value):
    with private_output(path) as f:
        f.write(canonical(value))


def ui_config(path):
    conf = load_json(path)
    if set(conf) != {'display', 'xauthority', 'vnc_server', 'vncdo', 'ffmpeg', 'width', 'height', 'lock'}:
        raise ValueError('Invalid native UI configuration')
    if not isinstance(conf['display'], str) or not re.fullmatch(r':\d{1,4}', conf['display']):
        raise ValueError('Local dedicated display required')
    if not isinstance(conf['vnc_server'], str) or not re.fullmatch(r'127\.0\.0\.1::[1-9]\d{3,4}', conf['vnc_server']):
        raise ValueError('Loopback VNC required')
    for key in ('xauthority', 'vncdo', 'ffmpeg', 'lock'):
        if not isinstance(conf[key], str) or not Path(conf[key]).is_absolute():
            raise ValueError('Absolute operator-owned UI paths required')
    if any(type(conf[k]) is not int or not 320 <= conf[k] <= 4096 for k in ('width', 'height')):
        raise ValueError('Invalid dedicated screen dimensions')
    return conf


@contextmanager
def locked(path):
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'a') as f:
        os.fchmod(f.fileno(), 0o600)
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield f


def invoke(args, **kwargs):
    """Kill the whole tool process group on timeout; never leave a UI child running."""
    timeout = kwargs.pop('timeout')
    kwargs.pop('check', None)
    prompt = kwargs.pop('input')
    with subprocess.Popen(args, stdin=subprocess.PIPE, start_new_session=True, **kwargs) as child:
        try:
            child.communicate(prompt, timeout=timeout)
        except BaseException:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
            raise
        # Any leftover agent-spawned helpers must not outlive the run either.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        return subprocess.CompletedProcess(args, child.returncode)


def prompt_for(path):
    helper = Path(__file__).resolve()
    return canonical({'request': str(path), 'helper': str(helper)}) + '\n' + (helper.parent / 'enrollment-instructions.md').read_text()


def perform(store, job, item, mode, eligibility, config, store_lock, runner=None, allow_fallback=False):
    conf = ui_config(config)
    with locked(conf['lock']) as native_lock:
        attempt = uuid.uuid4().hex
        directory = store.root / 'jobs' / job / attempt
        directory.mkdir(mode=0o700, parents=True)
        # mkdir(parents=True) does not apply mode to intermediate parents.
        os.chmod(directory.parent, 0o700); os.chmod(directory.parent.parent, 0o700)
        work = {'version': 1, 'job': job, 'attempt': attempt, 'group_url': GROUP_URL,
                'mode': mode, 'eligibility': eligibility, 'allow_fallback': allow_fallback,
                'deadline': int(time.time()) + 600, 'ui': conf,
                'item': {'id': item['id'], 'email': item['record']['email'].strip().lower(), 'status': item['status']}}
        path = directory / 'request.json'
        save_json(path, work)
        save_json(directory / 'active.json', {'attempt': attempt})
        store.set_outcome(job, item['id'], 'needs_verification', canonical({
            'worker': 1, 'attempt': attempt, 'meaning': 'attempt_started_reconcile_before_retry'}))
        try:
            with private_output(directory / 'worker.log') as log:
                result = (runner or invoke)(
                    ['hermes', '--profile', 'meeple', 'chat', '--query-file', '-', '--max-turns', '40',
                     '--run-budget', '600', '--ignore-rules', '--toolsets', 'terminal,vision', '--quiet'],
                    input=prompt_for(path), text=True, pass_fds=(store_lock.fileno(), native_lock.fileno()),
                    cwd=directory, timeout=660, check=False, stdout=log, stderr=subprocess.STDOUT)
            if result.returncode:
                return 'needs_verification'
            response = load_json(directory / 'response.json')
            status, meaning = interpret(work, response, directory)
            store.set_outcome(job, item['id'], status, canonical({
                'worker': 1, 'attempt': attempt, 'meaning': meaning, 'mode': mode,
                'eligibility': eligibility, 'observation': 'native_ui_agent_attested',
                'stop': response['stop']}))
            return 'processed' if meaning != 'unverified_result' else 'needs_verification'
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError, TimeoutError):
            return 'needs_verification'
        finally:
            (directory / 'active.json').unlink(missing_ok=True)


def capture_ok(directory, name):
    if not isinstance(name, str) or not re.fullmatch(r'capture-[a-f0-9]{32}\.png', name):
        raise ValueError('Invalid screenshot reference')
    path = directory / name
    if path.is_symlink():
        raise ValueError('Screenshot must belong to this attempt')
    with path.open('rb') as f:
        if f.read(8) != b'\x89PNG\r\n\x1a\n':
            raise ValueError('Missing screenshot')


def observation_ok(directory, value):
    if not isinstance(value, dict) or set(value) != {'membership', 'invitation', 'member_capture', 'invite_capture'}:
        raise ValueError('Incomplete observation')
    if value['membership'] not in STATES or value['invitation'] not in STATES:
        raise ValueError('Unknown observation')
    for key in ('member_capture', 'invite_capture'):
        capture_ok(directory, value[key])
    if value['member_capture'] == value['invite_capture']:
        raise ValueError('Separate member and invitation observations required')


def interpret(work, result, directory):
    if not isinstance(result, dict) or set(result) != {'version', 'job', 'attempt', 'item_id', 'group_url', 'mode', 'before', 'after', 'action', 'stop'}:
        raise ValueError('Invalid worker response')
    for key in ('version', 'job', 'attempt', 'group_url', 'mode'):
        if type(result[key]) is not type(work[key]) or result[key] != work[key]:
            raise ValueError('Foreign worker response')
    if result['item_id'] != work['item']['id'] or result['stop'] not in STOPS:
        raise ValueError('Foreign item/stop')
    before, after, action, stop = (result[k] for k in ('before', 'after', 'action', 'stop'))
    for stage, observation in (('before', before), ('after', after)):
        journal = directory / (stage + '.json')
        if observation is not None:
            observation_ok(directory, observation)
            if load_json(journal) != observation:
                raise ValueError('Response disagrees with observation journal')
            for key in ('member_capture', 'invite_capture'):
                metadata = load_json(directory / (observation[key] + '.json'))
                if metadata != {'attempt': work['attempt'], 'stage': stage}:
                    raise ValueError('Screenshot is not from this observation phase')
        elif journal.exists():
            raise ValueError('Unreported observation')
    submitted = directory / 'submitted.json'
    if action not in {'none', 'direct_add', 'invite'}:
        raise ValueError('Invalid action')
    if action != 'none':
        if action != work['mode'] or not submitted.exists() or load_json(submitted)['action'] != action:
            raise ValueError('Submission not authorized')
        if action == 'direct_add' and work['eligibility'] != 'google':
            raise ValueError('Non-Google or unknown account cannot be directly added')
        if before is None or before['membership'] != 'absent' or before['invitation'] != 'absent':
            raise ValueError('Submission without absence checks')
        if after and set(after[k] for k in ('member_capture', 'invite_capture')) & set(before[k] for k in ('member_capture', 'invite_capture')):
            raise ValueError('Reused pre-submission observation')
    elif submitted.exists() or after is not None:
        raise ValueError('Unreported submission or unsolicited after observation')
    if stop != 'none':
        if action != 'none' or work['item']['status'] in {'needs_verification', 'added', 'already_member', 'invitation_required'}:
            return 'needs_verification', 'unverified_result'
        if stop in {'invitation_fallback', 'ineligible'}:
            return 'invitation_required', 'invitation_not_sent'
        return ('needs_verification' if stop == 'ambiguous' else 'blocked'), 'stopped_' + stop
    seen = after if action != 'none' else before
    if seen is None:
        return 'needs_verification', 'unverified_result'
    if seen['membership'] == 'present' and seen['invitation'] == 'absent':
        # Invitation is NEVER an Added outcome, even if membership appears later.
        return ('added', 'membership_verified_after_direct_add') if action == 'direct_add' else ('already_member', 'membership_verified')
    if seen['membership'] == 'absent' and seen['invitation'] == 'present':
        return 'invitation_required', 'invitation_pending_verified'
    if action == 'none' and before['membership'] == before['invitation'] == 'absent':
        if work['item']['status'] in {'needs_verification', 'added', 'already_member', 'invitation_required'}:
            return 'needs_verification', 'reconciled_absent_review_required'
        return 'blocked', 'verified_absent_no_action'
    return 'needs_verification', 'unverified_result'


class NativeUI:
    def __init__(self, request):
        self.path = Path(request).resolve()
        self.directory = self.path.parent
        self.work = load_json(self.path)
        if (self.work['version'] != 1 or not JOB.fullmatch(self.work['job']) or
                not JOB.fullmatch(self.work['attempt']) or not RECORD.fullmatch(self.work['item']['id']) or
                self.work['group_url'] != GROUP_URL or self.work['mode'] not in MODES or
                self.work['eligibility'] not in ELIGIBILITY or not MAILBOX.fullmatch(self.work['item']['email'])):
            raise ValueError('Invalid scope')
        if (load_json(self.directory / 'active.json')['attempt'] != self.work['attempt'] or
                time.time() > self.work['deadline'] or (self.directory / 'response.json').exists()):
            raise ValueError('Attempt is not active')
        self.conf = self.work['ui']
        self.env = dict(os.environ, DISPLAY=self.conf['display'], XAUTHORITY=self.conf['xauthority'])

    def vnc(self, *args):
        subprocess.run([self.conf['vncdo'], '-s', self.conf['vnc_server'], *args],
                       env=self.env, timeout=15, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def capture(self):
        name = 'capture-' + uuid.uuid4().hex + '.png'
        path = self.directory / name
        # Reserve a private regular output file; ffmpeg overwrites only this file.
        with private_output(path):
            pass
        subprocess.run([self.conf['ffmpeg'], '-nostdin', '-loglevel', 'error', '-y', '-f', 'x11grab',
                        '-video_size', f"{self.conf['width']}x{self.conf['height']}", '-i', self.conf['display'],
                        '-frames:v1', '1', '-update', '1', str(path)],
                       env=self.env, timeout=15, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        capture_ok(self.directory, name)
        save_json(self.directory / (name + '.json'), {'attempt': self.work['attempt'],
            'stage': 'after' if (self.directory / 'submitted.json').exists() else 'before'})
        return name

    def click(self, x, y):
        if not 0 <= x < self.conf['width'] or not 0 <= y < self.conf['height']:
            raise ValueError('Click outside dedicated screen')
        self.vnc('move', str(x), str(y), 'mousedown', '1', 'pause', '0.2', 'mouseup', '1', 'pause', '1')

    def observe(self, stage, observation):
        observation_ok(self.directory, observation)
        if (stage == 'after') != (self.directory / 'submitted.json').exists():
            raise ValueError('Observation is out of order')
        save_json(self.directory / (stage + '.json'), observation)

    def submit(self, x, y, direct, fallback):
        work = self.work
        before = load_json(self.directory / 'before.json')
        observation_ok(self.directory, before)
        if before['membership'] != 'absent' or before['invitation'] != 'absent':
            raise ValueError('Must verify both absent')
        mode = work['mode']
        if mode == 'reconcile' or (mode == 'direct_add' and (work['eligibility'] != 'google' or direct != 'yes')):
            raise ValueError('Direct add not authorized')
        if mode == 'invite' and direct != 'no':
            raise ValueError('Invitation mode requires direct-add unchecked')
        if mode == 'direct_add' and fallback == 'yes' and not work['allow_fallback']:
            raise ValueError('Invitation fallback not authorized')
        # Durable before clicking: crash/timeout must never allow another submission.
        save_json(self.directory / 'submitted.json', {'action': mode})
        self.click(x, y)

    def finish(self, stop):
        def read(name):
            path = self.directory / (name + '.json')
            return load_json(path) if path.exists() else None
        result = {k: self.work[k] for k in ('version', 'job', 'attempt', 'group_url', 'mode')}
        result.update(item_id=self.work['item']['id'], before=read('before'), after=read('after'),
                      action=(read('submitted') or {}).get('action', 'none'), stop=stop)
        interpret(self.work, result, self.directory)
        save_json(self.directory / 'response.json', result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--request', required=True, type=Path)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('open-members', 'capture', 'email'):
        sub.add_parser(name)
    key = sub.add_parser('key'); key.add_argument('key', choices=['Tab', 'Shift-Tab', 'Escape', 'BackSpace', 'Control-a', 'Down', 'Up'])
    for name in ('click', 'submit'):
        click = sub.add_parser(name); click.add_argument('x', type=int); click.add_argument('y', type=int)
        if name == 'submit':
            click.add_argument('--direct-selected', required=True, choices=['yes', 'no'])
            click.add_argument('--fallback-warning', required=True, choices=['yes', 'no'])
    obs = sub.add_parser('observe'); obs.add_argument('stage', choices=['before', 'after'])
    obs.add_argument('--membership', required=True, choices=sorted(STATES)); obs.add_argument('--invitation', required=True, choices=sorted(STATES))
    obs.add_argument('--member-capture', required=True); obs.add_argument('--invite-capture', required=True)
    finish = sub.add_parser('finish'); finish.add_argument('--stop', choices=sorted(STOPS), default='none')
    args = parser.parse_args()
    os.umask(0o077)
    with locked(args.request.parent / 'helper.lock'):
        ui = NativeUI(args.request)
        if args.command == 'capture':
            print(ui.capture())
        elif args.command == 'open-members':
            ui.vnc('key', 'ctrl-l', 'type', GROUP_URL, 'key', 'enter', 'pause', '1')
        elif args.command == 'email':
            ui.vnc('type', ui.work['item']['email'])
        elif args.command == 'key':
            keys = {'Control-a': 'ctrl-a', 'Shift-Tab': 'shift-tab', 'BackSpace': 'bsp', 'Escape': 'esc'}
            ui.vnc('key', keys.get(args.key, args.key.lower()))
        elif args.command == 'click':
            ui.click(args.x, args.y)
        elif args.command == 'submit':
            ui.submit(args.x, args.y, args.direct_selected, args.fallback_warning)
        elif args.command == 'observe':
            ui.observe(args.stage, {k: getattr(args, k) for k in ('membership', 'invitation', 'member_capture', 'invite_capture')})
        else:
            ui.finish(args.stop)


if __name__ == '__main__':
    main()
