"""公開 API・GitHub API・サブプロセスを模擬する再照合の fixture。"""

import importlib.util
import io
import json
import os
import tempfile
import unittest
import urllib.error
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(f"{name}.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gh = load("github_preview")
cf = load("cloudflare_preview")
CURRENT = {"state": "success", "head": "a" * 40, "base": "b" * 40, "run": 8, "attempt": 2}
ARTIFACT = {"build": "c" * 40, "artifact": 9, "digest": "sha256:" + "d" * 64}
PLAN = dict(operation="deploy", current=CURRENT, **ARTIFACT)
DEPLOYMENT = {"preview": {"name": "pr-42", "urls": [f"https://pr-42-{cf.WORKER}.example.workers.dev"]},
              "deployment": {"urls": [f"https://abc123-{cf.WORKER}.example.workers.dev"]}}


class GitHubTest(unittest.TestCase):
    def test_completed_latest_only(self):
        completed = {"action": "completed", "workflow_run": {"id": 8, "run_attempt": 2, "conclusion": "success"}}
        with patch.object(gh, "snapshot", return_value=(CURRENT, object())), patch.object(gh, "identity", return_value=ARTIFACT):
            self.assertEqual(gh.choose(42, completed), PLAN)
            self.assertEqual(gh.choose(42, dict(completed, action="in_progress"))["operation"], "none")
            for key, value in [("id", 7), ("run_attempt", 1), ("conclusion", "cancelled")]:
                payload = dict(completed, workflow_run=dict(completed["workflow_run"], **{key: value}))
                self.assertEqual(gh.choose(42, payload)["operation"], "none")
        with patch.object(gh, "snapshot", return_value=(CURRENT, object())), patch.object(gh, "identity", return_value=None):
            self.assertEqual(gh.choose(42, completed)["operation"], "inspect")

    def test_close_reopen_and_update_after_artifact_lookup(self):
        closed = dict(CURRENT, state="closed", closed_at="2026-11-26T07:00:00Z")
        payload = {"action": "closed", "pull_request": {"number": 42}}
        with patch.object(gh, "snapshot", return_value=(closed, None)):
            delete = gh.choose(42, payload)
            self.assertEqual(delete["operation"], "delete")
            self.assertTrue(gh.current_plan(42, delete))
        with patch.object(gh, "snapshot", return_value=(CURRENT, object())):
            self.assertEqual(gh.choose(42, payload)["operation"], "none")
            self.assertFalse(gh.current_plan(42, delete))
        changed = dict(CURRENT, attempt=3)
        with patch.object(gh, "snapshot", side_effect=[(CURRENT, object()), (changed, object())]), patch.object(gh, "identity", return_value=ARTIFACT):
            self.assertFalse(gh.current_plan(42, PLAN))

    def test_stale_smoke_never_posts_verified_and_delayed_run_does_not_overwrite(self):
        stable, unique = cf.urls(DEPLOYMENT, "pr-42", "example", gh.require)
        with patch.object(gh, "snapshot", return_value=(CURRENT, object())), patch.object(gh, "current_plan", return_value=True):
            body, _ = gh.notification(42, PLAN, "deployed", "success", stable, unique, None)
            self.assertIn("公開後 smoke: PASS", body)
            self.assertIn(unique, body)
            unchanged, _ = gh.notification(42, {"operation": "none", "current": CURRENT}, "", "skipped", "", "", body)
            self.assertIsNone(unchanged)
        updated = dict(CURRENT, head="e" * 40, state="waiting")
        with patch.object(gh, "snapshot", return_value=(updated, None)):
            body, _ = gh.notification(42, PLAN, "deployed", "success", stable, unique, None)
            self.assertNotIn("PASS", body)
            self.assertNotIn(stable, body)
            self.assertIn(updated["head"], body)

    def test_notifier_does_not_send_when_state_changes_before_write(self):
        changed = dict(CURRENT, attempt=3)
        with patch.object(gh, "snapshot", side_effect=[(CURRENT, None), (changed, None)]), patch.object(gh, "pages", return_value=[]), patch.object(gh, "github") as api:
            with self.assertRaises(gh.Reject):
                gh.notify(42, PLAN, "disabled", "", "", "")
            api.assert_not_called()

    def test_redirect_does_not_receive_github_token(self):
        signed = "https://artifacts.example.invalid/archive.zip?signature=fixture"
        redirect = urllib.error.HTTPError("https://api.github.com", 302, None, {"Location": signed}, io.BytesIO())
        with patch.dict(os.environ, {"GH_TOKEN": "fixture"}, clear=True), patch.object(gh, "request", side_effect=[redirect, b"ZIP"]) as api:
            self.assertEqual(gh.download(9), b"ZIP")
            self.assertEqual(api.call_args_list[0].args[1], "fixture")
            self.assertEqual(api.call_args_list[1].args, (signed,))

    def test_routing_empty_pr_list_from_approved_fork(self):
        main = {"id": gh.source.REPO_ID, "full_name": gh.source.REPO}
        head = {"id": gh.source.FORK_ID, "full_name": gh.source.FORK}
        fork = dict(head, parent=main, fork=True)
        event = {"repository": main, "workflow_run": {"id": 8, "event": "pull_request", "head_repository": head}}
        run = {"path": gh.source.CI, "repository": main, "head_branch": "topic/preview", "head_sha": CURRENT["head"],
               "head_repository": head, "pull_requests": []}
        pull = {"number": 42, "head": {"repo": head, "ref": run["head_branch"], "sha": CURRENT["head"]},
                "base": {"repo": main, "ref": "main"}, "user": {"login": gh.source.FORK.split('/')[0]}}
        with patch.object(gh, "github", side_effect=[run, fork]), patch.object(gh, "pages", return_value=[pull]):
            self.assertEqual(gh.route(event), 42)
        with patch.object(gh, "github") as api:
            outside = dict(event, workflow_run=dict(event["workflow_run"], head_repository=dict(head, id=3)))
            self.assertIsNone(gh.route(outside))
            api.assert_not_called()


class CloudflareTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.scratch = Path(tmp.name)
        self.assets = self.scratch / "verified"
        (self.assets / "chronofork").mkdir(parents=True)
        (self.assets / "chronofork/index.html").touch()
        self.config = {"CLOUDFLARE_ACCOUNT_ID": "a" * 32, "CLOUDFLARE_API_TOKEN": "fixture-token",
                       "CLOUDFLARE_WORKERS_SUBDOMAIN": "example", "GITHUB_REF": "refs/heads/main", "RUNNER_TEMP": tmp.name}

    def test_unconfigured_never_calls_cloudflare(self):
        for key in ("CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_WORKERS_SUBDOMAIN"):
            with patch.dict(os.environ, dict(self.config, **{key: ""}), clear=True), patch.object(cf, "cloudflare") as api, patch.object(cf, "invoke") as cli:
                self.assertEqual(cf.publish(gh, 42, PLAN, self.assets), {"status": "disabled"})
                api.assert_not_called()
                cli.assert_not_called()

    def test_wrangler_receives_no_github_token_or_runner_environment(self):
        config = self.scratch / "wrangler.json"
        with patch.dict(os.environ, {"PATH": "/fixture", "HOME": str(self.scratch), "GH_TOKEN": "github-fixture", "NODE_OPTIONS": "fixture"}, clear=True), \
                patch.object(cf.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout=b"{}")) as process:
            self.assertEqual(cf.invoke(gh, config, "pr-42", "a" * 32, "cf-fixture", ["--json"]), b"{}")
            self.assertEqual(process.call_args.args[0][2:], ["preview", "--json", "--config", str(config), "--name", "pr-42", "--worker-name", cf.WORKER])
            env = process.call_args.kwargs["env"]
            self.assertEqual(env["CLOUDFLARE_API_TOKEN"], "cf-fixture")
            self.assertNotIn("GH_TOKEN", env)
            self.assertNotIn("NODE_OPTIONS", env)

    def test_only_target_preview_and_static_config(self):
        def fake_cli(_gh, config, name, _account, _token, args):
            self.assertEqual(name, "pr-42")
            self.assertEqual(args, ["--json", "--ignore-base-config"])
            parsed = json.loads(config.read_bytes())
            self.assertEqual(parsed["assets"], {"directory": str(self.assets)})
            self.assertEqual(set(parsed), {"name", "compatibility_date", "send_metrics", "previews", "assets"})
            return json.dumps(DEPLOYMENT)

        with patch.dict(os.environ, self.config, clear=True), patch.object(gh, "current_plan", return_value=True), \
                patch.object(cf, "cloudflare", side_effect=[{"name": cf.WORKER}, None]), patch.object(cf, "invoke", side_effect=fake_cli):
            self.assertEqual(cf.publish(gh, 42, PLAN, self.assets)["status"], "deployed")

    def test_reopen_before_delete_and_head_advance_during_publish(self):
        delete = {"operation": "delete", "current": dict(CURRENT, state="closed")}
        existing = {"name": "pr-42"}
        parent = {"name": cf.WORKER}
        with patch.dict(os.environ, self.config, clear=True), patch.object(cf, "cloudflare", side_effect=[parent, existing]), \
                patch.object(gh, "current_plan", side_effect=[True, False]), patch.object(cf, "invoke") as cli:
            with self.assertRaises(gh.Reject):
                cf.publish(gh, 42, delete, self.assets)
            cli.assert_not_called()
        with patch.dict(os.environ, self.config, clear=True), patch.object(cf, "cloudflare", side_effect=[parent, existing]), \
                patch.object(gh, "current_plan", side_effect=[True, True, False]), patch.object(cf, "invoke", return_value=json.dumps(DEPLOYMENT)):
            with self.assertRaises(gh.Reject):
                cf.publish(gh, 42, PLAN, self.assets)

    def test_cleanup_is_only_target_preview_and_idempotent(self):
        delete = {"operation": "delete", "current": dict(CURRENT, state="closed")}
        for existing in (None, {"name": "pr-42"}):
            with patch.dict(os.environ, self.config, clear=True), patch.object(gh, "current_plan", return_value=True), \
                    patch.object(cf, "cloudflare", side_effect=[{"name": cf.WORKER}, existing, None]) as api, patch.object(cf, "invoke") as cli:
                self.assertEqual(cf.publish(gh, 42, delete, self.assets), {"status": "deleted"})
                self.assertEqual([c.args[3] for c in api.call_args_list[1:]], ["/previews/pr-42", "/previews/pr-42"])
                if existing:
                    self.assertEqual((cli.call_args.args[2], cli.call_args.args[-1]), ("pr-42", ["delete", "--skip-confirmation"]))
                else:
                    cli.assert_not_called()

    def test_rejects_other_workers_and_malformed_host(self):
        malformed = dict(DEPLOYMENT, deployment={"urls": [f"https://abc123-{cf.WORKER}.example.workers.dev@other.example.com"]})
        with self.assertRaises(gh.Reject):
            cf.urls(malformed, "pr-42", "example", gh.require)
        with patch.dict(os.environ, self.config, clear=True), patch.object(gh, "current_plan", return_value=True), \
                patch.object(cf, "cloudflare", return_value={"name": "wrong-worker"}), patch.object(cf, "invoke") as cli:
            with self.assertRaises(gh.Reject):
                cf.publish(gh, 42, PLAN, self.assets)
            cli.assert_not_called()


if __name__ == "__main__":
    unittest.main()
