// Shared assertions for each existing publish workflow's production handoff.
export function verifyReleaseHandoff(workflow, group, publishJob, expect) {
	const update = workflow.split(/  update-production-release:\r?\n/)[1] ?? "";
	expect(update.includes(`needs: ${publishJob}`), "Release update must wait for all manifest publications");
	expect(update.includes(`needs.${publishJob}.result == 'success'`), "Release update must require successful publication");
	expect(update.includes("github.ref == 'refs/heads/main'"), "Release update must gate main");
	expect(update.includes("startsWith(github.ref, 'refs/tags/v')"), "Release update must gate release tags");
	expect(!update.includes("always()"), "Failed/partial publishing must never update production");
	expect(update.includes("ssh-key: ${{ secrets.Z8_INFRA_WRITE_KEY }}"), "Infra checkout must use dedicated write key");
	expect(update.includes("repository: Umami-Creative-GmbH/z8-infra"), "Release writes must target infra");
	expect(update.includes(`--group ${group}`), "Release update must select only its group");
	expect(update.includes("--source-sha") && update.includes("--source-run"), "Release update must pass provenance");
	expect(update.includes("scripts/ci/update-infra-release.py"), "Release update must use shared retry helper");
	expect(update.includes("kubectl version --client"), "Runner must check render tool availability");
	expect(!update.includes("concurrency:"), "Independent image groups must not replace pending updates");
	expect(workflow.includes('--metadata-file /tmp/manifest-metadata.json'), "Manifest digest must come from current create metadata");
	expect(workflow.includes('containerimage.descriptor') && workflow.includes('sha256:[0-9a-f]{64}'), "Manifest artifact must validate descriptor digest");
	expect(workflow.includes("name: release-digest-"), "Manifest must upload immutable release artifact");
	expect(!/\b(?:kubectl\s+(?:apply|create|patch|set|rollout|delete)|argocd\s+app\s+sync|deploy-rollout\.sh)\b/.test(workflow), "Publishing must not deploy or sync");
}
