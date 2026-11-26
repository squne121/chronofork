"""GitHub API で取得した live データを照合する純粋な判定。"""

import re

REPO = "squne121/chronofork"
REPO_ID = 1439901120
FORK = "squne-chatgpt-to-claudecode/chronofork"
FORK_ID = 1465044544
CI = ".github/workflows/ci.yml"
SHA = re.compile(r"[0-9a-f]{40}")


def repository(repo, name, repo_id):
    return bool(repo and repo.get("id") == repo_id and (repo.get("full_name") or "").lower() == name)


def approved_account(user):
    login = ((user or {}).get("login") or "").lower()
    return bool(login and not login.startswith("dependabot") and
                ((not login.endswith("[bot]") and user.get("type") != "Bot") or login == FORK.split('/')[0]))


def approved_pr(pr, live_fork=None):
    head, base = pr["head"], pr["base"]
    if base["ref"] != "main" or not repository(base["repo"], REPO, REPO_ID) or not approved_account(pr["user"]):
        return False
    if repository(head["repo"], REPO, REPO_ID):
        return True
    return (repository(head["repo"], FORK, FORK_ID) and repository(live_fork, FORK, FORK_ID) and
            live_fork.get("fork") is True and repository(live_fork.get("parent"), REPO, REPO_ID))


def current_success(pr, live_fork, workflow, delivered, latest, reopened_at):
    """latest は現行 head/ref/repo に対応する最新 run を live API から取得したもの。"""
    if pr["state"] != "open" or not approved_pr(pr, live_fork):
        return False
    head = pr["head"]
    return (workflow["path"] == CI and workflow["state"] == "active" and latest["path"] == CI and
            latest["workflow_id"] == workflow["id"] and latest["event"] == "pull_request" and
            latest["status"] == "completed" and latest["conclusion"] == "success" and
            delivered["id"] == latest["id"] and delivered["run_attempt"] == latest["run_attempt"] and
            delivered["conclusion"] == "success" and latest["head_branch"] == head["ref"] and
            latest["head_sha"] == head["sha"] and repository(latest["repository"], REPO, REPO_ID) and
            repository(latest["head_repository"], head["repo"]["full_name"].lower(), head["repo"]["id"]) and
            approved_account(latest["actor"]) and approved_account(latest["triggering_actor"]) and
            (not latest["pull_requests"] or any(p["number"] == pr["number"] for p in latest["pull_requests"])) and
            (not reopened_at or latest["created_at"] > reopened_at))


def select_artifact(pr, run, jobs, merge, workflow_blob, trusted_blob, artifacts, limit):
    """正規のジョブ・live merge ref・CI の blob に対応する単一 artifact のみ返す。"""
    run_id, attempt = run["id"], run["run_attempt"]
    head = pr["head"]["sha"]
    good = [job for job in jobs if job["name"] == "quick-check" and job["conclusion"] == "success" and
            job["run_id"] == run_id and job["run_attempt"] == attempt and job["head_sha"] == head and
            sum(s["name"] == "Upload verified PR build" and s["conclusion"] == "success" for s in job["steps"]) == 1]
    if (len(good) != 1 or not SHA.fullmatch(merge["sha"]) or
            [p["sha"] for p in merge["parents"]] != [pr["base"]["sha"], head] or
            workflow_blob["type"] != "file" or workflow_blob["sha"] != trusted_blob):
        return None
    hits = [a for a in artifacts if a["name"] == f"preview-{run_id}-{attempt}"]
    if len(hits) != 1:
        return None
    artifact = hits[0]
    source = artifact.get("workflow_run") or {}
    if (artifact["expired"] or not 0 < artifact["size_in_bytes"] <= limit or not 0 < artifact["id"] < 10**16 or
            source.get("id") != run_id or source.get("repository_id") != REPO_ID or
            source.get("head_repository_id") != pr["head"]["repo"]["id"] or source.get("head_sha") != head or
            not re.fullmatch(r"sha256:[0-9a-f]{64}", artifact.get("digest") or "")):
        return None
    return {"build": merge["sha"], "artifact": artifact["id"], "digest": artifact["digest"]}
