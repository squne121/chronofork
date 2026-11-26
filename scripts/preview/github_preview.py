"""信頼済み main から GitHub の PR・CI・artifact を照合する。"""

import hashlib
import importlib.util
import json
import os
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


source = load("source")
preview = load("preview")
REPO = source.REPO
Reject = preview.Reject
require = preview.require
MARKER = "<!-- chronofork-workers-preview:v1 -->"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


HTTP = urllib.request.build_opener(NoRedirect())


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def request(url, token=None, method="GET", data=None, limit=preview.ZIP_LIMIT):
    headers = {"User-Agent": "workers-preview-ci", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, None if data is None else encode(data).encode(), headers, method=method)
    with HTTP.open(req, timeout=40) as response:
        body = response.read(limit + 1)
    require(len(body) <= limit, "HTTP レスポンスが上限を超えました")
    return body


def url(path, query=None):
    return f"https://api.github.com/repos/{path}" + ("?" + urllib.parse.urlencode(query) if query else "")


def github(path, query=None, method="GET", data=None):
    try:
        return json.loads(request(url(path, query), os.environ["GH_TOKEN"], method, data))
    except urllib.error.HTTPError as error:
        raise Reject(f"GitHub API: HTTP {error.code}") from None


def pages(path, key=None, **query):
    for page in range(1, 11):
        data = github(path, dict(query, per_page=100, page=page))
        items = data if key is None else data[key]
        yield from items
        if len(items) < 100:
            return
    raise Reject("GitHub API のページ上限に到達しました")


def id_number(value):
    require(type(value) is int and 0 < value < 10**16, "GitHub ID が不正です")
    return value


def event():
    return json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())


def output(key, value):
    require("\r" not in value and "\n" not in value, "出力に改行が含まれます")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as file:
        file.write(f"{key}={value}\n")


def pr(number):
    return github(f"{REPO}/pulls/{id_number(number)}")


def fork_for(pull):
    if source.repository(pull["head"]["repo"], source.FORK, source.FORK_ID):
        return github(source.FORK)
    return None


def approved(pull):
    return source.approved_pr(pull, fork_for(pull))


def from_head(run, pull):
    head = pull["head"]
    return (run["head_sha"] == head["sha"] and run["head_branch"] == head["ref"] and
            (run.get("head_repository") or {}).get("id") == head["repo"]["id"] and
            (not run["pull_requests"] or any(p["number"] == pull["number"] for p in run["pull_requests"])))


def managed_comment(number):
    comments = [c for c in pages(f"{REPO}/issues/{id_number(number)}/comments")
                if c["user"]["login"] == "github-actions[bot]" and (c["body"] or "").startswith(MARKER)]
    require(len(comments) <= 1, "プレビュー管理コメントが重複しています")
    return comments[0] if comments else None


def past_target(payload, pull):
    if payload["action"] not in ("edited", "closed", "reopened"):
        return False
    previous_base = payload.get("changes", {}).get("base", {}).get("ref", {}).get("from")
    if payload["action"] == "edited" and previous_base == "main":
        old_target = dict(pull, base=dict(pull["base"], ref="main"))
        if approved(old_target):
            return True
    # 管理済み PR のみ。PR 作者のコメントや本文にある marker は信頼しない。
    return managed_comment(pull["number"]) is not None


def route(payload):
    if not source.repository(payload["repository"], REPO, source.REPO_ID):
        return None
    if "pull_request" in payload:
        pull = pr(payload["pull_request"]["number"])
        return pull["number"] if approved(pull) or past_target(payload, pull) else None
    delivered = payload["workflow_run"]
    if delivered["event"] != "pull_request" or not any(source.repository(delivered.get("head_repository"), name, repo_id)
            for name, repo_id in ((REPO, source.REPO_ID), (source.FORK, source.FORK_ID))):
        return None
    run = github(f"{REPO}/actions/runs/{id_number(delivered['id'])}")
    if run["path"] != source.CI or not source.repository(run["repository"], REPO, source.REPO_ID):
        return None
    owner = delivered["head_repository"]["full_name"].split("/")[0]
    candidates = pages(f"{REPO}/pulls", state="open", base="main", head=f"{owner}:{run['head_branch']}")
    matches = [p["number"] for p in candidates if approved(p) and from_head(run, p)]
    return matches[0] if len(matches) == 1 else None


def snapshot(number):
    pull = pr(number)
    live_fork = fork_for(pull)
    if not source.repository(pull["base"]["repo"], REPO, source.REPO_ID):
        return {"state": "ineligible"}, None
    head, base = pull["head"]["sha"], pull["base"]["sha"]
    require(source.SHA.fullmatch(head) and source.SHA.fullmatch(base), "PR の SHA が不正です")
    current = {"state": "closed" if pull["state"] == "closed" else "waiting", "head": head, "base": base}
    if not source.approved_pr(pull, live_fork):
        current.update(state="out_of_scope", target=pull["base"]["ref"], closed_at=pull.get("closed_at"))
        return current, None
    if current["state"] == "closed":
        current["closed_at"] = pull["closed_at"]
        return current, None
    timeline = pages(f"{REPO}/issues/{number}/timeline")
    reopened = max((e["created_at"] for e in timeline if e["event"] == "reopened"), default="")
    current["reopened"] = reopened
    workflow = github(f"{REPO}/actions/workflows/ci.yml")
    require(workflow["path"] == source.CI and workflow["state"] == "active", "既定 CI が無効です")
    runs = pages(f"{REPO}/actions/workflows/{id_number(workflow['id'])}/runs", "workflow_runs", event="pull_request", head_sha=head)
    latest = max((r for r in runs if from_head(r, pull)), key=lambda r: r["run_number"], default=None)
    if latest is None:
        return current, None
    latest = github(f"{REPO}/actions/runs/{id_number(latest['id'])}")
    current.update(run=id_number(latest["id"]), attempt=id_number(latest["run_attempt"]))
    if source.current_success(pull, live_fork, workflow, latest, latest, reopened):
        current["state"] = "success"
        return current, (pull, latest)
    if latest["status"] == "completed":
        current["state"] = "rejected" if latest["conclusion"] == "success" else "failed"
    return current, None


def identity(number, context):
    pull, run = context
    run_id, attempt = run["id"], run["run_attempt"]
    merge = github(f"{REPO}/commits/pull/{number}/merge")
    require(source.SHA.fullmatch(merge["sha"]), "merge ref の SHA が不正です")
    blob = github(f"{REPO}/contents/{source.CI}", {"ref": merge["sha"]})
    expected = subprocess.check_output(["git", "hash-object", str(preview.ROOT / source.CI)], cwd=preview.ROOT, text=True).strip()
    jobs = pages(f"{REPO}/actions/runs/{run_id}/attempts/{attempt}/jobs", "jobs")
    artifacts = pages(f"{REPO}/actions/runs/{run_id}/artifacts", "artifacts", name=f"preview-{run_id}-{attempt}")
    return source.select_artifact(pull, run, jobs, merge, blob, expected, artifacts, preview.ZIP_LIMIT)


def choose(number, payload):
    current, context = snapshot(number)
    plan = {"current": current, "operation": "none"}
    if "pull_request" in payload:
        closing = current["state"] == "closed" and payload["action"] == "closed"
        leaving = (current["state"] == "out_of_scope" and payload["action"] in ("edited", "closed") and
                   past_target(payload, pr(number)))
        if closing or leaving:
            plan["operation"] = "delete"
    elif context and payload["action"] == "completed" and "workflow_run" in payload:
        run = payload["workflow_run"]
        if (run["id"], run["run_attempt"], run["conclusion"]) == (current["run"], current["attempt"], "success"):
            plan["operation"] = "inspect"
            artifact = identity(number, context)
            if artifact:
                plan.update(operation="deploy", **artifact)
    return plan


def current_plan(number, plan):
    current, context = snapshot(number)
    if current != plan["current"]:
        return False
    if plan["operation"] == "delete":
        return current["state"] in ("closed", "out_of_scope")
    if plan["operation"] != "deploy" or context is None:
        return False
    return (identity(number, context) == {key: plan[key] for key in ("build", "artifact", "digest")} and
            snapshot(number)[0] == current)


def download(artifact):
    try:
        return request(url(f"{REPO}/actions/artifacts/{id_number(artifact)}/zip"), os.environ["GH_TOKEN"])
    except urllib.error.HTTPError as error:
        require(error.code == 302, f"artifact のダウンロード: HTTP {error.code}")
        signed = error.headers.get("Location", "")
    parsed = urllib.parse.urlsplit(signed)
    require(parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password, "artifact の署名 URL が不正です")
    return request(signed)  # 別オリジンへ GitHub token を渡さない。


def stage(number, plan, destination):
    require(current_plan(number, plan), "PR または CI が進んだため成果物を取得しません")
    current = plan["current"]
    expected = preview.manifest(number, current["head"], current["base"], plan["build"], current["run"], current["attempt"])
    preview.validate_zip(download(plan["artifact"]), plan["digest"], expected, destination)


def notification(number, plan, status, smoke, alias, unique, previous):
    current, context = snapshot(number)
    if current["state"] == "ineligible":
        return None, current
    same = current == plan.get("current")
    tag = f"<!-- snapshot:{hashlib.sha256(encode(current).encode()).hexdigest()} -->"
    lines = [MARKER, tag, "### PR 試遊（Workers Previews）", ""]
    status = status if same or status == "disabled" else ""
    if status == "disabled":
        message = "未設定のため公開・削除・公開後 smoke は未実施です。"
    elif current["state"] in ("closed", "out_of_scope"):
        reason = "閉鎖済み" if current["state"] == "closed" else "公開対象外"
        deletion = "対象 Preview の削除を確認しました。" if status == "deleted" else "対象 Preview の削除は未確認です。"
        message = f"{reason}。{deletion}"
    elif status == "deployed" and context and current_plan(number, plan):
        message = "現行 HEAD の公開後 smoke: PASS。" if smoke == "success" else "公開後 smoke は失敗または未実施です。検証済みではありません。"
    elif plan.get("operation") == "none" and previous and tag in previous and same:
        return None, current  # 遅延イベントは同じ snapshot の確定通知を壊さない。
    else:
        message = "現行 HEAD の公開は未確認です。CI の進行、失敗、または成果物・公開処理の結果を確認してください。"
    lines.extend([message, "", f"- PR head: `{current['head']}`", f"- base: `{current['base']}`"])
    lines.append(f"- CI: {current['state']}" + (f" / run `{current['run']}` / attempt `{current['attempt']}`" if "run" in current else ""))
    if status == "deployed" and message.startswith(("現行 HEAD", "公開後 smoke")):
        require(all(re.fullmatch(r"https://[a-z0-9-]{1,63}\.[a-z0-9-]{1,63}\.workers\.dev/chronofork/", u) for u in (alias, unique)), "通知 URL が不正です")
        lines.extend([f"- 実 build SHA: `{plan['build']}`", f"- artifact ID: `{plan['artifact']}`", f"- 固定 URL: {alias}", f"- deployment 固有 URL: {unique}"])
    else:
        lines.append("- 実 build SHA・現行公開 URL: 未確認")
    return "\n".join(lines), current


def notify(number, plan, status, smoke, alias, unique):
    old = managed_comment(number)
    body, state = notification(number, plan, status, smoke, alias, unique, old["body"] if old else None)
    if body is None:
        return
    require(snapshot(number)[0] == state, "通知直前に PR または CI が更新されました")
    if old:
        github(f"{REPO}/issues/comments/{id_number(old['id'])}", method="PATCH", data={"body": body})
    else:
        github(f"{REPO}/issues/{number}/comments", method="POST", data={"body": body})
