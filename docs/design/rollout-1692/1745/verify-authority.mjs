// pnpm node docs/design/rollout-1692/1745/verify-authority.mjs <owned-fixture> <owned-cdp-file>
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";
const [directory, cdp] = process.argv.slice(2),
	dir = resolve(directory),
	out = resolve("docs/design/rollout-1692/1745");
const json = async (f) => JSON.parse(await readFile(join(dir, f)));
const runtime = await json("runtime-private.json"),
	fixture = await json("fixture-private.json"),
	auth = await json("dev-auth-private.json"),
	services = await json("services.json");
assert.equal(fixture.kind, "disposable");
assert.equal(runtime.env.POSTGRES_HOST, "127.0.0.1");
assert.match(
	runtime.env.POSTGRES_DB,
	/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/,
);
for (const c of services.containers)
	assert.equal(
		execFileSync(
			"docker",
			["inspect", "--format", '{{ index .Config.Labels "z8.agent-owned" }}', c],
			{ encoding: "utf8", windowsHide: true },
		).trim(),
		services.label,
	);
const { Pool } = createRequire(resolve("apps/webapp/package.json"))("pg");
const pool = new Pool({
	host: runtime.env.POSTGRES_HOST,
	port: Number(runtime.env.POSTGRES_PORT),
	database: runtime.env.POSTGRES_DB,
	user: runtime.env.POSTGRES_USER,
	password: runtime.env.POSTGRES_PASSWORD,
});
const actor = fixture.actors["small-manager"];
const membership = (
	await pool.query(
		"select m.id,m.status from member m join employee e on e.user_id=m.user_id and e.organization_id=m.organization_id where e.id=$1 and e.organization_id=$2",
		[actor.employeeId, actor.organizationId],
	)
).rows[0];
assert.ok(membership);
const count = async () =>
	Number(
		(
			await pool.query(
				"select count(*) from time_entry where employee_id=$1 and organization_id=$2",
				[actor.employeeId, actor.organizationId],
			)
		).rows[0].count,
	);
const browser = await puppeteer.connect({
	browserWSEndpoint: (await readFile(cdp, "utf8")).trim(),
});
const results = [];
try {
	for (const scenario of [
		"active-organization-cleared",
		"membership-pending",
	]) {
		const context = await browser.createBrowserContext();
		await context.setPermission(runtime.origin, {
			permission: { name: "notifications" },
			state: "denied",
		});
		await context.setCookie(...auth["small-manager"].cookies);
		const page = await context.newPage();
		await page.emulateTimezone("Europe/Berlin");
		page.setDefaultTimeout(15000);
		await page.goto(runtime.origin + "/en/time-tracking", {
			waitUntil: "networkidle0",
		});
		await page.waitForSelector('header button[aria-label="Clock In"]');
		const before = await count();
		await page.setRequestInterception(true);
		let resolveHeld;
		const held = new Promise((r) => (resolveHeld = r));
		const handler = (r) => {
			if (
				new URL(r.url()).pathname === "/api/time-clock" &&
				r.method() === "POST"
			)
				resolveHeld(r);
			else void r.continue();
		};
		page.on("request", handler);
		await page.click('header button[aria-label="Clock In"]');
		const submit = (
			await page.waitForFunction(() =>
				[...document.querySelectorAll('[role="dialog"] button')].find(
					(e) =>
						e.textContent.trim() === "Clock In" &&
						e.getBoundingClientRect().width,
				),
			)
		).asElement();
		await submit.click();
		const request = await held;
		try {
			if (scenario === "active-organization-cleared") {
				const status = await page.evaluate(
					async () =>
						(
							await fetch("/api/auth/organization/set-active", {
								method: "POST",
								headers: { "content-type": "application/json" },
								body: JSON.stringify({ organizationId: null }),
							})
						).status,
				);
				assert.equal(status, 200);
			} else
				await pool.query(
					"update member set status=$1 where id=$2 and organization_id=$3",
					["pending", membership.id, actor.organizationId],
				);
			const responsePromise = page.waitForResponse(
				(r) =>
					new URL(r.url()).pathname === "/api/time-clock" &&
					r.request().method() === "POST",
			);
			await request.continue();
			const response = await responsePromise;
			const body = await response.json().catch(() => null);
			await page.waitForNetworkIdle();
			const after = await count();
			assert.equal(after, before);
			assert.notEqual(body?.success, true);
			results.push({
				scenario,
				heldAction: JSON.parse(request.postData()).action,
				status: response.status(),
				code: body?.code ?? null,
				error: body?.error ?? null,
				entriesBefore: before,
				entriesAfter: after,
			});
			await page.screenshot({ path: join(out, scenario + ".png") });
		} finally {
			await pool.query(
				"update member set status=$1 where id=$2 and organization_id=$3",
				[membership.status, membership.id, actor.organizationId],
			);
			if (scenario === "active-organization-cleared")
				await page.evaluate(async (organizationId) => {
					await fetch("/api/auth/organization/set-active", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ organizationId }),
					});
				}, actor.organizationId);
			page.off("request", handler);
			await page.setRequestInterception(false);
			await context.close();
		}
	}
	await writeFile(
		join(out, "authority.json"),
		JSON.stringify(
			{
				scope:
					"Real synthetic manager; held actual clock POST; leaving org, then actual membership refusal. Exact membership status restored.",
				results,
			},
			null,
			2,
		),
	);
	console.log(JSON.stringify(results, null, 2));
} finally {
	await pool.end();
	await browser.disconnect();
}
