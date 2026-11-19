// pnpm node docs/design/rollout-1692/1701/verify-org-switch.mjs <owned-private-fixture>
import "./prepare-absences.mjs";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import puppeteer from "puppeteer-core";
const dir = resolve(process.argv[2]),
	out = resolve("docs/design/rollout-1692/1701"),
	load = async (n) => JSON.parse(await readFile(join(dir, n), "utf8"));
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
const a = f.actors["small-employee"],
	target = f.actors["large-admin"].organizationId;
const user = (
	await pool.query(
		"select user_id from employee where id=$1 and organization_id=$2",
		[a.employeeId, a.organizationId],
	)
).rows[0].user_id;
const existing = (
	await pool.query(
		"select id from member where organization_id=$1 and user_id=$2",
		[target, user],
	)
).rows[0];
const memberId = existing?.id ?? randomUUID();
if (!existing)
	await pool.query(
		"insert into member(id,organization_id,user_id,role,status,created_at) values($1,$2,$3,'member','approved',now())",
		[memberId, target, user],
	);
const browser = await puppeteer.launch({
	executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
	headless: true,
});
try {
	const c = await browser.createBrowserContext();
	await c.setPermission(r.origin, {
		permission: { name: "notifications" },
		state: "denied",
	});
	await c.setCookie(...auth["small-employee"].cookies);
	const page = await c.newPage();
	page.setDefaultTimeout(30000);
	await page.goto(r.origin + "/en/absences", { waitUntil: "networkidle0" });
	let held;
	await page.setRequestInterception(true);
	const intercept = (req) => {
		if (
			req.method() === "POST" &&
			req.url().endsWith("/en/absences") &&
			req.postData() === "[2027]"
		)
			held = req;
		else void req.continue().catch(() => {});
	};
	page.on("request", intercept);
	await page.$eval('button[aria-label="Next year"]', (e) => e.click());
	for (let tries = 0; tries < 100 && !held; tries++)
		await new Promise((d) => setTimeout(d, 50));
	assert.ok(held, "year request held in flight");
	const activate = async (organizationId) =>
		page.evaluate(async (organizationId) => {
			const response = await fetch("/api/auth/organization/set-active", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ organizationId }),
			});
			return response.status;
		}, organizationId);
	assert.equal(await activate(target), 200);
	await held.continue();
	page.off("request", intercept);
	await page.setRequestInterception(false);
	await page.goto(r.origin + "/en/absences", { waitUntil: "networkidle0" });
	await page.waitForFunction(() => !document.querySelector("[role=tab]"));
	assert.ok(
		await page.$eval(
			"body",
			(e) =>
				!e.innerText.includes("R002 history") &&
				!e.innerText.includes("Days Remaining"),
		),
	);
	await page.screenshot({ path: join(out, "org-switch-no-employee.png") });
	assert.equal(await activate(a.organizationId), 401);
	const login = await page.evaluate(async (actor) => {
		const response = await fetch("/api/auth/sign-in/email", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-captcha-response": "XXXX.DUMMY.TOKEN.XXXX",
			},
			body: JSON.stringify({ email: actor.email, password: actor.password }),
		});
		return response.status;
	}, a);
	assert.equal(login, 200);
	assert.equal(await activate(a.organizationId), 200);
	await page.goto(r.origin + "/en/absences", { waitUntil: "networkidle0" });
	assert.ok(await page.$("[role=tab]"));
	await writeFile(
		join(out, "org-switch-assertions.json"),
		JSON.stringify(
			{
				scope:
					"real employee session; approved synthetic membership without employee in second fixture organization; existing guard invalidates session; real Better Auth login restores original scope",
				results: [
					{
						name: "organization switch during held year read does not present old personal data as current",
						passed: true,
					},
					{
						name: "no-employee organization guard invalidates session",
						passed: true,
					},
					{
						name: "real reauthentication and original organization activation recovers personal page",
						passed: true,
					},
				],
			},
			null,
			2,
		),
	);
	console.log(
		"Passed: organization switch during held read, session refusal and real reauthentication recovery.",
	);
} finally {
	await browser.close();
	await pool.query(
		"delete from member where id=$1 and organization_id=$2 and user_id=$3",
		[memberId, target, user],
	);
	await pool.end();
}
