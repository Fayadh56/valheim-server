#!/usr/bin/env python3
"""Install the pinned Thunderstore packages for the Valheim server and write config overrides."""
import argparse
import json
import os
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

DOWNLOAD_URL = "https://thunderstore.io/package/download/{namespace}/{name}/{version}/"
USER_AGENT = "valheim-server/1.0"
MARKER = ".version"
SKIP_AT_ROOT = {"manifest.json", "icon.png", "readme.md", "changelog.md"}
STRIP_PREFIXES = ("BepInEx/plugins/", "plugins/")


def log(message):
    print(message, flush=True)


def folder_name(package):
    return f"{package['namespace']}-{package['name']}"


def fetch_zip(package, cache, zips):
    """Return the path of the cached package zip, filling the cache from the offline dir or Thunderstore."""
    file_name = f"{folder_name(package)}-{package['version']}.zip"
    cached = cache / file_name
    if cached.exists():
        return cached
    cache.mkdir(parents=True, exist_ok=True)
    if zips is not None:
        offline = zips / file_name
        if not offline.exists():
            return None
        shutil.copyfile(offline, cached)
        return cached
    request = urllib.request.Request(DOWNLOAD_URL.format(**package), headers={"User-Agent": USER_AGENT})
    partial = cache / (file_name + ".part")
    try:
        with urllib.request.urlopen(request, timeout=60) as response, open(partial, "wb") as out:
            shutil.copyfileobj(response, out)
    except Exception as error:
        partial.unlink(missing_ok=True)
        log(f"warning: download failed for {file_name}: {error}")
        return None
    partial.rename(cached)
    return cached


def target_path(entry_name):
    """Map a zip entry to its path inside the plugin folder, or None to skip it."""
    name = entry_name.replace("\\", "/")
    for prefix in STRIP_PREFIXES:
        if name.startswith(prefix):
            name = name[len(prefix):]
            break
    if not name or name.endswith("/"):
        return None
    if "/" not in name and (name.lower() in SKIP_AT_ROOT or name.lower().startswith("license")):
        return None
    pure = PurePosixPath(name)
    if pure.is_absolute() or ".." in pure.parts:
        raise ValueError(f"unsafe path in archive: {entry_name}")
    return pure


def extract(zip_path, destination):
    with zipfile.ZipFile(zip_path) as archive:
        planned = [(entry, target_path(entry.filename)) for entry in archive.infolist()]
        for entry, relative in planned:
            if relative is None or entry.is_dir():
                continue
            out = destination / relative
            out.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as src, open(out, "wb") as dst:
                shutil.copyfileobj(src, dst)


def install(package, plugins_root, cache, zips):
    folder = plugins_root / folder_name(package)
    marker = folder / MARKER
    if marker.exists() and marker.read_text().strip() == package["version"]:
        log(f"{folder_name(package)} {package['version']} already installed")
        return
    zip_path = fetch_zip(package, cache, zips)
    if zip_path is None:
        log(f"warning: could not fetch {folder_name(package)} {package['version']}; keeping what is installed")
        return
    staging = plugins_root / (folder.name + ".staging")
    shutil.rmtree(staging, ignore_errors=True)
    try:
        extract(zip_path, staging)
    except (ValueError, zipfile.BadZipFile) as error:
        shutil.rmtree(staging, ignore_errors=True)
        # a bad archive must not stay cached, or the package could never upgrade again
        zip_path.unlink(missing_ok=True)
        log(f"warning: skipping {folder_name(package)} {package['version']}: {error}")
        return
    (staging / MARKER).write_text(package["version"])
    shutil.rmtree(folder, ignore_errors=True)
    staging.rename(folder)
    log(f"installed {folder_name(package)} {package['version']}")


def prune(wanted, plugins_root, install_plugins):
    for child in plugins_root.iterdir():
        if child.is_dir() and (child / MARKER).exists() and child.name not in wanted:
            shutil.rmtree(child, ignore_errors=True)
            shutil.rmtree(install_plugins / child.name, ignore_errors=True)
            log(f"removed {child.name}")


def write_overrides(overrides, config_root):
    for name, value in overrides:
        target = config_root / PurePosixPath(name).name
        target.write_text(value)
        log(f"wrote {target.name}")


def chown_tree(root, owner):
    if owner == "none":
        return
    uid, gid = (int(part) for part in owner.split(":"))
    for path in [root, *root.rglob("*")]:
        os.chown(path, uid, gid)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["sync"])
    parser.add_argument("manifest")
    parser.add_argument("overrides")
    parser.add_argument("--config-root", default="/opt/valheim/config/bepinex")
    parser.add_argument("--install-root", default="/opt/valheim/data/bepinex/BepInEx")
    parser.add_argument("--cache", default="/opt/valheim/mods-cache")
    parser.add_argument("--zips", help="offline: read <Namespace-Name>-<version>.zip from this directory instead of downloading")
    parser.add_argument("--owner", default="1000:1000")
    args = parser.parse_args()

    packages = json.loads(Path(args.manifest).read_text())
    overrides = json.loads(Path(args.overrides).read_text()) if Path(args.overrides).exists() else []
    if not isinstance(packages, list) or not all({"namespace", "name", "version"} <= set(p) for p in packages):
        sys.exit("manifest must be a list of {namespace, name, version}")

    config_root = Path(args.config_root)
    plugins_root = config_root / "plugins"
    plugins_root.mkdir(parents=True, exist_ok=True)
    for package in packages:
        install(package, plugins_root, Path(args.cache), Path(args.zips) if args.zips else None)
    prune({folder_name(p) for p in packages}, plugins_root, Path(args.install_root) / "plugins")
    write_overrides(overrides, config_root)
    chown_tree(config_root, args.owner)


if __name__ == "__main__":
    main()
