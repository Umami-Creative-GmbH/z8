// pnpm node docs/design/rollout-1692/1701/prepare-absences.mjs <owned-private-fixture>
// Synthetic fixture setup only. No app calculation/permission rules are replaced.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
const dir = resolve(process.argv[2]),
	repo = resolve(".");
const load = async (name) =>
	JSON.parse(await readFile(join(dir, name), "utf8"));
const runtime = await load("runtime-private.json"),
	fixture = await load("fixture-private.json"),
	services = await load("services.json");
assert.equal(fixture.kind, "disposable");
assert.equal(runtime.env.POSTGRES_HOST, "127.0.0.1");
assert.match(
	runtime.env.POSTGRES_DB,
	/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/,
);
assert.equal(services.label, "z8-performance-fixture-1450");
for (const c of services.containers) {
	assert.match(c, /^z8_perf_[a-f0-9]{12}_(postgres|redis|storage)$/);
	assert.equal(
		execFileSync(
			"docker",
			["inspect", "--format", '{{ index .Config.Labels "z8.agent-owned" }}', c],
			{ encoding: "utf8" },
		).trim(),
		services.label,
	);
}
const require = createRequire(join(repo, "apps/webapp/package.json")),
	{ Pool } = require("pg");
const pool = new Pool({
	host: runtime.env.POSTGRES_HOST,
	port: Number(runtime.env.POSTGRES_PORT),
	database: runtime.env.POSTGRES_DB,
	user: runtime.env.POSTGRES_USER,
	password: runtime.env.POSTGRES_PASSWORD,
});
try {
	await pool.query("begin");
	const actor = fixture.actors["small-employee"],
		admin = fixture.actors["small-admin"],
		manager = fixture.actors["small-manager"];
	const org = actor.organizationId;
	const user = (
		await pool.query(
			"select user_id from employee where id=$1 and organization_id=$2",
			[admin.employeeId, org],
		)
	).rows[0].user_id;
	await pool.query(
		`insert into vacation_allowance(organization_id,name,start_date,default_annual_days,accrual_type,statutory_minimum_days,is_company_default,created_by,updated_at) select $1,'R002 fixture annual policy','2025-01-01',30,'annual',20,true,$2,now() where not exists(select 1 from vacation_allowance where organization_id=$1 and name='R002 fixture annual policy')`,
		[org, user],
	);
	const category = async (type, name, counts, approval, deputy, color) => {
		let row = (
			await pool.query(
				"select id from absence_category where organization_id=$1 and name=$2",
				[org, name],
			)
		).rows[0];
		if (!row)
			row = (
				await pool.query(
					"insert into absence_category(organization_id,type,name,counts_against_vacation,requires_approval,deputy_required,color,updated_at) values($1,$2,$3,$4,$5,$6,$7,now()) returning id",
					[org, type, name, counts, approval, deputy, color],
				)
			).rows[0];
		return row.id;
	};
	const vacation = await category(
			"vacation",
			"R002 Vacation",
			true,
			true,
			true,
			"#2563eb",
		),
		sick = await category(
			"sick",
			"R002 Sick leave",
			false,
			false,
			false,
			"#a855f7",
		);
	for (let index = 0; index < 12; index++)
		await pool.query(
			`insert into absence_entry(employee_id,organization_id,category_id,start_date,end_date,start_period,end_period,status,notes,approved_by,approved_at,updated_at) select $1,$2,$3,$4,$4,$5,$5,$6,$7,$8,now(),now() where not exists(select 1 from absence_entry where employee_id=$1 and notes=$7)`,
			[
				actor.employeeId,
				org,
				vacation,
				`2026-${String(index + 1).padStart(2, "0")}-05`,
				index === 0 ? "am" : "full_day",
				index === 11 ? "pending" : index === 10 ? "rejected" : "approved",
				`R002 history ${index + 1}`,
				admin.employeeId,
			],
		);
	await pool.query(
		`insert into absence_entry(employee_id,organization_id,category_id,start_date,end_date,status,sick_detail,notes,approved_by,approved_at,updated_at) select $1,$2,$3,'2026-10-12','2026-10-12','approved','without_certificate','R002 sick record',$4,now(),now() where not exists(select 1 from absence_entry where employee_id=$1 and notes='R002 sick record')`,
		[actor.employeeId, org, sick, admin.employeeId],
	);
	await pool.query(
		`insert into employee_managers(employee_id,manager_id,is_primary,assigned_by) values($1,$2,true,$3) on conflict do nothing`,
		[actor.employeeId, manager.employeeId, user],
	);
	let holiday = (
		await pool.query(
			`select id from holiday_category where organization_id=$1 and name='R002 Public holiday'`,
			[org],
		)
	).rows[0];
	if (!holiday)
		holiday = (
			await pool.query(
				`insert into holiday_category(organization_id,type,name,updated_at) values($1,'public_holiday','R002 Public holiday',now()) returning id`,
				[org],
			)
		).rows[0];
	await pool.query(
		`insert into holiday_category_assignment(category_id,organization_id,assignment_type,created_by,updated_at) select $1,$2,'organization',$3,now() where not exists(select 1 from holiday_category_assignment where category_id=$1 and organization_id=$2)`,
		[holiday.id, org, user],
	);
	await pool.query(
		`insert into holiday(organization_id,category_id,name,start_date,end_date,created_by,updated_at) select $1,$2,'R002 synthetic holiday','2026-12-24T23:00:00Z','2026-12-25T22:59:59.999Z',$3,now() where not exists(select 1 from holiday where organization_id=$1 and name='R002 synthetic holiday')`,
		[org, holiday.id, user],
	);
	await pool.query("commit");
	console.log(
		"Prepared guarded R002 absence policy, representative records, holiday and manager.",
	);
} catch (e) {
	await pool.query("rollback");
	throw e;
} finally {
	await pool.end();
}
