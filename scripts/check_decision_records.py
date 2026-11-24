"""Dependency-free check of the canonical Markdown decision register."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import unittest


REGISTER = "docs/decisions/adopted-decisions.md"
INBOX = "docs/decisions-inbox"
ID = re.compile(r"DEC-([0-9]{3,})")
KEY = re.compile(r"DEC-[0-9]{3,}(?:/(?:DEC-)?[0-9]{3,})*")
SEPARATOR = re.compile(r":?-{3,}:?")


def canonical_id(value):
    match = ID.fullmatch(value)
    if not match or int(match[1]) == 0 or value != f"DEC-{int(match[1]):03d}":
        raise ValueError(f"noncanonical decision ID: {value}")
    return value


def parse_register(content):
    """Read definition rows (including legacy grouped IDs), not prose references."""
    records, aliases, history = {}, {}, set()
    history_targets = []
    legacy_aliases = {}
    table = None
    columns = 0
    lines = content.splitlines()
    for number, line in enumerate(lines, 1):
        stripped = line.strip()
        # Historical tables contain blank separators between definition rows.
        if not stripped:
            continue
        if not stripped.startswith("|"):
            if re.search(r"#[0-9]+.*DEC-[0-9]+→[0-9]+", stripped):
                history.add(("legacy mapping note", stripped))
                pr = re.search(r"#[0-9]+", stripped)[0]
                for old_id, new_id in re.findall(r"DEC-([0-9]+)→([0-9]+)", stripped):
                    key = (pr, canonical_id("DEC-" + old_id))
                    target = canonical_id("DEC-" + new_id)
                    if key in legacy_aliases and legacy_aliases[key] != target:
                        raise ValueError(f"conflicting legacy mapping {key}")
                    legacy_aliases[key] = target
            table = None
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        first = cells[0].removeprefix("**").removesuffix("**")
        if first == "ID":
            if cells not in (["ID", "内容", "状態"], ["ID", "内容", "状態・適用範囲"],
                             ["ID", "決定・方向性", "分類・適用範囲"], ["ID", "内容"]):
                raise ValueError(f"line {number}: invalid definition header")
            table = "definitions"
            columns = len(cells)
            continue
        if cells == ["出典PR", "旧ID", "統合ID", "内容"]:
            table = "aliases"
            continue
        if all(SEPARATOR.fullmatch(cell) for cell in cells):
            continue
        # Recognize an unrelated Markdown table, even after a blank line.
        if number < len(lines):
            next_line = lines[number].strip()
            if next_line.startswith("|") and all(
                    SEPARATOR.fullmatch(cell.strip())
                    for cell in next_line.strip("|").split("|")):
                if cells in (["旧記述", "置換する決定", "扱い"],
                             ["旧記述", "置換先"]):
                    table = "history"
                else:
                    if any(label in cell for cell in cells
                           for label in ("旧ID", "統合ID", "出典PR", "旧記述")):
                        raise ValueError(f"line {number}: invalid mapping header")
                    table = "other"
                continue
        if table in ("other", None):
            # Unknown table formats cannot safely distinguish references from mappings.
            if "DEC-" in stripped:
                raise ValueError(f"line {number}: decision or mapping in unknown table")
            continue
        if table == "history":
            if (len(cells) not in (2, 3) or not all(cells)
                    or re.search(r"#[0-9]+", first)):
                raise ValueError(f"line {number}: invalid replacement history")
            target = cells[1]
            if target != "未決":
                match = re.fullmatch(r"(DEC-[0-9]+(?:/(?:DEC-)?[0-9]+)*)(?: G-[0-9]+)?", target)
                if not match:
                    raise ValueError(f"line {number}: invalid replacement target")
                history_targets.extend(canonical_id("DEC-" + part.removeprefix("DEC-"))
                                       for part in match[1].split("/"))
            history.add(tuple(cells))
            continue
        if KEY.fullmatch(first):
            if table != "definitions":
                raise ValueError(f"line {number}: DEC definition outside an ID table")
            if len(cells) != columns or not all(cells):
                raise ValueError(f"line {number}: invalid decision columns")
            for part in first.split("/"):
                decision = canonical_id("DEC-" + part.removeprefix("DEC-"))
                if decision in records:
                    raise ValueError(f"line {number}: duplicate {decision}")
                records[decision] = stripped
            continue
        if table == "definitions":
            raise ValueError(f"line {number}: invalid decision definition: {first}")
        if table == "aliases":
            if (len(cells) != 4 or not re.fullmatch(r"#[1-9][0-9]*", first)
                    or not ID.fullmatch(cells[1]) or not ID.fullmatch(cells[2])
                    or cells[1] == cells[2] or not cells[3]):
                raise ValueError(f"line {number}: invalid source-PR/old-ID/new-ID mapping")
            key = (first, canonical_id(cells[1]))
            target = canonical_id(cells[2])
            if key in aliases:
                raise ValueError(f"line {number}: duplicate source mapping {key}")
            aliases[key] = target
    if not records:
        raise ValueError("no DEC definitions found")
    for key, target in aliases.items():
        if target not in records:
            raise ValueError(f"mapping {key} targets missing {target}")
    for key, target in legacy_aliases.items():
        if key in aliases and aliases[key] != target:
            raise ValueError(f"conflicting legacy mapping {key}")
        if target not in records:
            raise ValueError(f"mapping {key} targets missing {target}")
    for target in history_targets:
        if target not in records:
            raise ValueError(f"replacement targets missing {target}")
    return records, aliases, history


def validate(current, baseline=None, source=None):
    records, aliases, history = parse_register(current)
    if baseline is None:
        return len(records), [], []
    old, old_aliases, old_history = parse_register(baseline)
    if old_history - history:
        raise ValueError("published replacement history removed or changed")
    missing = sorted(old.keys() - records.keys())
    if missing:
        raise ValueError("published IDs removed: " + ", ".join(missing))
    for key, target in old_aliases.items():
        if aliases.get(key) != target:
            raise ValueError(f"published source mapping removed or changed: {key}")
    added = sorted(records.keys() - old.keys())
    highest = max(int(key.removeprefix("DEC-")) for key in old)
    reused = [key for key in added if int(key.removeprefix("DEC-")) <= highest]
    if reused:
        raise ValueError("new definitions reuse old ID space: " + ", ".join(reused))
    # source is (target branch, source branch, same repository).
    if source is not None and source[0] == "main" and current != baseline:
        if source[1] != INBOX or not source[2]:
            raise ValueError(f"decision register updates to main must use {INBOX}")
    changed = sorted(key for key in old if records[key] != old[key])
    return len(records), added, changed


def git_baseline(sha):
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or sha == "0" * 40:
        raise ValueError("invalid or missing event base SHA")
    exists = subprocess.run(["git", "cat-file", "-e", sha + "^{commit}"],
                            capture_output=True, check=False)
    if exists.returncode:
        # Usually the merge/squash parent is already present with fetch-depth 2.
        subprocess.run(["git", "fetch", "--no-tags", "--depth=1", "origin", sha],
                       check=True)
    return subprocess.check_output(["git", "show", f"{sha}:{REGISTER}"],
                                   text=True, encoding="utf-8")


def github_baseline():
    with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as stream:
        event = json.load(stream)
    if os.environ["GITHUB_EVENT_NAME"] == "pull_request":
        pr = event["pull_request"]
        base, head = pr["base"], pr["head"]
        sha = base["sha"]
        parent = subprocess.check_output(["git", "rev-parse", "HEAD^1"],
                                         text=True).strip()
        if parent != sha:
            raise ValueError("PR merge checkout does not match event base; rerun on current base")
        return git_baseline(sha), (base["ref"], head["ref"],
                                   base["repo"]["id"] == head["repo"]["id"])
    if os.environ["GITHUB_EVENT_NAME"] == "push":
        return git_baseline(event["before"]), None
    raise ValueError("unsupported GitHub event")


HEADER = "| ID | 内容 | 状態 |\n|---|---|---|\n"
ALIASES = "\n| 出典PR | 旧ID | 統合ID | 内容 |\n|---|---|---|---|\n"


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.base = HEADER + "| DEC-002/003 | legacy | 採用 |\n| **DEC-075** | main | 採用 |\n"
        self.new = self.base + "| DEC-076 | addition | 採用 |\n"
        self.source = ("main", INBOX, True)

    def test_grouped_bold_and_reference_rows(self):
        text = self.new + "\n| 旧記述 | 置換先 |\n|---|---|\n| DEC-003: 旧案 | DEC-076 |\n"
        self.assertEqual(validate(text, self.base, self.source), (4, ["DEC-076"], []))

    def test_blank_lines_in_existing_tables(self):
        text = self.base + "\n| DEC-076 | addition | 採用 |\n"
        self.assertEqual(validate(text, self.base, self.source), (4, ["DEC-076"], []))

    def test_duplicate_legacy_id(self):
        with self.assertRaisesRegex(ValueError, "duplicate DEC-003"):
            validate(self.new + "| DEC-003 | duplicate | 採用 |\n")

    def test_duplicate_grouped_id(self):
        with self.assertRaisesRegex(ValueError, "duplicate DEC-076"):
            validate(self.new + "| DEC-077/076 | duplicate | 採用 |\n")

    def test_removed_published_id(self):
        with self.assertRaisesRegex(ValueError, "published IDs removed: DEC-075"):
            validate(self.new.replace("| **DEC-075** | main | 採用 |\n", ""), self.base)

    def test_reused_gap(self):
        with self.assertRaisesRegex(ValueError, "reuse old ID space"):
            validate(self.base + "| DEC-004 | gap | 採用 |\n", self.base)

    def test_malformed_or_stray_definition(self):
        for row in ("| DEC-76 | bad | 採用 |\n", "| DEC-0076 | bad | 採用 |\n",
                    "| DEC-000 | bad | 採用 |\n", "\nordinary prose\n| DEC-076 | stray | 採用 |\n"):
            with self.subTest(row=row), self.assertRaises(ValueError):
                validate(self.base + row)

    def test_unknown_table_rejects_malformed_ids(self):
        for row in ("| DEC-76 | bad |\n", "| DEC-000 | bad |\n",
                    "| description | DEC-0076 |\n"):
            with self.subTest(row=row), self.assertRaises(ValueError):
                validate(self.base + "\n| 項目 | 内容 |\n|---|---|\n" + row)
        self.assertEqual(validate(self.base + "\n| 項目 | 内容 |\n|---|---|\n"
                                  "| 方針 | 説明 |\n")[0], 3)

    def test_stray_mapping_and_natural_reference(self):
        for text in ("\n本文\n| #125 | DEC-075 | DEC-999 | 対応 |\n",
                     "\n| PR | 元 | 先 | 内容 |\n|---|---|---|---|\n"
                     "| PR 125 | DEC-075 | DEC-999 | 対応 |\n",
                     "\n| 旧記述 | 後継 |\n|---|---|\n| old | DEC-999 |\n"):
            with self.subTest(text=text), self.assertRaises(ValueError):
                validate(self.base + text)
        text = self.base + "\n| 項目 | 説明 |\n|---|---|\n| 方針 | DEC-075 を参照 |\n"
        with self.assertRaisesRegex(ValueError, "unknown table"):
            validate(text)

    def test_legacy_mapping_note_retained(self):
        note = "#125で以前に行ったDEC-075→129、DEC-079→130の再採番は維持する。\n"
        base = self.base + "| DEC-129 | target | 採用 |\n| DEC-130 | target | 採用 |\n"
        with self.assertRaisesRegex(ValueError, "history removed"):
            validate(base, base + note)
        with self.assertRaisesRegex(ValueError, "conflicting legacy mapping"):
            validate(base + note + ALIASES + "| #125 | DEC-075 | DEC-130 | bad |\n")

    def test_unknown_grouped_ids(self):
        for ref in ("DEC-", "DEC-075/76", "DEC-075/999", "DEC-075_invalid"):
            first = "pull request 125" if ref.endswith("999") else "方針"
            with self.subTest(ref=ref), self.assertRaises(ValueError):
                validate(self.base + "\n| 項目 | 関連決定 |\n|---|---|\n"
                         + f"| {first} | {ref} |\n")

    def test_unknown_table_mapping_in_other_cells(self):
        for row in ("| 再採番 | #125: DEC-075 → DEC-999 |\n",
                    "| 再採番 | #125 | DEC-075/999 |\n",
                    "| 125 | DEC-075 → DEC-999 |\n",
                    "| 方針 | DEC-075.5 |\n"):
            with self.subTest(row=row), self.assertRaises(ValueError):
                validate(self.base + "\n| 項目 | 対応 |\n|---|---|\n" + row)

    def test_definition_header_and_column_count(self):
        for extra in ("\n| ID | 注意 |\n|---|---|\n| DEC-999 | reference |\n",
                      "| DEC-076 | missing state |\n"):
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                validate(self.base + extra)

    def test_replacement_history_validation_and_retention(self):
        header = "\n| 旧記述 | 置換する決定 | 扱い |\n|---|---|---|\n"
        row = "| DEC-002: old | DEC-003 | replaced |\n"
        baseline = self.base + header + row
        self.assertEqual(validate(baseline)[0], 3)
        with self.assertRaisesRegex(ValueError, "history removed"):
            validate(self.base, baseline)
        for bad in ("| DEC-002: old | DEC-999 | replaced |\n",
                    "| #125 / DEC-002 | DEC-003 | mapping |\n"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                validate(self.base + header + bad)

    def test_misnamed_alias_header_is_rejected(self):
        for header in ("| 出典PR | 旧ID | 新ID | 内容 |",
                       "| 出典PR | 旧ID | 統合ID | 備考 |"):
            with self.subTest(header=header), self.assertRaisesRegex(ValueError, "header"):
                validate(self.base + "\n" + header + "\n|---|---|---|---|\n"
                         "| #125 | DEC-075 | DEC-076 | collision |\n")

    def test_alias_rejects_malformed_target(self):
        for target in ("DEC-76", "DEC-000", "DEC-0076", "DEC-999"):
            with self.subTest(target=target), self.assertRaises(ValueError):
                validate(self.new + ALIASES + f"| #125 | DEC-075 | {target} | bad |\n")

    def test_alias_must_target_defined_id(self):
        with self.assertRaisesRegex(ValueError, "targets missing DEC-077"):
            validate(self.new + ALIASES + "| #125 | DEC-075 | DEC-077 | collision |\n")

    def test_alias_duplicate_and_retarget(self):
        row = "| #125 | DEC-075 | DEC-076 | collision |\n"
        with self.assertRaisesRegex(ValueError, "duplicate source mapping"):
            validate(self.new + ALIASES + row + row)
        base = self.new + ALIASES + row
        with self.assertRaisesRegex(ValueError, "source mapping removed or changed"):
            validate(self.new + ALIASES + row.replace("DEC-076", "DEC-003"), base)

    def test_alias_is_not_definition_and_cannot_be_removed(self):
        text = self.new + ALIASES + "| #125 | DEC-075 | DEC-076 | collision |\n"
        self.assertEqual(validate(text)[0], 4)
        with self.assertRaisesRegex(ValueError, "source mapping removed or changed"):
            validate(self.new, text)

    def test_single_inbox_same_repository(self):
        for source in (("main", "docs/other", True), ("main", INBOX, False)):
            with self.subTest(source=source), self.assertRaisesRegex(ValueError, "must use"):
                validate(self.new, self.base, source)
        self.assertEqual(validate(self.new, self.base, self.source)[1], ["DEC-076"])

    def test_unrelated_pr_and_existing_change_report(self):
        self.assertEqual(validate(self.base, self.base, ("main", "feat/other", True))[1], [])
        self.assertEqual(validate(self.base.replace("| main |", "| updated |"),
                                  self.base, self.source)[2], ["DEC-075"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", default=REGISTER)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--base-file")
    group.add_argument("--github", action="store_true")
    group.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        suite = unittest.defaultTestLoader.loadTestsFromTestCase(GuardTests)
        return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1
    try:
        current = Path(args.file).read_text(encoding="utf-8")
        baseline, source = None, None
        if args.github:
            baseline, source = github_baseline()
        elif args.base_file:
            baseline = Path(args.base_file).read_text(encoding="utf-8")
        total, added, changed = validate(current, baseline, source)
        print(f"DEC guard PASS: {total} unique IDs; added={','.join(added) or '-'}")
        if changed:
            print("Review changed published decisions: " + ", ".join(changed))
        return 0
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as error:
        print(f"DEC guard FAILED: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
