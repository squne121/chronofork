#!/usr/bin/env python3
"""Run the actual quick-check workflow shell with GitHub Actions' bash flags.

Run from any directory: python3 -IB scripts/test_quick_check.py
The deliberately narrow extractor fails closed if the workflow structure changes.
"""

import importlib.util
import os
from pathlib import Path
import re
import subprocess
import textwrap
import unittest


WORKFLOW = Path(__file__).resolve().parents[1] / ".github/workflows/ci.yml"
EXPECTED_ENV = {
    "STATIC": "needs.static.result",
    "UNIT": "needs.unit.result",
    "E2E": "needs.e2e.result",
    "WORKER": "needs.worker.result",
    "EVENT": "github.event_name",
    "REF": "github.ref",
}


def extract_shell():
    text = WORKFLOW.read_text(encoding="utf-8")
    jobs = re.findall(r"(?ms)^  quick-check:\s*\n(.*?)(?=^  [\w-]+:\s*(?:\n|$)|\Z)", text)
    if len(jobs) != 1:
        raise ValueError("expected exactly one quick-check job")
    job = jobs[0]
    if not re.search(r"(?m)^    if: always\(\)\s*$", job):
        raise ValueError("quick-check must run even when a dependency is skipped or fails")
    workers = re.findall(r"(?ms)^  worker:\s*\n(.*?)(?=^  [\w-]+:\s*(?:\n|$)|\Z)", text)
    if len(workers) != 1 or not re.search(r"(?m)^    if: github\.event_name == 'pull_request'\s*$", workers[0]):
        raise ValueError("worker must be limited to pull requests")
    if not re.search(r"(?m)^    needs: \[static, unit, e2e, worker\]\s*$", job):
        raise ValueError("unexpected quick-check dependencies")
    steps = re.findall(
        r"(?ms)^      - name: Require every verification job\s*\n(.*?)(?=^      - |\Z)", job
    )
    if len(steps) != 1:
        raise ValueError("expected exactly one quick-check verification step")
    step = steps[0]
    match = re.fullmatch(r"(?s)        env:\s*\n(.*?)        run: \|\s*\n((?:          .*\n?)+)\s*", step)
    if not match:
        raise ValueError("unexpected verification step structure")
    env_lines = match.group(1).splitlines()
    env = {}
    for line in env_lines:
        entry = re.fullmatch(r"          ([A-Z0-9_]+): \$\{\{ (.*?) \}\}", line)
        if not entry or entry.group(1) in env:
            raise ValueError("unexpected or duplicate environment mapping")
        env[entry.group(1)] = entry.group(2)
    if env != EXPECTED_ENV:
        raise ValueError("unexpected verification environment mappings")
    return textwrap.dedent(match.group(2))


class QuickCheckTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shell = extract_shell()

    def check_case(self, expected, **overrides):
        env = dict(os.environ, STATIC="success", UNIT="success", E2E="success",
                   WORKER="success", EVENT="pull_request", REF="refs/pull/123/merge")
        env.update(overrides)
        result = subprocess.run(
            ["bash", "--noprofile", "--norc", "-e", "-o", "pipefail", "-c", self.shell],
            env=env, capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode == 0, expected,
                         f"inputs={overrides}, exit={result.returncode}, stdout={result.stdout!r}, stderr={result.stderr!r}")

    def test_pull_request(self):
        self.check_case(True)
        for dependency in ("STATIC", "UNIT", "E2E", "WORKER"):
            for status in ("failure", "cancelled", "skipped", ""):
                with self.subTest(dependency=dependency, status=status):
                    self.check_case(False, **{dependency: status})

    def test_main_push(self):
        base = {"EVENT": "push", "REF": "refs/heads/main", "WORKER": "skipped"}
        self.check_case(True, **base)
        for dependency in ("STATIC", "UNIT", "E2E"):
            for status in ("failure", "cancelled", "skipped", ""):
                with self.subTest(dependency=dependency, status=status):
                    self.check_case(False, **(base | {dependency: status}))
        for status in ("success", "failure", "cancelled", ""):
            with self.subTest(dependency="WORKER", status=status):
                self.check_case(False, **(base | {"WORKER": status}))

    def test_preview_job_names_match_matrix(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        match = re.search(r"(?m)^        shard: \[([0-9, ]+)\]$", text)
        self.assertIsNotNone(match)
        shards = [int(value.strip()) for value in match.group(1).split(",")]
        self.assertEqual(shards, list(range(1, len(shards) + 1)))
        self.assertIn(f"--shard=${{{{ matrix.shard }}}}/{len(shards)}", text)
        path = WORKFLOW.parents[2] / "scripts/preview/source.py"
        spec = importlib.util.spec_from_file_location("preview_source", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.REQUIRED_JOBS, {"static", "e2e", "worker", "quick-check"} |
                         {f"unit ({number})" for number in shards})

    def test_multiple_failures(self):
        self.check_case(False, STATIC="failure", UNIT="failure", E2E="failure", WORKER="failure")
        self.check_case(False, STATIC="failure", UNIT="failure", E2E="failure",
                        WORKER="skipped", EVENT="push", REF="refs/heads/main")

    def test_other_events_and_refs(self):
        for event, ref in (("push", "refs/heads/feature"), ("push", "refs/tags/main"),
                           ("push", ""), ("workflow_dispatch", "refs/heads/main"),
                           ("schedule", "refs/heads/main"), ("", "refs/heads/main")):
            for worker in ("success", "skipped"):
                with self.subTest(event=event, ref=ref, worker=worker):
                    self.check_case(False, EVENT=event, REF=ref, WORKER=worker)


if __name__ == "__main__":
    unittest.main(verbosity=2)
