"""Behavioral safety checks for the storage command runner, using tiny fixtures."""
import contextlib
import io
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch

import dev_storage as storage


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name).resolve()
        subprocess.run(["git", "init", "--quiet", str(self.root)], check=True)
        self.target = self.root / "target"
        self.env = {"CARGO_HOME": str(self.root / "cargo-home")}

    def options(self, *arguments):
        return storage.parser().parse_args(["--root", str(self.root), *arguments])

    def test_insufficient_space_does_not_spawn_child(self):
        marker = self.root / "child-started"
        args = self.options("run", "--budget-gib", "999999", "--", sys.executable,
                            "-c", f"from pathlib import Path; Path({str(marker)!r}).touch()")
        with patch.object(storage, "outputs", return_value=(self.target, self.target)):
            report = storage.run_command(args, self.root, self.env.copy())
        self.assertFalse(report["started"])
        self.assertEqual(report["exit_code"], 2)
        self.assertFalse(marker.exists())

    def test_child_exit_environment_and_report(self):
        env = os.environ.copy()
        env["CARGO_PROFILE_DEV_DEBUG"] = "1"
        result = self.root / "child.json"
        script = ("import json, os, pathlib, sys; "
                  f"pathlib.Path({str(result)!r}).write_text(json.dumps(dict(os.environ))); "
                  "sys.exit(7)")
        args = self.options("run", "--reserve-gib", "0", "--budget-gib", "0", "--",
                            sys.executable, "-c", script)
        with patch.object(storage, "outputs", return_value=(self.target, self.target)):
            report = storage.run_command(args, self.root, env)
        actual = json.loads(result.read_text())
        self.assertEqual(actual["CARGO_INCREMENTAL"], "0")
        self.assertEqual(actual["CARGO_PROFILE_DEV_DEBUG"], "1")
        self.assertEqual(actual["CARGO_PROFILE_TEST_DEBUG"], "0")
        self.assertEqual(report["exit_code"], 7)
        self.assertEqual(report["child_exit_code"], 7)
        self.assertTrue(all("minimum_free_bytes" in volume for volume in report["volumes"]))

    def test_full_debug_does_not_insert_overrides(self):
        args = self.options("run", "--full-debug", "--reserve-gib", "0", "--budget-gib", "0",
                            "--", sys.executable, "-c", "pass")
        with patch.object(storage, "outputs", return_value=(self.target, self.target)):
            report = storage.run_command(args, self.root, self.env.copy())
        self.assertEqual(report["environment"], dict.fromkeys(storage.LOW_STORAGE))

    def test_cleanup_apply_preserves_arbitrary_and_linked_contents(self):
        outside = self.root / "user-data"
        outside.mkdir()
        valuable = outside / "data"
        valuable.write_text("preserve")
        self.target.symlink_to(outside, target_is_directory=True)
        args = self.options("cleanup", "cargo", "--apply")
        with patch.object(storage, "outputs", return_value=(self.target, self.target)):
            report = storage.cleanup(args, self.root, self.env.copy())
        self.assertEqual(report["exit_code"], 2)
        self.assertFalse(report["applied"])
        self.assertEqual(valuable.read_text(), "preserve")

    def test_checkout_lock_excludes_simultaneous_operations(self):
        with storage.checkout_lock(self.root):
            with self.assertRaisesRegex(ValueError, "Another storage operation"):
                with storage.checkout_lock(self.root):
                    self.fail("Concurrent operation entered")
        with storage.checkout_lock(self.root):
            pass

    def test_cwd_escape_and_flag_overrides_are_rejected(self):
        for arguments in [("--cwd", "..", "--", sys.executable, "-c", "pass"),
                          ("--", "cargo", "check", "--target-dir=/tmp/unmeasured")]:
            with self.subTest(arguments=arguments):
                with self.assertRaises(ValueError):
                    storage.run_command(self.options("run", *arguments), self.root, self.env.copy())

    def test_invalid_budget_values(self):
        for value in ["-1", "nan", "inf"]:
            with self.subTest(value=value), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    self.options("run", "--budget-gib", value, "--", "cargo", "check")

    def test_metadata_build_directory_and_old_cargo_refusal(self):
        metadata = {"target_directory": str(self.target), "build_directory": str(self.root / "intermediate")}
        response = subprocess.CompletedProcess([], 0, json.dumps(metadata), "")
        with patch.object(storage.subprocess, "run", return_value=response):
            target, build = storage.outputs(self.root, self.env)
        self.assertEqual(target, self.target)
        self.assertEqual(build, self.root / "intermediate")
        response.stdout = json.dumps({"target_directory": str(self.target)})
        with patch.object(storage.subprocess, "run", return_value=response):
            with self.assertRaisesRegex(ValueError, "Update Cargo"):
                storage.outputs(self.root, self.env)

    def test_cleanup_refuses_tracked_output(self):
        self.target.mkdir()
        (self.target / "important").write_text("preserve")
        subprocess.run(["git", "add", "target/important"], cwd=self.root, check=True)
        args = self.options("cleanup", "cargo", "--apply")
        with patch.object(storage, "outputs", return_value=(self.target, self.target)):
            report = storage.cleanup(args, self.root, self.env.copy())
        self.assertEqual(report["exit_code"], 2)
        self.assertTrue((self.target / "important").exists())

    def test_native_cleanup_selects_one_package_and_preview(self):
        self.target.mkdir()
        args = self.options("cleanup", "cargo", "--package", "jin")
        with patch.object(storage, "outputs", return_value=(self.target, self.target)), \
                patch.object(storage.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "", "")) as native, \
                patch.object(storage, "checked", return_value=""):
            report = storage.cleanup(args, self.root, self.env.copy())
        command = native.call_args.args[0]
        self.assertIn("--dry-run", command)
        self.assertIn("--package", command)
        self.assertEqual(command[command.index("--package") + 1], "jin")
        self.assertFalse(report["applied"])

    def test_inspect_cli_is_read_only_and_measures_artifacts(self):
        self.target.mkdir()
        (self.target / "small").write_bytes(b"12345")
        output = io.StringIO()
        with patch.object(storage, "outputs", return_value=(self.target, self.target)), \
                patch.object(storage, "checkout_lock", side_effect=AssertionError("Inspect took lock")), \
                contextlib.redirect_stdout(output):
            self.assertEqual(storage.main(["--root", str(self.root), "--json", "inspect"]), 0)
        report = json.loads(output.getvalue())
        self.assertTrue(report["volumes"])
        self.assertEqual(report["artifacts"][0]["logical_bytes"], 5)

    def test_nested_root_is_rejected_before_cleanup(self):
        nested = self.root / "nested"
        nested.mkdir()
        with patch.object(storage, "cleanup", side_effect=AssertionError("Cleanup started")), \
                contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(storage.main(["--root", str(nested), "cleanup", "cargo", "--apply"]), 2)

    def test_low_reserve_terminates_running_child_and_takes_final_sample(self):
        args = self.options("run", "--budget-gib", "0", "--reserve-gib", "1", "--",
                            sys.executable, "-c", "import time; time.sleep(20)")
        volume = {"path": str(self.root), "free_bytes": 2 * storage.GIB, "outputs": [str(self.target)]}
        usage = shutil.disk_usage(self.root)
        low = type(usage)(usage.total, usage.used, 0)
        with patch.object(storage, "outputs", return_value=(self.target, self.target)), \
                patch.object(storage, "volumes", return_value=[volume]), \
                patch.object(storage.shutil, "disk_usage", return_value=low) as sample:
            report = storage.run_command(args, self.root, os.environ.copy())
        self.assertEqual(report["exit_code"], 2)
        self.assertNotEqual(report["child_exit_code"], 0)
        self.assertGreaterEqual(sample.call_count, 2)
        self.assertEqual(report["volumes"][0]["minimum_free_bytes"], 0)

    def test_main_writes_failure_report(self):
        report_path = self.root / "reports" / "build.json"
        with patch.object(storage, "outputs", return_value=(self.target, self.target)), \
                contextlib.redirect_stdout(io.StringIO()):
            status = storage.main(["--root", str(self.root), "--json", "run", "--budget-gib", "999999",
                                   "--report", str(report_path), "--", sys.executable, "-c", "pass"])
        self.assertEqual(status, 2)
        report = json.loads(report_path.read_text())
        self.assertFalse(report["started"])
        self.assertEqual(report["exit_code"], 2)


if __name__ == "__main__":
    unittest.main()
