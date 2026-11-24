"""Prepare a host environment from hash-bound offline artifacts; never fetch code."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import sysconfig
import zipfile


def checked(path: Path, digest: str, size: int | None = None) -> None:
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("Artifact is not a regular file")
    if size is not None and path.stat().st_size != size:
        raise RuntimeError("Artifact byte length differs from its manifest")
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != digest.lower():
        raise RuntimeError("Artifact SHA-256 differs from its manifest")


def normalized(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def verify_installed(root: Path, cache: Path, wheels: list[dict], bootstrap: Path) -> None:
    site = root / "venv" / "Lib" / "site-packages"
    allowed = set()
    archives = [cache / "wheels" / item["filename"] for item in wheels] + [bootstrap]
    for path in archives:
        with zipfile.ZipFile(path) as archive:
            for item in archive.infolist():
                if item.is_dir():
                    continue
                name = item.filename
                parts = PurePosixPath(name).parts
                if not parts or any(part in ("..", "") for part in parts) or "\\" in name or ":" in name:
                    raise RuntimeError("Unsafe wheel payload path")
                if parts[0].endswith(".data"):
                    if len(parts) < 3 or parts[1] not in ("purelib", "platlib"):
                        continue
                    name = "/".join(parts[2:])
                allowed.add(name)
                if name.endswith(".dist-info/RECORD"):
                    continue
                with archive.open(item) as stream:
                    expected = hashlib.file_digest(stream, "sha256").hexdigest()
                checked(site / name, expected, item.file_size)
    for path in site.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(site).as_posix()
        if "__pycache__" in PurePosixPath(relative).parts and path.suffix == ".pyc":
            continue
        if relative in allowed:
            continue
        parts = PurePosixPath(relative).parts
        if len(parts) == 2 and parts[0].endswith(".dist-info") and parts[1] in ("INSTALLER", "REQUESTED", "direct_url.json"):
            continue
        raise RuntimeError("Unrecorded file in the prepared Python environment")


def main() -> None:
    spec = json.loads(sys.stdin.buffer.read(16385).decode("utf-8"))
    root = Path(spec["directory"]).resolve()
    cache = Path(spec["artifactDirectory"]).resolve()
    manifest_path = cache / spec["manifestName"]
    checked(manifest_path, spec["manifestSha256"])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    bootstrap = manifest["existingPythonBootstrap"]
    if ".".join(map(str, sys.version_info[:3])) != bootstrap["version"]:
        raise RuntimeError("Base Python version does not match this artifact set")
    if sys.platform != "win32" or sys.maxsize <= 2**32 or "win_amd64" not in manifest["python"]:
        raise RuntimeError("This artifact set requires 64-bit Windows; select reviewed artifacts for this machine")
    candidates = list((Path(sysconfig.get_path("stdlib")) / "ensurepip" / "_bundled").glob("pip-*.whl"))
    if len(candidates) != 1:
        raise RuntimeError("Base Python must provide exactly one ensurepip wheel")
    checked(candidates[0], bootstrap["venvEnsurepipWheelSha256"])
    source = manifest["source"]
    archive_path = cache / "source.zip"
    checked(archive_path, source["archiveSha256"], source["archiveBytes"])
    wheels = manifest["wheels"]
    if len(wheels) != manifest["wheelCount"] or not wheels:
        raise RuntimeError("Artifact count differs from its manifest")
    approved = {}
    for wheel in wheels:
        name = wheel["filename"]
        if Path(name).name != name or "\\" in name or ":" in name:
            raise RuntimeError("Wheel filename must be a basename")
        checked(cache / "wheels" / name, wheel["sha256"], wheel["bytes"])
        key = normalized(wheel["name"])
        if key in approved:
            raise RuntimeError("Duplicate wheel distribution")
        approved[key] = (wheel["version"], wheel["sha256"])
    locked = {}
    for line in (cache / "requirements.lock.txt").read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([A-Za-z0-9_.-]+)==(\S+) --hash=sha256:([0-9a-f]{64})", line)
        if match is None or normalized(match[1]) in locked:
            raise RuntimeError("Lock requires one exact version and hash per distribution")
        locked[normalized(match[1])] = (match[2], match[3])
    if locked != approved:
        raise RuntimeError("Offline lock does not match the artifact manifest")
    prefix = "ComfyUI-" + source["commit"] + "/"
    with zipfile.ZipFile(archive_path) as archive:
        entries = []
        names = set()
        for item in archive.infolist():
            name = item.filename
            path = PurePosixPath(name)
            mode = item.external_attr >> 16
            if "\\" in name or ":" in name or path.is_absolute() or ".." in path.parts or not name.startswith(prefix):
                raise RuntimeError("Unsafe source archive path")
            if mode and stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
                raise RuntimeError("Source archive links and special files are forbidden")
            if not item.is_dir():
                if name in names:
                    raise RuntimeError("Duplicate source archive path")
                names.add(name)
                entries.append(item)
        if (root / "installation.json").exists():
            marker = json.loads((root / "installation.json").read_text(encoding="utf-8"))
            if marker["manifestSha256"] != spec["manifestSha256"]:
                raise RuntimeError("Existing environment uses a different artifact set")
            for item in entries:
                target = root / "source" / item.filename[len(prefix):]
                with archive.open(item) as stream:
                    expected = hashlib.file_digest(stream, "sha256").hexdigest()
                checked(target, expected, item.file_size)
            expected_source = {item.filename[len(prefix):] for item in entries}
            for path in (root / "source").rglob("*"):
                if not path.is_file():
                    continue
                relative = path.relative_to(root / "source").as_posix()
                if relative in expected_source:
                    continue
                if "__pycache__" in PurePosixPath(relative).parts and path.suffix == ".pyc":
                    continue
                raise RuntimeError("Unrecorded file in the engine source directory")
            verify_installed(root, cache, wheels, candidates[0])
            print(json.dumps({"status": "verified", "wheelCount": len(wheels)}))
            return
        if root.exists():
            raise RuntimeError("Target exists without a completed installation; retain it for inspection")
        root.mkdir(parents=True)
        for item in entries:
            target = root / "source" / item.filename[len(prefix):]
            if not target.resolve().is_relative_to((root / "source").resolve()):
                raise RuntimeError("Extraction escaped the runtime directory")
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as output, archive.open(item) as incoming:
                shutil.copyfileobj(incoming, output)
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    subprocess.run([sys.executable, "-I", "-B", "-m", "venv", str(root / "venv")], check=True, creationflags=flags)
    python = root / "venv" / "Scripts" / "python.exe"
    subprocess.run([str(python), "-I", "-B", "-m", "pip", "--isolated", "install", "--no-index", "--find-links", str(cache / "wheels"),
                    "--require-hashes", "--only-binary=:all:", "--no-cache-dir", "--no-user", "--disable-pip-version-check", "-r", str(cache / "requirements.lock.txt")],
                   check=True, creationflags=flags)
    verify_installed(root, cache, wheels, candidates[0])
    subprocess.run([str(python), "-I", "-B", "-m", "pip", "--isolated", "check"], check=True, creationflags=flags)
    shutil.copy2(manifest_path, root / "approved-manifest.json")
    (root / "installation.json").write_text(json.dumps({"manifestSha256": spec["manifestSha256"], "sourceCommit": source["commit"],
                                                       "wheelCount": len(wheels), "python": bootstrap["version"]}) + "\n", encoding="utf-8")
    print(json.dumps({"status": "prepared", "wheelCount": len(wheels)}))


if __name__ == "__main__":
    main()
