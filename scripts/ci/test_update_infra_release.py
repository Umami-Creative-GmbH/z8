"""Offline integration tests; pass Z8_INFRA_TEST_SOURCE pointing at an infra checkout."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SOURCE = Path(os.environ["Z8_INFRA_TEST_SOURCE"])
RELEASE = "scaleway-kapsule/k8s/overlays/production/release/kustomization.yaml"
REAL_RUN = subprocess.run
sys.dont_write_bytecode = True


def command(*args, cwd=None):
    return REAL_RUN(args, cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


class PublishReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        script = HERE / "update-infra-release.py"
        if not script.exists():
            raise AssertionError("Shared production release handoff is not implemented")
        spec = importlib.util.spec_from_file_location("handoff", script)
        cls.helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.helper)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.seed = self.root / "seed"
        self.seed.mkdir()
        shutil.copytree(SOURCE / "scaleway-kapsule/k8s", self.seed / "scaleway-kapsule/k8s")
        (self.seed / "scripts").mkdir()
        shutil.copy2(SOURCE / "scripts/update-release.py", self.seed / "scripts/update-release.py")
        shutil.copy2(SOURCE / "scripts/tests/fixtures/release/kustomization.json", self.seed / RELEASE)
        command("git", "init", "-b", "main", str(self.seed))
        self.configure(self.seed)
        command("git", "add", ".", cwd=self.seed)
        command("git", "commit", "-qm", "seed", cwd=self.seed)
        self.remote = self.root / "remote.git"
        command("git", "clone", "--bare", str(self.seed), str(self.remote))
        self.a, self.b = self.root / "a", self.root / "b"
        for checkout in [self.a, self.b]:
            command("git", "-c", "core.autocrlf=false", "clone", str(self.remote), str(checkout))
            self.configure(checkout)
        self.artifacts = self.root / "artifacts"
        self.artifacts.mkdir()
        for name, char in [("webapp", "1"), ("worker", "2"), ("migration", "3"), ("docs", "4"), ("marketing", "5")]:
            (self.artifacts / f"z8-{name}.txt").write_text("sha256:" + char * 64 + "\n")

    def configure(self, checkout):
        command("git", "config", "user.name", "Test", cwd=checkout)
        command("git", "config", "user.email", "test@example.invalid", cwd=checkout)
        command("git", "config", "core.autocrlf", "false", cwd=checkout)

    def update(self, checkout, group, run=200):
        return self.helper.update(checkout, group, self.artifacts, "f" * 40, run, attempts=3)

    def remote_release(self):
        return json.loads(command("git", "--git-dir", str(self.remote), "show", f"main:{RELEASE}"))

    def test_concurrent_docs_push_forces_core_recompute_and_preserves_both(self):
        # Inject the independent writer immediately before the real core push.
        raced = False
        def race(args, **kwargs):
            nonlocal raced
            if "push" in args and kwargs.get("cwd") == self.a and not raced:
                raced = True
                self.update(self.b, "docs", 201)
            return REAL_RUN(args, **kwargs)
        with patch.object(self.helper.subprocess, "run", side_effect=race):
            self.update(self.a, "core")
        self.assertTrue(raced)
        release = self.remote_release()
        images = {i["name"].rsplit("-", 1)[-1]: i["digest"] for i in release["images"]}
        self.assertEqual(images, {"webapp": "sha256:" + "1" * 64, "worker": "sha256:" + "2" * 64,
                                  "migration": "sha256:" + "3" * 64, "docs": "sha256:" + "4" * 64,
                                  "marketing": "sha256:" + "e" * 64})
        changed = command("git", "--git-dir", str(self.remote), "log", "-2", "--format=", "--name-only").split()
        self.assertEqual(changed, [RELEASE, RELEASE])

    def test_late_core_run_rejected_without_commit_and_rerun_is_noop(self):
        self.update(self.a, "core", 300)
        before = command("git", "--git-dir", str(self.remote), "rev-parse", "main")
        with self.assertRaisesRegex(RuntimeError, "stale core update"):
            self.update(self.b, "core", 299)
        self.update(self.b, "core", 300)
        self.assertEqual(command("git", "--git-dir", str(self.remote), "rev-parse", "main"), before)

    def test_missing_core_artifact_never_changes_remote(self):
        (self.artifacts / "z8-migration.txt").unlink()
        before = self.remote_release()
        with self.assertRaises((ValueError, OSError)):
            self.update(self.a, "core")
        self.assertEqual(self.remote_release(), before)

    def test_marketing_update_preserves_other_groups(self):
        before = self.remote_release()
        self.update(self.a, "marketing")
        after = self.remote_release()
        self.assertEqual(after["images"][:4], before["images"][:4])
        self.assertEqual(after["images"][4]["digest"], "sha256:" + "5" * 64)
        for group in ("core", "docs"):
            for field in ("source-run", "source-sha"):
                key = f"release.z8-time.app/{group}-{field}"
                self.assertEqual(after["metadata"]["annotations"][key], before["metadata"]["annotations"][key])

    def test_malformed_digest_is_rejected_before_git_write(self):
        (self.artifacts / "z8-docs.txt").write_text("sha256:not-valid\n")
        before = self.remote_release()
        with self.assertRaisesRegex(ValueError, "invalid published docs digest"):
            self.update(self.a, "docs")
        self.assertEqual(self.remote_release(), before)

    def test_newer_core_wins_race_and_late_writer_cannot_overwrite_it(self):
        raced = False
        def race(args, **kwargs):
            nonlocal raced
            if "push" in args and kwargs.get("cwd") == self.a and not raced:
                raced = True
                self.update(self.b, "core", 301)
            return REAL_RUN(args, **kwargs)
        with patch.object(self.helper.subprocess, "run", side_effect=race):
            with self.assertRaisesRegex(RuntimeError, "stale core update"):
                self.update(self.a, "core", 300)
        self.assertEqual(self.remote_release()["metadata"]["annotations"]["release.z8-time.app/core-source-run"], "301")
        self.assertEqual(command("git", "--git-dir", str(self.remote), "rev-list", "--count", "main"), "2")

    def test_continuous_contention_stops_at_retry_bound(self):
        pushes = 0
        def race(args, **kwargs):
            nonlocal pushes
            if "push" in args and kwargs.get("cwd") == self.a:
                pushes += 1
                self.update(self.b, "docs", 400 + pushes)
            return REAL_RUN(args, **kwargs)
        with patch.object(self.helper.subprocess, "run", side_effect=race):
            with self.assertRaisesRegex(RuntimeError, "exhausted 3 push attempts"):
                self.update(self.a, "core")
        self.assertEqual(pushes, 3)
        self.assertEqual(self.remote_release()["metadata"]["annotations"]["release.z8-time.app/core-source-run"], "101")

    def test_rejected_push_without_branch_change_is_not_retried(self):
        # A real rejecting receive hook models branch protection without network access.
        hook = self.remote / "hooks/pre-receive"
        hook.write_text("#!/bin/sh\nexit 1\n")
        hook.chmod(0o755)
        before = self.remote_release()
        with self.assertRaisesRegex(RuntimeError, "infra push failed"):
            self.update(self.a, "docs")
        self.assertEqual(self.remote_release(), before)

    def test_invalid_render_never_pushes(self):
        (self.a / "scaleway-kapsule/k8s/overlays/production/kustomization.yaml").write_text("invalid: [")
        command("git", "add", ".", cwd=self.a)
        command("git", "commit", "-qm", "break render", cwd=self.a)
        command("git", "push", "origin", "main", cwd=self.a)
        before = command("git", "--git-dir", str(self.remote), "rev-parse", "main")
        with self.assertRaisesRegex(RuntimeError, "kustomize"):
            self.update(self.b, "docs")
        self.assertEqual(command("git", "--git-dir", str(self.remote), "rev-parse", "main"), before)

    def test_production_ref_gate(self):
        for event, ref, expected in [("push", "refs/heads/main", True), ("workflow_dispatch", "refs/heads/main", True),
                                     ("push", "refs/tags/v1.2.3", True), ("workflow_dispatch", "refs/tags/v1.2.3-rc.1", True),
                                     ("workflow_dispatch", "refs/heads/feature/test", False), ("push", "refs/tags/vanity", False),
                                     ("pull_request", "refs/heads/main", False)]:
            self.assertEqual(self.helper.production_ref(event, ref), expected, (event, ref))


if __name__ == "__main__":
    unittest.main()
