"""信頼済み workflow 用のエントリーポイント。"""

import importlib.util
import json
import os
import sys
from pathlib import Path


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(f"{name}.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


gh = load("github_preview")


def main():
    action = sys.argv[1]
    gh.require(os.environ.get("GITHUB_REF") == "refs/heads/main", "信頼済み main の workflow ではありません")
    if action == "route":
        n = gh.route(gh.event())
        if n is not None:
            gh.output("pr", str(gh.id_number(n)))
        return
    n = gh.id_number(int(os.environ["PREVIEW_PR"]))
    if action == "plan":
        plan = gh.choose(n, gh.event())
        gh.output("plan", gh.encode(plan))
        gh.output("operation", plan["operation"])
        return
    plan = json.loads(os.environ.get("PLAN") or "{}")
    if action == "notify":
        status = os.environ.get("PUBLISH_STATUS", "") if os.environ.get("PREVIEW_ENABLED") == "1" else "disabled"
        gh.notify(n, plan, status, os.environ.get("SMOKE_RESULT", ""), os.environ.get("PREVIEW_ALIAS", ""),
                  os.environ.get("PREVIEW_UNIQUE", ""))
        return
    assets = Path(os.environ["RUNNER_TEMP"]) / "verified-preview-assets"
    if action == "stage":
        gh.stage(n, plan, assets)
    elif action == "publish":
        for key, value in load("cloudflare_preview").publish(gh, n, plan, assets).items():
            gh.output(key, value)
    else:
        raise gh.Reject("未定義の操作です")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # HTTP 本文・署名 URL・プロセス環境を例外ログに含めない。
        message = str(error) if isinstance(error, gh.Reject) else type(error).__name__
        sys.exit(f"PR preview: {message}")
