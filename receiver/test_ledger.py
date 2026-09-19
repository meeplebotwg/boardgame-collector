"""Only synthetic local evidence, never live Google membership verification."""
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import meeple_receiver as m
import test_receiver as fixtures
from test_receiver import batch, OWNER


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'private'
        self.store = m.Store(self.root)

    def intake(self, value=None, at=100):
        with patch.object(m.time, 'time', return_value=at):
            return self.store.intake(OWNER, value or batch())[0]

    def outcome(self, job, status, at=200, added_at=None):
        with patch.object(m.time, 'time', return_value=at):
            self.store.set_outcome(job, '1' * 64, status, 'Synthetic observation only', added_at=added_at)

    def test_first_receipt_immutable_across_jobs_replay_restart_and_duplicates(self):
        job = self.intake()
        original = self.store.read(job)
        self.assertEqual(original['received_at'], 100)
        self.assertEqual(original['items'][0]['received_at'], 100)
        b = batch(); b['key'] = 'b' * 32
        duplicate = dict(b['records'][0], id='3' * 64, name='Synthetic variant', email=' new@example.org ', source='Other capture')
        b['records'].append(duplicate)
        second = self.intake(b, at=150)
        self.outcome(job, 'added', added_at=175)
        self.assertEqual(self.intake(at=300), job)
        self.store = m.Store(self.root)
        view = self.store.read(second)
        self.assertEqual(view['received_at'], 150)
        self.assertEqual([r['received_at'] for r in view['items']], [100, 100, 150])
        self.assertEqual(view['items'][2]['record'], duplicate)
        self.assertEqual(view['items'][0]['record'], batch()['records'][0])
        self.assertEqual(view['items'][2]['added_at'], 175)
        self.assertEqual(view['items'][2]['verified_at'], 200)
        self.assertEqual(self.store.read(job)['received_at'], 100)
        other, _ = self.store.intake('other@example.org', batch())
        self.assertIsNone(self.store.read(other)['items'][0]['added_at'])
        self.assertEqual(self.store.read(other)['items'][0]['status'], 'received')

    def test_added_date_is_explicit_and_verification_is_separate(self):
        job = self.intake()
        self.outcome(job, 'already_member')
        item = self.store.read(job)['items'][0]
        self.assertIsNone(item['added_at'])
        self.assertEqual(item['verified_at'], 200)
        self.outcome(job, 'added', at=300)  # no guessed add time
        self.assertIsNone(self.store.read(job)['items'][0]['added_at'])
        self.outcome(job, 'added', at=400, added_at=175)
        self.outcome(job, 'already_member', at=500)
        item = self.store.read(job)['items'][0]
        self.assertEqual((item['added_at'], item['verified_at'], item['updated']), (175, 500, 500))
        with self.assertRaises(ValueError):
            self.outcome(job, 'added', at=600, added_at=176)
        for invalid in [-1, True, 1.5, '175', 601]:
            with self.assertRaises(ValueError):
                self.outcome(job, 'added', at=600, added_at=invalid)
        self.assertEqual(self.store.read(job)['items'][0], item)

    def test_unsuccessful_states_never_create_success_dates(self):
        job = self.intake()
        for status in ['blocked', 'invitation_required', 'needs_verification']:
            self.outcome(job, status)
            item = self.store.read(job)['items'][0]
            self.assertEqual(item['status'], status)
            self.assertIsNone(item['added_at'])
            self.assertIsNone(item['verified_at'])
            with self.assertRaises(ValueError):
                self.outcome(job, status, added_at=175)
        self.outcome(job, 'added', added_at=175)
        self.outcome(job, 'needs_verification', at=300)
        item = self.store.read(job)['items'][0]
        self.assertEqual((item['added_at'], item['verified_at'], item['updated']), (175, 200, 300))

    def test_legacy_migration_never_invents_dates_even_on_replay(self):
        legacy = Path(self.tmp.name) / 'legacy'; legacy.mkdir()
        job = 'd' * 32
        target = 'signup:bgn-wg:new@example.org'
        with sqlite3.connect(legacy / 'intake.sqlite3') as db:
            db.executescript('''
                CREATE TABLE jobs (id TEXT PRIMARY KEY, owner TEXT, key TEXT, body TEXT, UNIQUE(owner,key));
                CREATE TABLE records (owner TEXT, id TEXT, body TEXT, target TEXT, PRIMARY KEY(owner,id));
                CREATE TABLE items (job TEXT, record TEXT, position INTEGER, PRIMARY KEY(job,record));
                CREATE TABLE outcomes (owner TEXT, target TEXT, status TEXT, evidence TEXT, updated INTEGER, PRIMARY KEY(owner,target));
                CREATE TABLE audit (owner TEXT, target TEXT, status TEXT, evidence TEXT, updated INTEGER);
            ''')
            b = batch(); b['records'] = b['records'][:1]
            db.execute('INSERT INTO jobs VALUES (?,?,?,?)', (job, OWNER, b['key'], m.canonical(b)))
            db.execute('INSERT INTO records VALUES (?,?,?,?)', (OWNER, '1' * 64, m.canonical(b['records'][0]), target))
            db.execute('INSERT INTO items VALUES (?,?,?)', (job, '1' * 64, 0))
            db.execute('INSERT INTO outcomes VALUES (?,?,?,?,?)', (OWNER, target, 'added', 'Legacy synthetic evidence', 50))
            db.execute('INSERT INTO audit VALUES (?,?,?,?,?)', (OWNER, target, 'added', 'Legacy synthetic evidence', 50))
        self.store = m.Store(legacy)
        self.assertEqual(self.intake(b), job)
        self.store = m.Store(legacy)  # migration is idempotent
        view = self.store.read(job)
        self.assertIsNone(view['received_at'])
        for key in ['received_at', 'added_at', 'verified_at']:
            self.assertIsNone(view['items'][0][key])
        self.assertEqual(view['items'][0]['updated'], 50)
        b['key'] = 'b' * 32
        self.intake(b, at=200)
        out = legacy / 'ledger.json'; self.store.export(out)
        entry = json.loads(out.read_text())['memberships'][0]
        self.assertIsNone(entry['received_at'])
        self.assertEqual(entry['audit'][0]['updated'], 50)
        self.assertIsNone(entry['audit'][0]['added_at'])

    def test_private_export_keeps_all_capture_submission_and_attempt_evidence(self):
        job = self.intake()
        self.outcome(job, 'blocked', at=125)
        b = batch(); b['key'] = 'b' * 32
        b['records'][0].update(id='3' * 64, name='Synthetic variant', email='new@example.org')
        self.intake(b, at=150)
        self.outcome(job, 'added', added_at=175)
        out = self.root / 'ledger.json'; self.store.export(out)
        result = json.loads(out.read_text())
        self.assertEqual(out.stat().st_mode & 0o777, 0o600)
        self.assertEqual(len(result['memberships']), 1)
        entry = result['memberships'][0]
        self.assertEqual((entry['owner'], entry['group'], entry['email']), (OWNER, m.GROUP, 'new@example.org'))
        self.assertEqual((entry['received_at'], entry['added_at'], entry['verified_at']), (100, 175, 200))
        self.assertEqual([r['record']['name'] for r in entry['captures']], ['Synthetic', 'Synthetic variant'])
        self.assertEqual([r['received_at'] for r in entry['captures']], [100, 150])
        self.assertEqual(entry['captures'][0]['submissions'][0], {'job': job, 'received_at': 100})
        self.assertEqual([r['status'] for r in entry['audit']], ['blocked', 'added'])
        self.assertEqual(entry['audit'][1]['added_at'], 175)
        self.assertEqual(entry['audit'][1]['job'], job)
        self.assertNotIn('host@example.org', out.read_text(), 'contacts are not a membership ledger')
        with self.assertRaises(FileExistsError):
            self.store.export(out)
        link = self.root / 'link.json'; link.symlink_to(out)
        with self.assertRaises(FileExistsError):
            self.store.export(link)

    def test_cli_delayed_confirmation_export_and_consistent_backup(self):
        job = self.intake()
        evidence = self.root / 'evidence.txt'; evidence.write_text('Synthetic delayed confirmation only')
        def cli(*args):
            return subprocess.run([sys.executable, str(Path(m.__file__)), '--data', str(self.root), *map(str, args)], capture_output=True, text=True)
        result = cli('set', job, '1' * 64, 'added', '--evidence-file', evidence, '--added-at', '2020-01-02T03:04:05Z')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, '')
        item = self.store.read(job)['items'][0]
        self.assertEqual(item['added_at'], 1577934245)
        self.assertGreater(item['verified_at'], item['added_at'])
        for invalid in ['2020-01-02', '2020-01-02T03:04:05', 'not-a-date']:
            self.assertNotEqual(cli('set', job, '1' * 64, 'added', '--evidence-file', evidence, '--added-at', invalid).returncode, 0)
        out = self.root / 'export.json'
        self.assertEqual(cli('export', '--output', out).returncode, 0)
        backup = self.root / 'backup.sqlite3'
        result = cli('backup', '--output', backup)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, '')
        self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        with sqlite3.connect(backup) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            self.assertEqual(db.execute('SELECT count(*) FROM records').fetchone()[0], 2)
            self.assertEqual(db.execute('SELECT added_at FROM outcomes WHERE added_at IS NOT NULL').fetchone()[0], 1577934245)
        self.assertNotEqual(cli('backup', '--output', backup).returncode, 0)
        link = self.root / 'link.sqlite3'; link.symlink_to(backup)
        self.assertNotEqual(cli('backup', '--output', link).returncode, 0)


class LedgerHTTPTests(unittest.TestCase):
    setUp = fixtures.ReceiverTests.setUp
    stop = fixtures.ReceiverTests.stop
    request = fixtures.ReceiverTests.request
    def test_receipt_and_owner_bound_status_include_dates_without_public_ledger(self):
        with patch.object(m.time, 'time', return_value=100):
            code, receipt = self.request()
        self.assertEqual(code, 201)
        self.assertEqual(receipt['received_at'], 100)
        with patch.object(m.time, 'time', return_value=200):
            self.assertEqual(self.request()[1], receipt)
        code, view = self.request('GET', '/v1/jobs/' + receipt['job'])
        self.assertEqual(view['received_at'], 100)
        self.assertEqual(view['items'][0]['received_at'], 100)
        self.assertIsNone(view['items'][0]['added_at'])
        self.assertIsNone(view['items'][1]['verified_at'])
        for path in ['/v1/ledger', '/v1/roster', '/v1/export']:
            self.assertEqual(self.request('GET', path)[0], 404)
