"""固定 Worker に対する Workers Previews 操作。資格情報は publish ステップにのみ渡す。"""

import json
import os
import re
import subprocess
import tempfile
import urllib.error
from pathlib import Path

WORKER = "chronofork-pr-previews"
SUBDOMAIN = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")
HERE = Path(__file__).resolve().parent


def urls(result, name, subdomain, require):
    stable_host = f"{name}-{WORKER}.{subdomain}.workers.dev"
    stable = f"https://{stable_host}"
    require(len(stable_host.split('.')[0]) <= 63 and result["preview"]["name"] == name and
            stable in result["preview"]["urls"], "Cloudflare が期待した固定 URL を返しませんでした")
    suffix = re.escape(f"-{WORKER}.{subdomain}.workers.dev")
    unique = {u for u in result["deployment"]["urls"] if isinstance(u, str) and u != stable and
              re.fullmatch(rf"https://[a-z0-9-]{{1,{62 - len(WORKER)}}}{suffix}", u)}
    require(len(unique) == 1, "deployment 固有の workers.dev URL を確認できません")
    return stable + "/chronofork/", unique.pop() + "/chronofork/"


def cloudflare(gh, account, token, path="", missing=False):
    endpoint = f"https://api.cloudflare.com/client/v4/accounts/{account}/workers/workers/{WORKER}{path}"
    try:
        response = json.loads(gh.request(endpoint, token, limit=1024 * 1024))
    except urllib.error.HTTPError as error:
        if missing and error.code == 404:
            details = json.loads(error.read(65536))
            if [e.get("code") for e in details.get("errors", [])] == [10025]:
                return None
        raise gh.Reject(f"Cloudflare API: HTTP {error.code}") from None
    gh.require(response["success"] is True and isinstance(response.get("result"), dict), "Cloudflare の応答を確認できません")
    return response["result"]


def invoke(gh, config, name, account, token, args):
    env = {k: os.environ[k] for k in ("PATH", "HOME")}
    env.update(CI="true", WRANGLER_LOG="error", WRANGLER_SEND_METRICS="false",
               CLOUDFLARE_ACCOUNT_ID=account, CLOUDFLARE_API_TOKEN=token)
    command = ["node", str(HERE / "node_modules/wrangler/bin/wrangler.js"), "preview", *args,
               "--config", str(config), "--name", name, "--worker-name", WORKER]
    result = subprocess.run(command, cwd=config.parent, env=env, stdin=subprocess.DEVNULL, capture_output=True,
                            timeout=240, check=False)
    # CLI 出力は秘匿情報を含み得るので、ログには転載しない。
    gh.require(result.returncode == 0, f"Wrangler preview: exit {result.returncode}")
    return result.stdout


def publish(gh, number, plan, assets):
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    token = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    subdomain = os.environ.get("CLOUDFLARE_WORKERS_SUBDOMAIN", "")
    if not account or not token or not subdomain:
        return {"status": "disabled"}
    gh.require(re.fullmatch(r"[a-f0-9]{32}", account) and SUBDOMAIN.fullmatch(subdomain), "Cloudflare 設定値が不正です")
    gh.require(os.environ.get("GITHUB_REF") == "refs/heads/main", "公開は main の workflow に限定します")
    gh.require(plan["operation"] in ("deploy", "delete"), "許可外の操作です")
    name = f"pr-{gh.id_number(number)}"
    path = f"/previews/{name}"
    gh.require(gh.current_plan(number, plan), "公開または削除の準備中に状態が進みました")
    parent = cloudflare(gh, account, token)
    gh.require(parent.get("name") == WORKER, "専用の既存 Worker を確認できません")
    base = parent.get("previews_base_config") or {}
    gh.require(not base.get("env"), "専用 Worker の Preview base config に bindings または変数があります")
    # Wrangler には親 Worker の初回作成経路があるため、個別 Worker 限定の token も必須。
    with tempfile.TemporaryDirectory(prefix="wrangler-preview-", dir=os.environ["RUNNER_TEMP"]) as temp:
        local = Path(temp)
        config = local / "wrangler.json"
        config_data = {"name": WORKER, "compatibility_date": "2026-11-25", "send_metrics": False, "previews": {}}
        if plan["operation"] == "deploy":
            gh.require(assets.is_dir() and (assets / "chronofork/index.html").is_file(), "検証済み静的ファイルがありません")
            config_data["assets"] = {"directory": str(assets)}
        config.write_text(json.dumps(config_data), encoding="utf-8")
        existing = cloudflare(gh, account, token, path, missing=True)
        if existing is not None:
            gh.require(existing.get("name") == name, "Cloudflare の Preview 名が一致しません")
        gh.require(gh.current_plan(number, plan), "操作直前に PR または CI が進みました")
        if plan["operation"] == "delete":
            if existing is not None:
                invoke(gh, config, name, account, token, ["delete", "--skip-confirmation"])
            gh.require(cloudflare(gh, account, token, path, missing=True) is None and gh.current_plan(number, plan),
                       "削除または PR 状態を確認できません")
            return {"status": "deleted"}
        result = json.loads(invoke(gh, config, name, account, token, ["--json", "--ignore-base-config"]))
        gh.require(gh.current_plan(number, plan), "公開中に PR または CI が進みました。現行版として通知しません")
        alias, unique = urls(result, name, subdomain, gh.require)
        return {"status": "deployed", "alias": alias, "unique": unique, "build": plan["build"]}
