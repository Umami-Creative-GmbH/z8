#!/usr/bin/env python3
"""Commit one published image group to infra; deployment stays manual in Argo CD."""
import argparse
from pathlib import Path
import re
import subprocess
import sys
import time

OVERLAY = "scaleway-kapsule/k8s/overlays/production"
RELEASE = f"{OVERLAY}/release/kustomization.yaml"
GROUPS = {"core": ("webapp", "worker", "migration"), "docs": ("docs",), "marketing": ("marketing",)}


def production_ref(event, ref):
    return event in ("push", "workflow_dispatch") and (
        ref == "refs/heads/main" or re.fullmatch(r"refs/tags/v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?", ref) is not None
    )


def run(repo, *args, check=True):
    result = subprocess.run(args, cwd=repo, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(f"{args[0]} {args[1]} failed: {result.stderr.strip()}")
    return result


def update(repo, group, artifacts, source_sha, source_run, *, attempts=5):
    """Use a dedicated clean CI checkout; recompute from freshly fetched main each try."""
    repo, artifacts = Path(repo).resolve(), Path(artifacts).resolve()
    if run(repo, "git", "status", "--porcelain").stdout.strip():
        raise ValueError("infra checkout must be clean")
    image_args = []
    for name in GROUPS[group]:
        digest = (artifacts / f"z8-{name}.txt").read_text(encoding="utf-8").strip()
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", digest):
            raise ValueError(f"invalid published {name} digest")
        image_args.extend((f"--{name}", digest))

    for attempt in range(attempts):
        run(repo, "git", "fetch", "--no-tags", "origin", "refs/heads/main")
        base = run(repo, "git", "rev-parse", "FETCH_HEAD").stdout.strip()
        run(repo, "git", "checkout", "--detach", base)
        updater = (sys.executable, "scripts/update-release.py", "--release-file", RELEASE)
        run(repo, *updater, "--source-sha", source_sha, "--source-run", str(source_run), *image_args)
        run(repo, *updater, "--validate")
        # Purely local rendering: no kubeconfig or cluster API is used.
        run(repo, "kubectl", "kustomize", OVERLAY)
        run(repo, "git", "diff", "--check")
        if not run(repo, "git", "diff", "--name-only").stdout.strip():
            print(f"Unchanged {group} release for run {source_run}")
            return
        run(repo, "git", "add", "--", RELEASE)
        staged = run(repo, "git", "diff", "--cached", "--name-only").stdout.splitlines()
        if staged != [RELEASE]:
            raise RuntimeError("refusing to commit anything except the release component")
        run(repo, "git", "commit", "-m", f"chore(release): update {group} from Z8 run {source_run}")
        pushed = run(repo, "git", "push", "origin", "HEAD:refs/heads/main", check=False)
        if pushed.returncode == 0:
            print(f"Updated {group} release from {source_sha} (run {source_run}); Argo CD sync remains manual")
            return
        # Retry only contention. Auth/protection/network failures must remain visible.
        run(repo, "git", "fetch", "--no-tags", "origin", "refs/heads/main")
        current = run(repo, "git", "rev-parse", "FETCH_HEAD").stdout.strip()
        if current == base:
            raise RuntimeError(f"infra push failed: {pushed.stderr.strip()}")
        if attempt + 1 < attempts:
            print(f"Infra main advanced; recomputing {group} update ({attempt + 2}/{attempts})")
            time.sleep(attempt + 1)
    raise RuntimeError(f"infra main kept advancing; exhausted {attempts} push attempts")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--infra-dir", type=Path, required=True)
    parser.add_argument("--artifacts-dir", type=Path, required=True)
    parser.add_argument("--group", choices=GROUPS, required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--source-run", type=int, required=True)
    parser.add_argument("--source-ref", required=True)
    parser.add_argument("--source-event", required=True)
    args = parser.parse_args()
    if not production_ref(args.source_event, args.source_ref):
        parser.error("production updates require a main or version-tag push/manual run")
    try:
        update(args.infra_dir, args.group, args.artifacts_dir, args.source_sha, args.source_run)
    except (OSError, ValueError, RuntimeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
