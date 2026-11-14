import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const evidence = JSON.parse(await readFile(new URL("./runtime-evidence.json", import.meta.url), "utf8"));
const quality = JSON.parse(await readFile(new URL("./quality-runtime.json", import.meta.url), "utf8"));
for (const view of Object.values(evidence.after.observations)) {
	assert.deepEqual(view.headings, ["Organization suspended"]);
	assert.equal(view.documentWidth, view.width);
	assert.deepEqual(view.links.map((link) => link.href), ["/en/settings/billing"]);
}
for (const [status, observation] of Object.entries(evidence.billingVariants.observations)) {
	assert.equal(observation.path, ["trialing", "active"].includes(status) ? "/en/absences" : "/en/billing/suspended");
}
for (const actor of ["small-manager", "small-employee"]) {
	assert.deepEqual(evidence.roles.observations[actor].links, []);
	assert.match(evidence.roles.observations[actor].content, /Contact an organization admin/);
}
assert.deepEqual(evidence.roles.observations["small-admin"].links, ["/en/settings/billing"]);
assert.equal(evidence.largeFont.font, "18px");
assert.equal(evidence.largeFont.saved, "large");
assert.equal(evidence.longOrganization.documentWidth, 390);
assert.equal(evidence.keyboard.visible, true);
assert.equal(evidence.keyboard.href, "/en/settings/billing");
assert.equal(evidence.permissionLoss.path, "/en/settings");
assert.deepEqual(quality.mcp.compilation, { issues: [] });
assert.deepEqual(quality.mcp.errors, { configErrors: [], sessionErrors: [] });
assert.equal(quality.nativeReact.reducedMotion, true);
assert.equal(quality.disabledBillingNormalRoute.path, "/en/absences");
console.log("Verified captured layout, billing-state, role, preference, keyboard and Next evidence.");
