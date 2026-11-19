// Synthetic DB setup only, not evidence of provider completion.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const [directory, status = "past_due"] = process.argv.slice(2);
const json = async (name) => JSON.parse(await readFile(join(directory, name), "utf8"));
const runtime = await json("runtime-private.json");
const fixture = await json("fixture-private.json");
const services = await json("services.json");
assert.equal(fixture.kind, "disposable");
assert.equal(new URL(runtime.origin).hostname, "localhost");
assert.equal(runtime.env.POSTGRES_HOST, "127.0.0.1");
assert.match(runtime.env.POSTGRES_DB, /^approval_workflow_repository_test_perf_[a-f0-9]{12}$/);
assert.equal(services.label, "z8-performance-fixture-1450");
for (const container of services.containers) {
	assert.match(container, /^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);
	assert.equal(execFileSync("docker", ["inspect", "--format", '{{ index .Config.Labels "z8.agent-owned" }}', container], { encoding: "utf8", windowsHide: true }).trim(), services.label);
}
assert.ok(["past_due", "active", "trialing", "expired", "canceled", "unpaid", "demote", "restore-admin"].includes(status));
const { Client } = createRequire(join(process.cwd(), "apps/webapp/package.json"))("pg");
const db = new Client({ connectionString: runtime.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL });
await db.connect();
try {
	if (status === "demote" || status === "restore-admin") {
		await db.query("update member set role=$1 where organization_id=$2 and user_id=(select user_id from employee where id=$3 and organization_id=$2)", [status === "demote" ? "member" : "admin", fixture.actors["small-admin"].organizationId, fixture.actors["small-admin"].employeeId]);
		console.log(`Changed only owned synthetic admin membership: ${status}.`);
	} else {
	// Scope every setup write to this fixture's small organization; no Stripe IDs.
	await db.query("insert into subscription (organization_id,status,trial_end) values ($1,$2,case when $3 then now()-interval '1 day' else now()+interval '14 days' end) on conflict (organization_id) do update set status=excluded.status,trial_end=excluded.trial_end", [fixture.actors["small-admin"].organizationId, status === "expired" ? "trialing" : status, status === "expired"]);
	console.log(`Seeded owned synthetic small organization: ${status}. No provider called.`);
	}
} finally {
	await db.end();
}
