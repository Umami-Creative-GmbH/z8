// pnpm node docs/design/rollout-1692/1701/verify-states.mjs <owned-private-fixture>
// The imported seed verifies disposable DB identity and all service labels first.
import "./prepare-absences.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import puppeteer from "puppeteer-core";
const dir = resolve(process.argv[2]),
	out = resolve("docs/design/rollout-1692/1701"),
	load = async (f) => JSON.parse(await readFile(join(dir, f), "utf8"));
const r = await load("runtime-private.json"),
	f = await load("fixture-private.json"),
	auth = await load("dev-auth-private.json");
const require = createRequire(resolve("apps/webapp/package.json")),
	{ Pool } = require("pg");
const pool = new Pool({
	host: r.env.POSTGRES_HOST,
	port: Number(r.env.POSTGRES_PORT),
	database: r.env.POSTGRES_DB,
	user: r.env.POSTGRES_USER,
	password: r.env.POSTGRES_PASSWORD,
});
const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
});
const results = [],
	check = (name, value) => {
		assert.ok(value, name);
		results.push({ name, passed: true });
		console.log("Passed: " + name);
	};
const a = f.actors["small-employee"],
	org = a.organizationId;
const policy = (
	await pool.query(
		"select id from vacation_allowance where organization_id=$1 and name='R002 fixture annual policy'",
		[org],
	)
).rows[0];
const schedule = (
	await pool.query(
		"select s.* from work_policy_schedule s join work_policy p on p.id=s.policy_id where p.organization_id=$1 and p.is_default=true",
		[org],
	)
).rows[0];
try {
	const context = await browser.createBrowserContext();
	await context.setPermission(r.origin, {
		permission: { name: "notifications" },
		state: "denied",
	});
	const page = await context.newPage();
	page.setDefaultTimeout(30000);
	await page.setViewport({ width: 1600, height: 1000 });
	const actor = async (label) => {
		const old = await context.cookies();
		if (old.length) await context.deleteCookie(...old);
		await context.setCookie(...auth[label].cookies);
	};
	const goto = () =>
		page.goto(r.origin + "/en/absences", {
			waitUntil: "networkidle0",
			timeout: 90000,
		});
	for (const label of ["small-admin", "small-manager", "small-restricted"]) {
		await actor(label);
		await goto();
		check(
			label + " admits personal scope without employee peer records",
			await page.$eval(
				"main",
				(e) =>
					e.innerText.includes("Absences") &&
					!e.innerText.includes("R002 history"),
			),
		);
	}
	await actor("small-employee");
	await pool.query(
		"update vacation_allowance set is_active=false where id=$1 and organization_id=$2",
		[policy.id, org],
	);
	await goto();
	check(
		"missing policy does not become zero balance or hide records",
		await page.$eval(
			"main",
			(e) =>
				e.innerText.includes("Missing vacation policy") &&
				!!e.querySelector("[role=tab]") &&
				!e.innerText.includes("Days Remaining"),
		),
	);
	await page.screenshot({ path: join(out, "missing-policy.png") });
	await pool.query(
		"update vacation_allowance set is_active=true where id=$1 and organization_id=$2",
		[policy.id, org],
	);
	await pool.query(
		"update work_policy_schedule set working_days_preset='custom',schedule_type='detailed' where id=$1",
		[schedule.id],
	);
	await goto();
	check(
		"zero-working-day setup is distinct from missing policy and empty calendar",
		await page.$eval(
			"main",
			(e) =>
				e.innerText.includes("Work schedule without working days") &&
				!!e.querySelector("[role=tab]"),
		),
	);
	await page.screenshot({ path: join(out, "zero-working-days.png") });
	await pool.query(
		"update work_policy_schedule set working_days_preset=$2,schedule_type=$3 where id=$1",
		[schedule.id, schedule.working_days_preset, schedule.schedule_type],
	);
	await pool.query(
		"update employee set is_active=false where id=$1 and organization_id=$2",
		[a.employeeId, org],
	);
	await goto();
	await page.waitForFunction(() => location.pathname.includes("/sign-in"));
	check(
		"inactive employee loses session and cannot see personal records",
		await page.$eval(
			"body",
			(e) =>
				!e.querySelector("[role=tab]") && !e.innerText.includes("R002 history"),
		),
	);
	await page.screenshot({ path: join(out, "restricted-employee.png") });
	await pool.query(
		"update employee set is_active=true where id=$1 and organization_id=$2",
		[a.employeeId, org],
	);
	await writeFile(
		join(out, "state-assertions.json"),
		JSON.stringify(
			{
				scope:
					"same disposable small organization; independent personal actors; each synthetic policy/schedule/access alteration restored in finally",
				results,
			},
			null,
			2,
		),
	);
} finally {
	await pool.query(
		"update vacation_allowance set is_active=true where id=$1 and organization_id=$2",
		[policy.id, org],
	);
	await pool.query(
		"update work_policy_schedule set working_days_preset=$2,schedule_type=$3 where id=$1",
		[schedule.id, schedule.working_days_preset, schedule.schedule_type],
	);
	await pool.query(
		"update employee set is_active=true where id=$1 and organization_id=$2",
		[a.employeeId, org],
	);
	await browser.close();
	await pool.end();
}
