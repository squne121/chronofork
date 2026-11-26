"""認証情報・外部サービスを使わない成果物検証 fixture。"""

import hashlib
import importlib.util
import io
import json
import stat
import tempfile
import unittest
import warnings
import zipfile
from pathlib import Path

def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(f"{name}.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


preview = load("preview")
source = load("source")
IDENTITY = preview.manifest(42, "a" * 40, "b" * 40, "c" * 40, 123, 2)
BASE_FILES = [("chronofork/index.html", b"<html>fixture</html>"), ("chronofork/assets/index-xY_0.js", b"// fixture")]


def archive(files=BASE_FILES, identity=IDENTITY, manifest_bytes=None):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in [*files, ("manifest.json", manifest_bytes if manifest_bytes is not None else json.dumps(identity))]:
            z.writestr(name, content)
    return data.getvalue()


def digest(raw):
    return "sha256:" + hashlib.sha256(raw).hexdigest()


class ArtifactTest(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.root = Path(scratch.name)
        self.output = self.root / "verified"

    def verify(self, raw):
        preview.validate_zip(raw, digest(raw), IDENTITY, self.output)

    def invalid(self, raw):
        with self.assertRaises(preview.Reject):
            self.verify(raw)
        self.assertFalse(self.output.exists())

    def test_valid_archive_writes_only_assets(self):
        self.verify(archive([*BASE_FILES, ("chronofork/", b""), ("chronofork/assets/", b"")]))
        self.assertFalse((self.output / "manifest.json").exists())
        for name, content in BASE_FILES:
            self.assertEqual((self.output / name).read_bytes(), content)

    def test_identity_and_digest(self):
        for key, bad in [("pr", 99), ("head", "d" * 40), ("base", "d" * 40), ("build", "d" * 40), ("run", 124), ("attempt", 1), ("version", True)]:
            with self.subTest(key=key):
                self.invalid(archive(identity=dict(IDENTITY, **{key: bad})))
        with self.assertRaises(preview.Reject):
            preview.validate_zip(archive(), "sha256:" + "0" * 64, IDENTITY, self.output)
        self.assertFalse(self.output.exists())
        self.invalid(archive(manifest_bytes=b'{"version":0,' + json.dumps(IDENTITY).encode()[1:]))

    def test_disallowed_paths(self):
        for name in ("../index.html", "/chronofork/index.html", "chronofork/assets/../a.js", "chronofork/assets/hidden.js/",
                     "chronofork/assets\\foo.js", "chronofork/assets/.env", "chronofork/_headers", "chronofork/_redirects",
                     "chronofork/.assetsignore", "chronofork/wrangler.json", "chronofork/assets/foo.js.map", "chronofork/functions/main.js"):
            with self.subTest(name=name):
                self.invalid(archive([*BASE_FILES, (name, b"x")]))

    def test_duplicates_and_missing_entries(self):
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            self.invalid(archive([*BASE_FILES, BASE_FILES[0]]))
        self.invalid(archive([*BASE_FILES, ("chronofork/assets/INDEX-xy_0.js", b"x")]))
        self.invalid(archive(BASE_FILES[:1]))
        self.invalid(b"not a zip")

    def test_special_files_and_limits(self):
        for kind in (stat.S_IFLNK, stat.S_IFIFO, stat.S_IFCHR, stat.S_IFBLK, stat.S_IFSOCK, stat.S_IFDIR):
            with self.subTest(kind=kind):
                member = zipfile.ZipInfo("chronofork/assets/extra.js")
                member.create_system = 3
                member.external_attr = (kind | 0o644) << 16
                self.invalid(archive([*BASE_FILES, (member, b"x")]))
        self.invalid(archive([*BASE_FILES, ("chronofork/assets/huge.js", b"0" * (preview.FILE_LIMIT + 1))]))
        extra = [(f"chronofork/assets/part{i}.js", b"x") for i in range(preview.COUNT_LIMIT)]
        self.invalid(archive([*BASE_FILES, *extra]))
        self.invalid(archive([*BASE_FILES, ("chronofork/assets/large-1.js", b"0" * preview.FILE_LIMIT),
                              ("chronofork/assets/large-2.js", b"0" * preview.FILE_LIMIT)]))

    def test_package_copies_dist(self):
        dist = self.root / "dist"
        dist.mkdir()
        for name, content in BASE_FILES:
            path = dist / name.removeprefix("chronofork/")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        target = self.root / "upload"
        preview.package_dist(dist, target, IDENTITY)
        self.assertEqual(json.loads((target / "manifest.json").read_bytes()), IDENTITY)
        for name, content in BASE_FILES:
            self.assertEqual((target / name).read_bytes(), content)
        (dist / "assets" / "link.js").symlink_to(dist / "index.html")
        with self.assertRaises(preview.Reject):
            preview.package_dist(dist, self.root / "bad", IDENTITY)


class SourceTest(unittest.TestCase):
    def setUp(self):
        self.repo = dict(id=source.REPO_ID, full_name=source.REPO)
        self.fork = dict(id=source.FORK_ID, full_name=source.FORK, parent=self.repo, fork=True)
        self.actor = dict(login="developer", type="User")
        self.pr = dict(number=42, state="open", user=self.actor,
                       base=dict(sha=IDENTITY["base"], ref="main", repo=self.repo),
                       head=dict(sha=IDENTITY["head"], ref="feature", repo=self.repo))
        self.workflow = dict(id=88, path=source.CI, state="active")
        self.run = dict(id=123, run_attempt=2, workflow_id=88, path=source.CI, event="pull_request", status="completed",
                        conclusion="success", head_branch="feature", head_sha=IDENTITY["head"], repository=self.repo,
                        head_repository=self.repo, actor=self.actor, triggering_actor=self.actor, pull_requests=[],
                        created_at="2026-11-26T12:00:00Z")
        self.jobs = [dict(name="quick-check", conclusion="success", run_attempt=2, run_id=123, head_sha=IDENTITY["head"],
                          steps=[dict(name="Upload verified PR build", conclusion="success")])]
        self.merge = dict(sha=IDENTITY["build"], parents=[dict(sha=IDENTITY[key]) for key in ("base", "head")])
        self.workflow_blob = dict(type="file", sha="e" * 40)
        self.artifact = dict(id=987, name="preview-123-2", size_in_bytes=2000, expired=False, digest="sha256:" + "0" * 64,
                             workflow_run=dict(id=123, repository_id=source.REPO_ID, head_repository_id=source.REPO_ID,
                                               head_sha=IDENTITY["head"]))

    def current(self, pr=None, latest=None, delivered=None, reopened_at=""):
        return source.current_success(pr or self.pr, self.fork, self.workflow, delivered or self.run, latest or self.run, reopened_at)

    def test_same_repo_and_bot_fork_empty_pull_requests(self):
        self.assertTrue(self.current())
        pr = dict(self.pr, head=dict(self.pr["head"], repo=self.fork))
        self.assertTrue(self.current(pr=pr, latest=dict(self.run, head_repository=self.fork)))
        self.fork["parent"] = {"id": 17}
        self.assertFalse(self.current(pr=pr, latest=dict(self.run, head_repository=self.fork)))

    def test_unapproved_identity(self):
        self.assertFalse(self.current(pr=dict(self.pr, user={"login": "dependabot[bot]"})))
        self.assertFalse(self.current(pr=dict(self.pr, base=dict(self.pr["base"], ref="release"))))
        self.assertFalse(self.current(pr=dict(self.pr, head=dict(self.pr["head"], repo=dict(self.fork, id=1)))))
        for change in (dict(actor={"login": "other[bot]"}), dict(triggering_actor={"login": "dependabot[bot]"}),
                       dict(workflow_id=89), dict(path=".github/workflows/other.yml"), dict(event="push"),
                       dict(repository=self.fork), dict(head_repository=self.fork), dict(pull_requests=[{"number": 25}])):
            with self.subTest(change=change):
                self.assertFalse(self.current(latest=dict(self.run, **change)))

    def test_close_reopen_stale_head_run_and_attempt(self):
        self.assertFalse(self.current(pr=dict(self.pr, state="closed")))
        self.assertFalse(self.current(reopened_at="2026-11-26T12:00:00Z"))
        self.assertTrue(self.current(reopened_at="2026-11-26T11:59:59Z"))
        self.assertFalse(self.current(pr=dict(self.pr, head=dict(self.pr["head"], sha="e" * 40))))
        for change in (dict(head_branch="other"), dict(run_attempt=3), dict(id=124), dict(status="in_progress"),
                       dict(conclusion="failure"), dict(conclusion="cancelled")):
            with self.subTest(change=change):
                self.assertFalse(self.current(latest=dict(self.run, **change)))
        self.assertFalse(self.current(delivered=dict(self.run, conclusion="failure")))

    def test_artifact_source_and_exact_attempt(self):
        def select(jobs=None, merge=None, blob=None, artifacts=None):
            return source.select_artifact(self.pr, self.run, jobs or self.jobs, merge or self.merge, blob or self.workflow_blob,
                                          "e" * 40, artifacts or [self.artifact], preview.LIMIT)

        self.assertEqual(select(), dict(build=IDENTITY["build"], artifact=987, digest=self.artifact["digest"]))
        self.assertIsNone(select(jobs=[dict(self.jobs[0], run_attempt=1)]))
        self.assertIsNone(select(jobs=[dict(self.jobs[0], steps=[])]))
        self.assertIsNone(select(blob=dict(self.workflow_blob, sha="f" * 40)))
        self.assertIsNone(select(merge=dict(self.merge, parents=list(reversed(self.merge["parents"])))))
        self.assertIsNone(select(artifacts=[self.artifact, self.artifact]))
        for change in (dict(name="preview-123-1"), dict(expired=True), dict(digest=""), dict(size_in_bytes=preview.LIMIT + 1),
                       dict(workflow_run=dict(self.artifact["workflow_run"], id=122)),
                       dict(workflow_run=dict(self.artifact["workflow_run"], head_repository_id=source.FORK_ID))):
            with self.subTest(change=change):
                self.assertIsNone(select(artifacts=[dict(self.artifact, **change)]))


if __name__ == "__main__":
    unittest.main()
