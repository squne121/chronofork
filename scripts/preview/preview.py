"""検証済み PR ビルドの梱包と、ZIP を不信頼データとして扱う検証。"""

import hashlib
import io
import json
import os
import re
import shutil
import stat
import struct
import subprocess
import sys
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXPANDED_LIMIT = 16 * 1024 * 1024
ZIP_LIMIT = 17 * 1024 * 1024  # 非圧縮に近い素材でも ZIP のヘッダーと圧縮オーバーヘッドを収容。
LOCAL_HEADER = struct.Struct("<4s5H3I2H")
FILE_LIMIT = 8 * 1024 * 1024
COUNT_LIMIT = 64
ASSET = re.compile(r"chronofork/assets/[A-Za-z0-9_-]{1,100}\.(?:js|css)")
SHA = re.compile(r"[0-9a-f]{40}")


class Reject(Exception):
    pass


def require(value, reason):
    if not value:
        raise Reject(reason)


def manifest(pr, head, base, build, run, attempt):
    require(all(type(i) is int and 0 < i < 10**16 for i in (pr, run, attempt)), "PR / run / attempt の ID が不正です")
    require(all(isinstance(s, str) and SHA.fullmatch(s) for s in (head, base, build)), "SHA が不正です")
    return dict(version=1, pr=pr, head=head, base=base, build=build, run=run, attempt=attempt)


def artifact_path(name):
    return name == "chronofork/index.html" or ASSET.fullmatch(name) is not None


def check_files(names):
    require("chronofork/index.html" in names and any(n.endswith(".js") for n in names), "index.html または JavaScript がありません")


def package_dist(dist, target, identity):
    require(dist.is_dir() and not dist.is_symlink(), "dist が通常のディレクトリではありません")
    target.mkdir()
    names = set()
    total = 0
    for source in dist.rglob("*"):
        name = f"chronofork/{source.relative_to(dist).as_posix()}"
        info = source.lstat()
        if name == "chronofork/assets" and stat.S_ISDIR(info.st_mode):
            continue
        total += info.st_size
        require(len(names) < COUNT_LIMIT - 3 and total <= EXPANDED_LIMIT - 2048 and 0 < info.st_size <= FILE_LIMIT and
                stat.S_ISREG(info.st_mode) and artifact_path(name) and name.lower() not in names,
                "dist に許可外・特殊・上限外のファイルがあります")
        names.add(name.lower())
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    check_files(names)
    (target / "manifest.json").write_text(json.dumps(identity), encoding="utf-8")


def package():
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())["pull_request"]
    checkout = subprocess.check_output(["git", "show", "-s", "--format=%H %P", "HEAD"], cwd=ROOT, text=True).split()
    build, base, head = os.environ["GITHUB_SHA"], event["base"]["sha"], event["head"]["sha"]
    require(checkout == [build, base, head], "現在の checkout が PR merge SHA とその親に一致しません")
    identity = manifest(event["number"], head, base, build, int(os.environ["GITHUB_RUN_ID"]), int(os.environ["GITHUB_RUN_ATTEMPT"]))
    package_dist(ROOT / "dist", Path(os.environ["RUNNER_TEMP"]) / "preview-upload", identity)


def unique_object(pairs):
    result = dict(pairs)
    require(len(result) == len(pairs), "manifest に重複キーがあります")
    return result


def bounded_decode(payload, method, expected_size, expected_crc):
    if method == zipfile.ZIP_STORED:
        require(len(payload) == expected_size, "非圧縮エントリのサイズが一致しません")
        data = bytes(payload)
    else:
        decoder = zlib.decompressobj(-zlib.MAX_WBITS)
        data = decoder.decompress(payload, expected_size + 1)
        require(decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail, "DEFLATE の終端または展開サイズが不正です")
    require(len(data) == expected_size and zlib.crc32(data) == expected_crc, "展開後サイズまたは CRC が一致しません")
    return data


def member_data(raw, item, end):
    offset = item.header_offset
    require(0 <= offset and offset + LOCAL_HEADER.size <= end, "ZIP のローカルヘッダーが範囲外です")
    signature, _, flags, method, _, _, crc, compressed, expanded, name_size, extra_size = LOCAL_HEADER.unpack_from(raw, offset)
    name_start = offset + LOCAL_HEADER.size
    start = name_start + name_size + extra_size
    require(signature == b"PK\x03\x04" and flags == item.flag_bits and method == item.compress_type and
            start + item.compress_size <= end and raw[name_start:name_start + name_size] == item.filename.encode("ascii"),
            "ZIP のローカルヘッダーまたはデータ範囲が不正です")
    if not flags & 0x08:
        require((crc, compressed, expanded) == (item.CRC, item.compress_size, item.file_size), "ZIP ヘッダー間で CRC またはサイズが不一致です")
    return bounded_decode(memoryview(raw)[start:start + item.compress_size], method, item.file_size, item.CRC)


def validate_zip(raw, digest, expected, destination):
    """照合がすべて成功した成果物の静的ファイルだけを、新規の出力先へ書き込む。"""
    require(len(raw) <= ZIP_LIMIT and "sha256:" + hashlib.sha256(raw).hexdigest() == digest, "ZIP のサイズまたは digest が不一致です")
    try:
        return validate_entries(raw, expected, destination)
    except (zipfile.BadZipFile, zlib.error, ValueError, TypeError, RuntimeError, EOFError) as error:
        raise Reject("ZIP または manifest が不正です") from error


def validate_entries(raw, expected, destination):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries = archive.infolist()
        require(0 < len(entries) <= COUNT_LIMIT, "ZIP のエントリ数が上限外です")
        names = set()
        total = 0
        for item in entries:
            name = item.orig_filename
            total += item.file_size
            kind = stat.S_IFMT(item.external_attr >> 16)
            directory = name in ("chronofork/", "chronofork/assets/")
            require(name == item.filename and name.lower() not in names and total <= EXPANDED_LIMIT and
                    item.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) and not item.flag_bits & ~0x080e and
                    ((directory and kind in (0, stat.S_IFDIR) and item.file_size == 0) or
                     ((name == "manifest.json" or artifact_path(name)) and kind in (0, stat.S_IFREG) and
                      not item.external_attr & 0x10 and 0 < item.file_size <= (2048 if name == "manifest.json" else FILE_LIMIT))),
                    "ZIP に許可外・重複・特殊・上限外のエントリがあります")
            names.add(name.lower())
        check_files(names)
        require("manifest.json" in names, "manifest がありません")
        # ローカルヘッダーから各データ範囲の重なりを拒否し、展開時にも申告サイズを強制する。
        ordered = sorted(entries, key=lambda item: item.header_offset)
        ends = [item.header_offset for item in ordered[1:]] + [archive.start_dir]
        contents = {item.filename: member_data(raw, item, end) for item, end in zip(ordered, ends, strict=True)}
        actual = json.loads(contents.pop("manifest.json"), object_pairs_hook=unique_object)
        require(json.dumps(actual, sort_keys=True) == json.dumps(expected, sort_keys=True), "manifest の PR / SHA / run / attempt が一致しません")
    destination.mkdir()
    for name, data in contents.items():
        if not artifact_path(name):
            continue
        output = destination / name
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("xb") as file:
            file.write(data)


if __name__ == "__main__":
    try:
        require(sys.argv[1:] == ["package"], "未定義の操作です")
        package()
    except (Reject, OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        message = str(error) if isinstance(error, Reject) else type(error).__name__
        sys.exit(f"PR preview: {message}")
