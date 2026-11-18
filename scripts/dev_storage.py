#!/usr/bin/env python3
"""Inspect build storage and run development commands with a free-space guard."""

import argparse
import contextlib
import json
import math
import os
from pathlib import Path
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time

GIB = 1024 ** 3
LOW_STORAGE = {
    "CARGO_INCREMENTAL": "0",
    "CARGO_PROFILE_DEV_DEBUG": "0",
    "CARGO_PROFILE_TEST_DEBUG": "0",
}


def checked(command, root):
    result = subprocess.run(command, cwd=root, text=True, capture_output=True)
    if result.returncode:
        raise ValueError(result.stderr.strip() or f"Command failed: {command[0]}")
    return result.stdout


def existing_parent(path):
    while not path.exists():
        if path == path.parent:
            raise ValueError(f"Cannot find filesystem for {path}")
        path = path.parent
    return path


def is_link(path):
    details = path.lstat()
    return stat.S_ISLNK(details.st_mode) or bool(getattr(details, "st_file_attributes", 0) & 0x400)


def directory_size(path):
    """Logical bytes, without following links. Missing paths consume zero bytes."""
    if not path.exists() or is_link(path):
        return 0
    total = 0
    def fail(error):
        raise error
    for base, directories, files in os.walk(path, followlinks=False, onerror=fail):
        directories[:] = [name for name in directories if not is_link(Path(base, name))]
        for name in files:
            entry = Path(base, name)
            try:
                if not is_link(entry):
                    total += entry.stat().st_size
            except FileNotFoundError:
                continue
    return total


def contains_link(path):
    if not path.exists():
        return path.is_symlink()
    if is_link(path):
        return True
    def fail(error):
        raise error
    for base, directories, files in os.walk(path, followlinks=False, onerror=fail):
        if any(is_link(Path(base, name)) for name in directories + files):
            return True
    return False


def outputs(root, env):
    result = subprocess.run(
        ["cargo", "metadata", "--locked", "--offline", "--no-deps", "--format-version", "1"],
        cwd=root, env=env, text=True, capture_output=True)
    if result.returncode:
        raise ValueError(result.stderr.strip() or "Cargo metadata failed")
    metadata = json.loads(result.stdout)
    if "build_directory" not in metadata:
        raise ValueError("Cargo metadata must expose build_directory. Update Cargo before using the storage guard.")
    return Path(metadata["target_directory"]).resolve(), Path(metadata["build_directory"]).resolve()


def volumes(paths):
    result = {}
    for path in paths:
        parent = existing_parent(path)
        device = parent.stat().st_dev
        if device not in result:
            result[device] = {"path": str(parent), "outputs": [], "free_bytes": shutil.disk_usage(parent).free}
        result[device]["outputs"].append(str(path))
    return list(result.values())


def inspect(root, env):
    target, build = outputs(root, env)
    paths = list(dict.fromkeys([root, target, build, root / "jin-gui" / "dist"]))
    return {
        "root": str(root), "target_directory": str(target), "build_directory": str(build),
        "volumes": volumes(paths),
        "artifacts": [{"path": str(path), "logical_bytes": directory_size(path)}
                      for path in dict.fromkeys([target, build, root / "jin-gui" / "dist"])],
    }


@contextlib.contextmanager
def checkout_lock(root):
    parent = root
    for name in (".artifacts", "storage"):
        parent = parent / name
        if parent.is_symlink() or (parent.exists() and is_link(parent)):
            raise ValueError(f"Lock directory cannot follow links: {parent}")
        parent.mkdir(exist_ok=True)
    lock = parent / "operation.lock"
    try:
        lock.mkdir()
    except FileExistsError:
        raise ValueError(f"Another storage operation holds {lock}. If interrupted, verify it has stopped before removing that lock.")
    try:
        (lock / "owner.json").write_text(json.dumps({"pid": os.getpid()}))
        yield
    finally:
        (lock / "owner.json").unlink(missing_ok=True)
        lock.rmdir()


def terminate(process):
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True)
    else:
        os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            process.kill()
        else:
            os.killpg(process.pid, signal.SIGKILL)
        process.wait()


def run_command(args, root, env):
    command = args.command
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        raise ValueError("Supply a command after --")
    if any(arg == "--config" or arg.startswith("--config=") or
           arg == "--target-dir" or arg.startswith("--target-dir=") for arg in command):
        raise ValueError("Use Cargo environment variables for output paths so the guard can inspect them.")
    cwd = (root / args.cwd).resolve()
    if not cwd.is_relative_to(root):
        raise ValueError("Command cwd must be inside the checkout")
    if not args.full_debug:
        for key, value in LOW_STORAGE.items():
            env.setdefault(key, value)
    report = {"root": str(root)}
    report.update({"operation": "run", "command": command, "cwd": str(cwd),
                   "environment": {key: env.get(key) for key in LOW_STORAGE},
                   "reserve_bytes": int(args.reserve_gib * GIB),
                   "budget_bytes": int(args.budget_gib * GIB), "started": False,
                   "exit_code": 2})
    # Resolve settings at the actual command cwd, where Cargo may read extra config.
    target, build = outputs(cwd, env)
    report.update({"target_directory": str(target), "build_directory": str(build)})
    report["volumes"] = volumes([cwd, target, build])
    for volume in report["volumes"]:
        volume["minimum_free_bytes"] = volume["free_bytes"]
        volume["before_free_bytes"] = volume["free_bytes"]
    required = report["reserve_bytes"] + report["budget_bytes"]
    if any(volume["free_bytes"] < required for volume in report["volumes"]):
        for volume in report["volumes"]:
            volume["shortfall_bytes"] = max(0, required - volume["free_bytes"])
        report["error"] = f"Insufficient free space. Each output volume requires {required} bytes."
        return report
    kwargs = {"cwd": cwd, "env": env, "stdout": sys.stderr}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    executable = shutil.which(command[0], path=env.get("PATH"))
    if executable is None:
        raise ValueError(f"Command was not found: {command[0]}")
    process = subprocess.Popen([executable, *command[1:]], **kwargs)
    report["started"] = True
    try:
        while True:
            for volume in report["volumes"]:
                volume["free_bytes"] = shutil.disk_usage(volume["path"]).free
                volume["minimum_free_bytes"] = min(volume["minimum_free_bytes"], volume["free_bytes"])
            if process.poll() is not None:
                break
            if any(volume["free_bytes"] < report["reserve_bytes"] for volume in report["volumes"]):
                report["error"] = "Free space fell below the reserve. Terminated the command tree."
                terminate(process)
                break
            time.sleep(args.sample_seconds)
    except BaseException:
        terminate(process)
        raise
    for volume in report["volumes"]:
        volume["free_bytes"] = shutil.disk_usage(volume["path"]).free
        volume["minimum_free_bytes"] = min(volume["minimum_free_bytes"], volume["free_bytes"])
    report["child_exit_code"] = process.returncode
    report["exit_code"] = 2 if report.get("error") else process.returncode
    return report


def cleanup(args, root, env):
    target, build = outputs(root, env)
    paths = [target, build] if args.kind == "cargo" else [root / "jin-gui" / "dist"]
    report = {"operation": "cleanup", "kind": args.kind, "applied": False,
              "candidates": [{"path": str(path), "logical_bytes": directory_size(path)}
                             for path in dict.fromkeys(paths)], "exit_code": 0}
    report["rebuild_command"] = f"cargo check --locked -p {args.package}" if args.kind == "cargo" else "npm --prefix jin-gui run build"
    if args.kind == "dist":
        report["reason"] = "Stop frontend builds and review this path before manual cleanup. Exclusive access cannot be established."
        if args.apply:
            report.update(error="Automatic dist cleanup is unavailable.", exit_code=2)
        return report
    standard = root / "target"
    report["command"] = ["cargo", "clean", "--locked", "--offline", "--package", args.package, "--profile", "dev",
                         "--target-dir", str(target)]
    if target != standard or build != target:
        report.update(error="Cargo cleanup requires worktree-local target/ and build directories.", exit_code=2)
        return report
    if contains_link(standard):
        report.update(error="Cargo cleanup refuses symbolic links and junctions.", exit_code=2)
        return report
    if checked(["git", "ls-files", "-z", "--", "target"], root):
        report.update(error="Cargo cleanup refuses tracked files in target/.", exit_code=2)
        return report
    if not args.apply:
        report["command"].append("--dry-run")
    before = shutil.disk_usage(root).free
    result = subprocess.run(report["command"], cwd=root, env=env, text=True, capture_output=True)
    report.update(exit_code=result.returncode, output=result.stdout + result.stderr,
                  applied=args.apply and result.returncode == 0,
                  free_bytes_change=shutil.disk_usage(root).free - before)
    report["reason"] = "Cargo coordinates cleanup with active Cargo builds through its native locks. Only one named package's dev profile is selected."
    return report


def nonnegative(value):
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise argparse.ArgumentTypeError("Expected a finite nonnegative number")
    return number


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    result.add_argument("--json", action="store_true")
    sub = result.add_subparsers(dest="operation", required=True)
    sub.add_parser("inspect")
    run = sub.add_parser("run")
    run.add_argument("--reserve-gib", type=nonnegative, default=5)
    run.add_argument("--budget-gib", type=nonnegative, default=5)
    run.add_argument("--sample-seconds", type=nonnegative, default=1)
    run.add_argument("--full-debug", action="store_true")
    run.add_argument("--cwd", default=".")
    run.add_argument("--report", type=Path)
    run.add_argument("command", nargs=argparse.REMAINDER)
    clean = sub.add_parser("cleanup")
    clean.add_argument("kind", choices=["cargo", "dist"])
    clean.add_argument("--apply", action="store_true")
    clean.add_argument("--package", choices=["jin-core", "jin", "jin-gui"], default="jin-core")
    return result


def main(argv=None):
    args = parser().parse_args(argv)
    root = args.root.resolve()
    env = os.environ.copy()
    try:
        checkout = Path(checked(["git", "rev-parse", "--show-toplevel"], root).strip()).resolve()
        if root != checkout:
            raise ValueError("--root must name the Git checkout root")
        if args.operation == "inspect":
            report = inspect(root, env)
        else:
            with checkout_lock(root):
                if args.operation == "run":
                    report = run_command(args, root, env)
                else:
                    report = cleanup(args, root, env)
    except (ValueError, OSError, json.JSONDecodeError) as error:
        report = {"operation": args.operation, "error": str(error), "exit_code": 2}
    if getattr(args, "report", None):
        destination = root / args.report
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", dir=destination.parent, delete=False) as output:
            json.dump(report, output, indent=2)
            temporary = output.name
        os.replace(temporary, destination)
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"{args.operation}: {report.get('error', 'complete')}")
        for volume in report.get("volumes", []):
            print(f"  {volume['path']}: {volume['free_bytes'] / GIB:.2f} GiB free")
        for artifact in report.get("artifacts", report.get("candidates", [])):
            print(f"  {artifact['path']}: {artifact['logical_bytes'] / GIB:.2f} GiB logical size")
        if "output" in report:
            print(report["output"], end="")
        if "reason" in report:
            print(report["reason"])
        if "child_exit_code" in report:
            print(f"  Child exit {report['child_exit_code']}")
    return report.get("exit_code", 0)


if __name__ == "__main__":
    sys.exit(main())
