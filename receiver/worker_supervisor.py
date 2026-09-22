"""Linux task-local subreaper. Only this process retains the caller's lock FDs.

Setsid/double-fork descendants are adopted by the kernel, not found by a global
process-tree scan. No child is reaped between enumerating direct children and
signalling them, so their PIDs cannot be reused. ECHILD, not an empty /proc read,
is the completion proof. Unexpected supervisor death leaves a quarantine file.
"""
import ctypes
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import time


def drain():
    while True:
        # These are exclusively our direct children, including newly adopted
        # orphans. Kill parents first; kernel adoption brings deeper descendants
        # here on subsequent iterations, regardless of session/process group.
        children = Path(f'/proc/self/task/{os.getpid()}/children').read_text().split()
        for pid in children:
            os.kill(int(pid), signal.SIGKILL)
        while True:
            try:
                pid, _ = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                return
            if not pid:
                break
        time.sleep(.01)


def main():
    control = int(sys.argv[1])
    spec = json.load(sys.stdin)
    quarantine = Path(spec['quarantine'])
    active = Path(spec['active'])
    # Fail before launching any work if Linux subreaping is unavailable.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        raise OSError(ctypes.get_errno(), 'Cannot establish child containment')
    interrupted = False

    def stop(signum, frame):
        nonlocal interrupted
        interrupted = True

    for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(sig, stop)
    code = 125
    try:
        # stdin data is small and file-backed: no blocking pipe write while the
        # launcher-death monitor is responsible for retaining ownership.
        import tempfile
        with tempfile.TemporaryFile() as prompt:
            prompt.write(spec['input'].encode()); prompt.seek(0)
            child = subprocess.Popen(spec['args'], stdin=prompt, start_new_session=True)
        deadline = time.monotonic() + spec['timeout']
        while True:
            pid, status = os.waitpid(child.pid, os.WNOHANG)
            if pid:
                child.returncode = os.waitstatus_to_exitcode(status)
                code = child.returncode if child.returncode >= 0 else 128 - child.returncode
                break
            if interrupted or select.select([control], [], [], .02)[0]:
                break
            if time.monotonic() >= deadline:
                code = 124
                break
    finally:
        # Invalidate BEFORE termination, then retain BOTH locks until ECHILD.
        # Failure here deliberately keeps the quarantine and locks: no retry.
        try:
            active.unlink(missing_ok=True)
            drain()
            quarantine.unlink()
        except BaseException:
            # Cannot prove cleanup. A human must diagnose; never unlock and
            # advertise a fresh worker while any task child may still be alive.
            while True:
                time.sleep(3600)
    return code


if __name__ == '__main__':
    sys.exit(main())
