#!/usr/bin/env python3
"""Materialize the current source, without touching deployed paths or the legacy archive."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "core-source"
DENY_NAMES = {".env", ".npmrc", ".pypirc", "id_rsa", "id_ed25519",
              "google-services.json", "key.properties", "local.properties"}
DENY_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".jks", ".keystore"}
DENY_DIRS = {".git", "node_modules", "target", "build", "dist", "__pycache__", ".dart_tool"}

def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)

def files_under(root):
    manifest = {}
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root)
        if path.is_symlink():
            raise RuntimeError(f"Unexpected symlink: {rel}")
        if not path.is_file():
            continue
        if any(part in DENY_DIRS for part in rel.parts) or path.name in DENY_NAMES or (
            path.name.startswith(".env.") and path.name not in {".env.example", ".env.sample"}
        ) or path.suffix.lower() in DENY_SUFFIXES:
            raise RuntimeError(f"Review sensitive/generated path before snapshot: {rel}")
        manifest[rel.as_posix()] = {
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "bytes": path.stat().st_size
        }
    return manifest

def restore(ref, target, web_only):
    with tempfile.TemporaryDirectory(prefix="pitacco-core-") as temp:
        work = Path(temp)
        archive = work / "repo.tar"
        run("git", "-C", str(ROOT), "archive", "--format=tar", "-o", str(archive), ref)
        with tarfile.open(archive) as package:
            package.extractall(work, filter="data")
        archive.unlink()
        env = os.environ.copy()
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        env["PITACCO_WEB_ONLY"] = "1" if web_only else "0"
        run("python3", "-X", "utf8", "revisions/0.12/restore.py", cwd=work, env=env)
        for name in ("web", "android", "docs"):
            if not (work / name).is_dir():
                raise RuntimeError(f"Missing restored directory: {name}")
            shutil.copytree(work / name, target / name)
        for name in ("web/package.json", "web/package-lock.json", "web/src.jsx",
                     "web/src-tauri/src/main.rs", "android/lib/main.dart"):
            if not (target / name).is_file():
                raise RuntimeError(f"Missing required source: {name}")
        return files_under(target)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref", default="HEAD", help="Committed source revision")
    args = parser.parse_args()
    ref = subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", args.ref], text=True).strip()
    if TARGET.exists():
        raise SystemExit("core-source already exists; refusing to overwrite it. Use a clean worktree.")
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg is required to preserve the approved native audio.")
    with tempfile.TemporaryDirectory(prefix="pitacco-core-verify-") as temp:
        tmp = Path(temp)
        native = restore(ref, tmp / "native", False)
        repeat = restore(ref, tmp / "repeat", False)
        if native != repeat:
            changed = sorted(k for k in native.keys() | repeat.keys() if native.get(k) != repeat.get(k))
            raise RuntimeError(f"Non-reproducible native source: {changed}")
        web = restore(ref, tmp / "web-only", True)
        differences = sorted(k for k in native.keys() | web.keys() if native.get(k) != web.get(k))
        shutil.copytree(tmp / "native", TARGET)
        report = {"source_commit": ref, "native_files": len(native), "web_only_files": len(web),
                  "native_repeat_identical": True, "web_only_differences": differences,
                  "files": native}
        (TARGET / "manifest.json").write_text(json.dumps(report, indent=2, sort_keys=True)+"\n", encoding="utf-8")
        print(json.dumps({k: v for k, v in report.items() if k != "files"}, indent=2))
if __name__ == "__main__":
    main()
