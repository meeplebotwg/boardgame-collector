"""Private, loopback-only BGN intake. No public processing/mutation endpoint."""
import argparse
from contextlib import contextmanager
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import os
from pathlib import Path
import re
import sqlite3
import time
import uuid

LIMIT = 128 * 1024
JOB = re.compile(r'[a-f0-9]{32}')
RECORD = re.compile(r'[a-f0-9]{64}')
OUTCOMES = {'added', 'already_member', 'invitation_required', 'blocked', 'needs_verification'}
GROUP = 'bgn-wg'


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def validate(value):
    if not isinstance(value, dict) or set(value) != {'version', 'key', 'records'}:
        raise ValueError('Invalid envelope')
    if type(value['version']) is not int or value['version'] != 1 or not isinstance(value['key'], str) or not JOB.fullmatch(value['key']):
        raise ValueError('Invalid version/key')
    records = value['records']
    if not isinstance(records, list) or not 1 <= len(records) <= 100:
        raise ValueError('Invalid batch size')
    seen = set()
    for rec in records:
        if not isinstance(rec, dict):
            raise ValueError('Invalid record')
        kind = rec.get('kind')
        fields = {'email': 254, 'name': 200, 'source': 200} if kind == 'signup' else {'email': 254, 'name': 200, 'phone': 100, 'tag': 200, 'notes': 2000}
        if kind not in ('signup', 'contact') or set(rec) != set(fields) | {'id', 'kind'}:
            raise ValueError('Invalid fields')
        if not isinstance(rec['id'], str) or not RECORD.fullmatch(rec['id']) or rec['id'] in seen:
            raise ValueError('Invalid record identity')
        seen.add(rec['id'])
        for key, bound in fields.items():
            text = rec[key]
            if not isinstance(text, str) or len(text) > bound or any(ord(c) < 32 and c not in '\n\t' for c in text):
                raise ValueError('Invalid text')
        email = rec['email'].strip().lower()
        if kind == 'signup' and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
            raise ValueError('Invalid signup email')
        if kind == 'contact' and not rec['name'].strip():
            raise ValueError('Contact name required')
    return value


class Conflict(Exception):
    pass


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chmod(self.root, 0o700)
        self.db = self.root / 'intake.sqlite3'
        fd = os.open(self.db, os.O_CREAT | os.O_RDWR, 0o600)
        os.close(fd)
        os.chmod(self.db, 0o600)
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, owner TEXT, key TEXT, body TEXT, UNIQUE(owner,key));
                CREATE TABLE IF NOT EXISTS records (owner TEXT, id TEXT, body TEXT, target TEXT, PRIMARY KEY(owner,id));
                CREATE TABLE IF NOT EXISTS items (job TEXT, record TEXT, position INTEGER, PRIMARY KEY(job,record));
                CREATE TABLE IF NOT EXISTS outcomes (owner TEXT, target TEXT, status TEXT, evidence TEXT, updated INTEGER, PRIMARY KEY(owner,target));
                CREATE TABLE IF NOT EXISTS audit (owner TEXT, target TEXT, status TEXT, evidence TEXT, updated INTEGER);
            ''')
            # Nullable migration: old updated/audit values cannot prove receipt or add dates.
            db.execute('BEGIN IMMEDIATE')
            for table, columns in {
                'jobs': {'received_at': 'INTEGER'},
                'records': {'received_at': 'INTEGER'},
                'outcomes': {'received_at': 'INTEGER', 'added_at': 'INTEGER', 'verified_at': 'INTEGER'},
                'audit': {'added_at': 'INTEGER', 'verified_at': 'INTEGER', 'job': 'TEXT', 'record': 'TEXT'},
            }.items():
                existing = {r['name'] for r in db.execute(f'PRAGMA table_info({table})')}
                for column, kind in columns.items():
                    if column not in existing:
                        db.execute(f'ALTER TABLE {table} ADD COLUMN {column} {kind}')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.db, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA synchronous=FULL')
        try:
            with db:
                yield db
        finally:
            db.close()

    def intake(self, owner, value):
        validate(value)
        body = canonical(value)
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT id,body FROM jobs WHERE owner=? AND key=?', (owner, value['key'])).fetchone()
            if previous:
                if previous['body'] != body:
                    raise Conflict()
                return previous['id'], False
            job = uuid.uuid4().hex
            now = int(time.time())
            db.execute('INSERT INTO jobs (id,owner,key,body,received_at) VALUES (?,?,?,?,?)', (job, owner, value['key'], body, now))
            for pos, rec in enumerate(value['records']):
                facts = canonical(rec)
                previous = db.execute('SELECT body FROM records WHERE owner=? AND id=?', (owner, rec['id'])).fetchone()
                if previous and previous['body'] != facts:
                    raise Conflict()
                target = 'signup:' + GROUP + ':' + rec['email'].strip().lower() if rec['kind'] == 'signup' else 'contact:' + rec['id']
                db.execute('INSERT OR IGNORE INTO records (owner,id,body,target,received_at) VALUES (?,?,?,?,?)', (owner, rec['id'], facts, target, now))
                db.execute('INSERT INTO items VALUES (?,?,?)', (job, rec['id'], pos))
                state = 'received' if rec['kind'] == 'signup' else 'stored_contact'
                db.execute('INSERT OR IGNORE INTO outcomes (owner,target,status,evidence,updated,received_at) VALUES (?,?,?,?,?,?)', (owner, target, state, '', now, now))
        return job, True

    def list_jobs(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute('SELECT id,owner,received_at FROM jobs ORDER BY rowid')]

    def read(self, job, owner=None):
        if not isinstance(job, str) or not JOB.fullmatch(job):
            raise ValueError('Invalid job ID')
        with self.connect() as db:
            row = db.execute('SELECT owner,received_at FROM jobs WHERE id=?', (job,)).fetchone()
            if not row or (owner is not None and row['owner'] != owner):
                raise KeyError('Unknown job')
            rows = db.execute('''SELECT r.id,r.body,r.received_at,o.status,o.evidence,o.updated,o.added_at,o.verified_at FROM items i
                JOIN records r ON r.id=i.record AND r.owner=?
                JOIN outcomes o ON o.target=r.target AND o.owner=r.owner
                WHERE i.job=? ORDER BY i.position''', (row['owner'], job))
            return {'job': job, 'received_at': row['received_at'], 'items': [dict(
                {k: r[k] for k in ('id', 'status', 'evidence', 'updated', 'received_at', 'added_at', 'verified_at')},
                record=json.loads(r['body'])) for r in rows]}

    def set_outcome(self, job, item, status, evidence, added_at=None):
        if status not in OUTCOMES or not isinstance(evidence, str) or not evidence.strip() or len(evidence) > 2000:
            raise ValueError('Outcome requires bounded evidence')
        current = self.read(job)
        if not any(r['id'] == item and r['record']['kind'] == 'signup' for r in current['items']):
            raise ValueError('Only a signup can receive a membership outcome')
        now = int(time.time())
        verified_at = now if status in {'added', 'already_member'} else None
        if added_at is not None and (verified_at is None or type(added_at) is not int or not 0 <= added_at <= now):
            raise ValueError('Actual addition time requires a successful observation and a non-future timestamp')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('''SELECT r.owner,r.target,o.added_at FROM records r
                JOIN jobs j ON j.owner=r.owner JOIN outcomes o ON o.owner=r.owner AND o.target=r.target
                WHERE j.id=? AND r.id=?''', (job, item)).fetchone()
            if added_at is not None and row['added_at'] is not None and row['added_at'] != added_at:
                raise ValueError('Known addition time conflicts; reconcile evidence without overwriting history')
            db.execute('''UPDATE outcomes SET status=?,evidence=?,updated=?,
                added_at=COALESCE(added_at,?),verified_at=COALESCE(?,verified_at)
                WHERE owner=? AND target=?''', (status, evidence.strip(), now, added_at, verified_at, row['owner'], row['target']))
            db.execute('''INSERT INTO audit (owner,target,status,evidence,updated,added_at,verified_at,job,record)
                VALUES (?,?,?,?,?,?,?,?,?)''', (row['owner'], row['target'], status, evidence.strip(), now, added_at, verified_at, job, item))

    def export(self, output):
        # One snapshot, one row per membership target, all original captures and attempts.
        with self.connect() as db:
            db.execute('BEGIN')
            memberships = []
            for outcome in db.execute("SELECT * FROM outcomes WHERE target LIKE 'signup:%' ORDER BY rowid"):
                owner, target = outcome['owner'], outcome['target']
                entry = {k: outcome[k] for k in ('owner', 'status', 'evidence', 'updated', 'received_at', 'added_at', 'verified_at')}
                _, entry['group'], entry['email'] = target.split(':', 2)
                entry['captures'] = []
                for record in db.execute('SELECT * FROM records WHERE owner=? AND target=? ORDER BY rowid', (owner, target)):
                    submissions = [dict(r) for r in db.execute('''SELECT j.id AS job,j.received_at
                        FROM items i JOIN jobs j ON i.job=j.id WHERE j.owner=? AND i.record=? ORDER BY j.rowid''', (owner, record['id']))]
                    entry['captures'].append({'record': json.loads(record['body']), 'received_at': record['received_at'], 'submissions': submissions})
                entry['audit'] = [dict(r) for r in db.execute('''SELECT status,evidence,updated,added_at,verified_at,job,record
                    FROM audit WHERE owner=? AND target=? ORDER BY rowid''', (owner, target))]
                memberships.append(entry)
        with private_output(output) as out:
            json.dump({'version': 1, 'memberships': memberships}, out, ensure_ascii=False, indent=2)
            out.write('\n')

    def backup(self, output):
        # SQLite backup API, not a file copy that can miss an in-flight journal.
        with private_output(output):
            with self.connect() as source:
                dest = sqlite3.connect(output)
                try:
                    source.backup(dest)
                finally:
                    dest.close()


@contextmanager
def private_output(path):
    # Exclusive creation also rejects symlinks; parent directory is operator-owned.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'w') as out:
            yield out
            out.flush()
            os.fsync(out.fileno())
    except BaseException:
        Path(path).unlink()
        raise


def added_timestamp(value):
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})', value):
        raise argparse.ArgumentTypeError('Use RFC3339 with seconds and timezone, e.g. 2020-01-02T03:04:05Z')
    try:
        return int(datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp())
    except ValueError as exc:
        raise argparse.ArgumentTypeError('Invalid addition timestamp') from exc


def make_server(store, config_path):
    def config():
        value = json.loads(Path(config_path).read_text())
        if not isinstance(value.get('owners'), list) or not value['owners'] or not all(isinstance(o, str) and o for o in value['owners']):
            raise ValueError('Private owners config required')
        return value

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, format, *args):
            pass  # No PII/paths/headers in access logs.

        def reply(self, code, value):
            data = canonical(value).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def handle_request(self):
            try:
                conf = config()  # Revocation applies to every read/write.
                owners = self.headers.get_all('Tailscale-User-Login', [])
                origin = self.headers.get_all('Origin', [])
                if len(owners) != 1 or owners[0] not in conf['owners'] or (origin and origin != [conf['origin']]):
                    return self.reply(403, {'error': 'Forbidden'})
                if self.command == 'GET' and re.fullmatch(r'/v1/jobs/[a-f0-9]{32}', self.path):
                    return self.reply(200, store.read(self.path.rsplit('/', 1)[1], owners[0]))
                if self.command != 'POST' or self.path != '/v1/jobs':
                    return self.reply(404, {'error': 'Not found'})
                if self.headers.get_all('X-BGN-Handoff') != ['1'] or self.headers.get_all('Content-Type') != ['application/json']:
                    return self.reply(403, {'error': 'Write headers required'})
                lengths = self.headers.get_all('Content-Length', [])
                if len(lengths) != 1 or not lengths[0].isdigit() or self.headers.get('Transfer-Encoding'):
                    return self.reply(400, {'error': 'Length required'})
                length = int(lengths[0])
                if length > LIMIT:
                    return self.reply(413, {'error': 'Too large'})
                body = self.rfile.read(length)
                if len(body) != length:
                    raise ValueError('Incomplete body')
                def unique(pairs):
                    value = {}
                    for k, v in pairs:
                        if k in value:
                            raise ValueError('Duplicate JSON key')
                        value[k] = v
                    return value
                value = json.loads(body, object_pairs_hook=unique)
                job, created = store.intake(owners[0], value)
                return self.reply(201 if created else 200, {'job': job, 'received_at': store.read(job, owners[0])['received_at']})
            except KeyError:
                self.reply(404, {'error': 'Not found'})
            except Conflict:
                self.reply(409, {'error': 'Identity conflict'})
            except (ValueError, UnicodeError):
                self.reply(400, {'error': 'Invalid request'})
            except (OSError, sqlite3.Error):
                self.reply(503, {'error': 'Unavailable; retry same batch'})

        do_POST = handle_request
        do_GET = handle_request

        def do_OPTIONS(self):
            self.reply(405, {'error': 'Method not allowed'})

    # Single-threaded, bounded sockets: narrow personal intake, not a gateway.
    return HTTPServer(('127.0.0.1', config()['port']), Handler)


def run_job(store, job, owner_session_ready=False, runner=None, *, mode=None,
            eligibility='unknown', ui_config=None, item_id=None, allow_invitation_fallback=False):
    from enrollment_worker import MODES, ELIGIBILITY, MAILBOX, locked, perform
    if not isinstance(job, str) or not JOB.fullmatch(job):
        raise ValueError('Invalid job ID')
    if mode is not None and mode not in MODES or eligibility not in ELIGIBILITY:
        raise ValueError('Invalid enrollment policy')
    if item_id is not None and (not isinstance(item_id, str) or not RECORD.fullmatch(item_id)):
        raise ValueError('Invalid record ID')
    with locked(store.root / 'processor.lock') as lock:
        current = store.read(job)
        def selectable(r):
            if r['record']['kind'] != 'signup' or (item_id is not None and r['id'] != item_id):
                return False
            if mode == 'reconcile':
                return True
            if r['status'] in {'added', 'already_member'}:
                return False
            if r['status'] == 'invitation_required':
                # Old/manual ambiguous invitation evidence must be reconciled explicitly.
                try:
                    return json.loads(r['evidence']).get('meaning') == 'invitation_not_sent'
                except (ValueError, AttributeError):
                    return False
            return True
        pending = [r for r in current['items'] if selectable(r)]
        if not pending:
            return 'nothing_pending'
        # One target per human-gated invocation, never 100 UI actions in a blind batch.
        item = pending[0]
        if not owner_session_ready:
            if item['status'] in {'received', 'blocked'}:
                store.set_outcome(job, item['id'], 'blocked', 'Owner Google session not verified; no action attempted.')
            return 'blocked'
        if mode is None:
            raise ValueError('Explicit --mode direct_add, invite or reconcile required')
        if item['status'] == 'needs_verification':
            mode = 'reconcile'  # prior uncertain actions NEVER become an automatic resend
        if mode == 'direct_add' and eligibility != 'google':
            store.set_outcome(job, item['id'], 'invitation_required', canonical({
                'worker': 1, 'meaning': 'invitation_not_sent', 'eligibility': eligibility,
                'reason': 'Non-Google or unknown account requires explicit invitation/review; never infer from domain.'}))
            return 'invitation_required'
        if not MAILBOX.fullmatch(item['record']['email'].strip().lower()):
            store.set_outcome(job, item['id'], 'blocked', 'Unsupported mailbox syntax; human review required, no action attempted.')
            return 'blocked'
        if ui_config is None:
            raise ValueError('Explicit --ui-config required; no default/live browser fallback')
        return perform(store, job, item, mode, eligibility, ui_config, lock, runner,
                       allow_fallback=allow_invitation_fallback)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', required=True, type=Path, help='Private directory outside source tree')
    sub = parser.add_subparsers(dest='command', required=True)
    serve = sub.add_parser('serve'); serve.add_argument('--config', required=True, type=Path)
    sub.add_parser('list')
    read = sub.add_parser('read'); read.add_argument('job')
    put = sub.add_parser('set'); put.add_argument('job'); put.add_argument('item'); put.add_argument('status', choices=sorted(OUTCOMES)); put.add_argument('--evidence-file', required=True, type=Path)
    put.add_argument('--added-at', type=added_timestamp, help='Known actual addition time (RFC3339); omitted means unknown, never now')
    for name in ('export', 'backup'):
        command = sub.add_parser(name)
        command.add_argument('--output', required=True, type=Path, help='New private file outside source/public folders; never overwritten')
    run = sub.add_parser('run'); run.add_argument('job'); run.add_argument('--owner-session-ready', action='store_true')
    run.add_argument('--mode', choices=['direct_add', 'invite', 'reconcile'])
    run.add_argument('--eligibility', choices=['google', 'non_google', 'unknown'], default='unknown', help='Owner-attested account eligibility, never inferred from email domain')
    run.add_argument('--ui-config', type=Path, help='Private dedicated native UI configuration; no automatic browser selection')
    run.add_argument('--item', help='Exact signup record ID; default is first eligible unique email')
    run.add_argument('--allow-invitation-fallback', action='store_true', help='Explicitly authorize Google to invite if a confirmed Google account cannot be directly added')
    args = parser.parse_args()
    os.umask(0o077)
    store = Store(args.data)
    if args.command == 'serve':
        server = make_server(store, args.config)
        try:
            server.serve_forever()
        finally:
            server.server_close()
    elif args.command == 'list':
        print(canonical(store.list_jobs()))
    elif args.command == 'read':
        print(canonical(store.read(args.job)))
    elif args.command == 'set':
        from enrollment_worker import locked
        with locked(store.root / 'processor.lock'):
            store.set_outcome(args.job, args.item, args.status, args.evidence_file.read_text(), added_at=args.added_at)
    elif args.command == 'export':
        store.export(args.output)
    elif args.command == 'backup':
        store.backup(args.output)
    else:
        print(run_job(store, args.job, args.owner_session_ready, mode=args.mode, eligibility=args.eligibility,
                      ui_config=args.ui_config, item_id=args.item, allow_invitation_fallback=args.allow_invitation_fallback))


if __name__ == '__main__':
    main()
