/** Synthetic benchmark history, using the existing disposable integration database gate. */
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { hashPassword } from "better-auth/crypto";
import { Temporal } from "temporal-polyfill";
import { loadEmployeeTrackingContext } from "@/lib/time-tracking/tracking-start";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import {
	closeIntegrationPools,
	integrationAdminPool,
	integrationDbModule,
	verifySuiteDatabase,
} from "@/test/integration-database";

const fixtureLayout = {
	version: 1,
	hidden: [],
	order: [
		"manager-today",
		"managed-employees",
		"pending-approvals",
		"team-overview",
		"quick-stats",
		"upcoming-shifts",
		"presence-status",
		"covering-for",
		"whos-out-today",
		"upcoming-time-off",
		"recently-approved",
		"birthday-reminders",
		"hydration",
		"vacation-balance",
	],
};

export async function seedPerformanceFixture() {
	await verifySuiteDatabase();
	const pool = integrationAdminPool();
	const suffix = randomBytes(6).toString("hex");
	const password = randomBytes(24).toString("hex");
	const passwordHash = await hashPassword(password);
	const platformAdmin = `perf-platform-${suffix}`;
	await pool.query(
		`insert into "user" (id, name, email, role, email_verified) values ($1, 'Fixture Platform', $2, 'admin', true)`,
		[platformAdmin, `${platformAdmin}@example.test`],
	);
	const days: { start: string; end: string; offset: number; home: boolean }[] =
		[];
	for (
		let day = Temporal.PlainDate.from("2025-01-01");
		Temporal.PlainDate.compare(day, "2026-01-01") < 0;
		day = day.add({ days: 1 })
	) {
		if (day.dayOfWeek > 5) continue;
		const start = day.toZonedDateTime({
			timeZone: "Europe/Berlin",
			plainTime: "09:00",
		});
		days.push({
			start: start.toInstant().toString(),
			end: start.add({ hours: 8 }).toInstant().toString(),
			offset: start.offsetNanoseconds / 60_000_000_000,
			home: day.dayOfWeek === 2,
		});
	}
	const actors: Record<
		string,
		{
			email: string;
			password: string;
			organizationId: string;
			employeeId: string;
		}
	> = {};
	const organizations = [];
	for (const [size, count] of [
		["small", 8],
		["large", 200],
	] as const) {
		const organizationId = `perf-${size}-${suffix}`;
		await pool.query(
			`insert into organization (id,name,slug,created_at,timezone,demo_data_enabled) values ($1,$2,$1,now(),'Europe/Berlin',false)`,
			[organizationId, `Performance ${size}`],
		);
		await pool.query(
			`insert into organization_tracking_settings (organization_id,tracking_start_date,activated_at,activated_by,updated_by) values ($1,'2025-01-01',now(),$2,$2)`,
			[organizationId, platformAdmin],
		);
		const teamIds = [randomUUID(), randomUUID()];
		for (const [index, teamId] of teamIds.entries())
			await pool.query(
				`insert into team (id,organization_id,name,updated_at) values ($1,$2,$3,now())`,
				[teamId, organizationId, `Fixture team ${index}`],
			);
		const roster: { userId: string; employeeId: string; role: string }[] = [];
		for (let index = 0; index < count; index++) {
			const role =
				["admin", "manager", "employee", "restricted"][index] ?? "employee";
			const userId = `perf-${size}-${index}-${suffix}`;
			const employeeId = randomUUID();
			const email = `${userId}@example.test`;
			await pool.query(
				`insert into "user" (id,name,email,email_verified,first_name,last_name) values ($1,$2,$3,true,'Fixture',$2)`,
				[userId, `Person ${index}`, email],
			);
			await pool.query(
				`insert into user_settings (user_id,onboarding_complete,onboarding_completed_at,help_improve_product,timezone,week_start_day,time_format,locale,dashboard_widget_order,updated_at) values ($1,true,now(),false,'Europe/Berlin','monday','24h','en',$2::jsonb,now())`,
				[userId, JSON.stringify(fixtureLayout)],
			);
			await pool.query(
				`insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())`,
				[
					randomUUID(),
					organizationId,
					userId,
					role === "admin" ? "admin" : "member",
				],
			);
			await pool.query(
				`insert into employee (id,user_id,organization_id,team_id,role,start_date,first_name,last_name,updated_at) values ($1,$2,$3,$4,$5,'2025-01-01T00:00:00Z','Fixture',$6,now())`,
				[
					employeeId,
					userId,
					organizationId,
					teamIds[index % 2],
					role === "restricted" ? "employee" : role,
					`Person ${index}`,
				],
			);
			const periodId = randomUUID();
			await pool.query(
				`insert into employee_employment_period (id,organization_id,employee_id,status,started_at,start_provenance,created_by) values ($1,$2,$3,'open','2025-01-01T00:00:00Z','recorded',$4)`,
				[periodId, organizationId, employeeId, userId],
			);
			await pool.query(
				`insert into employee_employment_history (employee_id,organization_id,employment_period_id,valid_from,weekly_contract_minutes,review_state,created_by,updated_at) values ($1,$2,$3,'2025-01-01T00:00:00Z',2400,'confirmed',$4,now())`,
				[employeeId, organizationId, periodId, userId],
			);
			if (index < 4) {
				await pool.query(
					`insert into account (id,account_id,provider_id,user_id,password,updated_at) values ($1,$2,'credential',$2,$3,now())`,
					[randomUUID(), userId, passwordHash],
				);
				actors[`${size}-${role}`] = {
					email,
					password,
					organizationId,
					employeeId,
				};
			}
			roster.push({ userId, employeeId, role });
		}
		const [admin, manager, , restricted] = roster;
		if (!admin || !manager || !restricted)
			throw new Error("Fixture role actors are missing");
		for (const person of roster.filter((_, i) => i % 2 === 1 && i !== 1))
			await pool.query(
				`insert into employee_managers (employee_id,manager_id,is_primary,assigned_by) values ($1,$2,true,$3)`,
				[person.employeeId, manager.employeeId, admin.userId],
			);
		await pool.query(
			`update team set primary_manager_id=$1 where id=$2 and organization_id=$3`,
			[manager.employeeId, teamIds[1], organizationId],
		);
		const customRoleId = randomUUID();
		await pool.query(
			`insert into custom_role (id,organization_id,name,base_tier,created_by,updated_at) values ($1,$2,'Fixture restricted','employee',$3,now())`,
			[customRoleId, organizationId, admin.userId],
		);
		await pool.query(
			`insert into employee_custom_role (employee_id,custom_role_id,assigned_by) values ($1,$2,$3)`,
			[restricted.employeeId, customRoleId, admin.userId],
		);
		const policyId = randomUUID();
		await pool.query(
			`insert into work_policy (id,organization_id,name,regulation_enabled,is_default,created_by,updated_at) values ($1,$2,'Fixture weekdays',false,true,$3,now())`,
			[policyId, organizationId, admin.userId],
		);
		await pool.query(
			`insert into work_policy_schedule (policy_id,hours_per_cycle,updated_at) values ($1,40,now())`,
			[policyId],
		);
		await pool.query(
			`insert into work_policy_assignment (policy_id,organization_id,assignment_type,created_by,updated_at) values ($1,$2,'organization',$3,now())`,
			[policyId, organizationId, admin.userId],
		);
		const homeOfficeId = randomUUID();
		await pool.query(
			`insert into absence_category (id,organization_id,type,name,requires_work_time,counts_against_vacation,updated_at) values ($1,$2,'home_office','Fixture home office',true,false,now())`,
			[homeOfficeId, organizationId],
		);
		for (const person of roster) {
			await pool.query(
				`insert into absence_entry (employee_id,organization_id,category_id,start_date,end_date,status,approved_by,approved_at,updated_at)
			select $1,$2,$3,d::date,d::date,'approved',$4,now(),now() from jsonb_array_elements_text($5::jsonb) d`,
				[
					person.employeeId,
					organizationId,
					homeOfficeId,
					admin.employeeId,
					JSON.stringify(
						days
							.filter((day) => day.home)
							.map((day) =>
								Temporal.Instant.from(day.start)
									.toZonedDateTimeISO("Europe/Berlin")
									.toPlainDate()
									.toString(),
							),
					),
				],
			);
		}
		// The established fixture helper creates canonical records alongside each completed period.
		// It is guarded by verifySuiteDatabase above and is never a production write path.
		await withCanonicalRecords(pool, async (client) => {
			for (const person of roster) {
				const periods = days.map((day) => ({
					...day,
					clockIn: randomUUID(),
					clockOut: randomUUID(),
				}));
				await client.query(
					`insert into time_entry (id,employee_id,organization_id,type,timestamp,utc_offset_minutes,timezone,timezone_source,hash,created_by)
				select (entry->>'id')::uuid,$1,$2,(entry->>'type')::time_entry_type,(entry->>'at')::timestamp,(entry->>'offset')::integer,'Europe/Berlin','user_setting',entry->>'id',$3
				from jsonb_array_elements($4::jsonb) entry`,
					[
						person.employeeId,
						organizationId,
						person.userId,
						JSON.stringify(
							periods.flatMap((day) => [
								{
									id: day.clockIn,
									type: "clock_in",
									at: day.start,
									offset: day.offset,
								},
								{
									id: day.clockOut,
									type: "clock_out",
									at: day.end,
									offset: day.offset,
								},
							]),
						),
					],
				);
				await client.query(
					`insert into work_period (employee_id,organization_id,clock_in_id,clock_out_id,start_time,end_time,duration_minutes,is_active,work_location_type,updated_at)
				select $1,$2,(p->>'clockIn')::uuid,(p->>'clockOut')::uuid,(p->>'start')::timestamp,(p->>'end')::timestamp,480,false,case when (p->>'home')::boolean then 'home'::work_location_type else 'office'::work_location_type end,now() from jsonb_array_elements($3::jsonb) p`,
					[person.employeeId, organizationId, JSON.stringify(periods)],
				);
			}
		});
		const observed = await pool.query<{
			employees: number;
			work_periods: number;
			canonical: number;
			home_office_dates: number;
		}>(
			`select
			(select count(*)::integer from employee where organization_id=$1) employees,
			(select count(*)::integer from work_period where organization_id=$1) work_periods,
			(select count(*)::integer from work_period p join time_record r on r.id=p.canonical_record_id and r.organization_id=p.organization_id where p.organization_id=$1 and r.start_at=p.start_time and r.end_at=p.end_time and r.duration_minutes=p.duration_minutes) canonical,
			(select count(*)::integer from absence_entry where organization_id=$1) home_office_dates`,
			[organizationId],
		);
		const actual = observed.rows[0];
		if (!actual) throw new Error("Fixture count observation is missing");
		if (
			actual.employees !== count ||
			actual.work_periods !== count * days.length ||
			actual.canonical !== actual.work_periods ||
			actual.home_office_dates !== count * days.filter((day) => day.home).length
		)
			throw new Error("Fixture row agreement failed");
		organizations.push({
			label: size,
			employees: actual.employees,
			workPeriods: actual.work_periods,
			canonicalRecords: actual.canonical,
			homeOfficeDates: actual.home_office_dates,
			timezone: "Europe/Berlin",
		});
	}
	const fixture = {
		version: 2,
		dashboardLayout: "explicit-original-v1",
		kind: "disposable",
		organizations,
		actors,
		ranges: [
			{ name: "month", start: "2025-03-01", end: "2025-03-31" },
			{ name: "quarter", start: "2025-01-01", end: "2025-03-31" },
			{ name: "year", start: "2025-01-01", end: "2025-12-31" },
		],
	};
	await verifyTrackingContexts(fixture);
	return fixture;
}

type FixtureActors = {
	kind: string;
	actors: Record<string, { organizationId: string }>;
};

/** Verify the actual production tracking reader, rather than only the settings row's shape. */
async function verifyTrackingContexts(fixture: FixtureActors) {
	await verifySuiteDatabase();
	const pool = integrationAdminPool();
	const { db } = await integrationDbModule();
	let active = 0;
	if (fixture.kind !== "disposable")
		throw new Error("Disposable fixture manifest required");
	for (const organizationId of new Set(
		Object.values(fixture.actors).map((actor) => actor.organizationId),
	)) {
		if (!/^perf-(small|large)-[a-f0-9]{12}$/.test(organizationId))
			throw new Error("Synthetic organization identity required");
		const employees = await pool.query<{ id: string }>(
			`select id from employee where organization_id=$1`,
			[organizationId],
		);
		for (const employee of employees.rows) {
			const context = await loadEmployeeTrackingContext(db, {
				organizationId,
				employeeId: employee.id,
			});
			if (
				context?.startDate !== "2025-01-01" ||
				context.timezone !== "Europe/Berlin"
			)
				throw new Error(
					"Synthetic tracking context is not active for the fixture range",
				);
			active++;
		}
	}
	if (active !== 208)
		throw new Error(
			"Synthetic tracking roster size differs from the recorded fixture",
		);
	return active;
}

if (process.argv.includes("--upgrade-private-fixture")) {
	const path =
		process.argv[process.argv.indexOf("--upgrade-private-fixture") + 1];
	if (!path) throw new Error("Private fixture manifest path required");
	(async () => {
		await verifySuiteDatabase();
		const fixture = JSON.parse(await readFile(path, "utf8"));
		if (fixture.kind !== "disposable")
			throw new Error("Disposable fixture manifest required");
		const pool = integrationAdminPool();
		for (const organizationId of new Set<string>(
			Object.values(fixture.actors as FixtureActors["actors"]).map(
				(actor) => actor.organizationId,
			),
		)) {
			if (!/^perf-(small|large)-[a-f0-9]{12}$/.test(organizationId))
				throw new Error("Synthetic organization identity required");
			await pool.query(
				`insert into organization_tracking_settings (organization_id,tracking_start_date,activated_at) values ($1,'2025-01-01',now()) on conflict (organization_id) do nothing`,
				[organizationId],
			);
			await pool.query(
				`update user_settings settings set dashboard_widget_order=$2::jsonb from employee where employee.user_id=settings.user_id and employee.organization_id=$1 and settings.dashboard_widget_order is null`,
				[organizationId, JSON.stringify(fixtureLayout)],
			);
		}
		const active = await verifyTrackingContexts(fixture);
		fixture.version = 2;
		fixture.dashboardLayout = "explicit-original-v1";
		await writeFile(path, JSON.stringify(fixture, null, 2), { mode: 0o600 });
		console.log(
			`Verified active production tracking contexts for ${active} synthetic employees (fixture version 2).`,
		);
	})()
		.catch(() => {
			console.error(
				"Synthetic fixture upgrade failed; acceptance remains unfulfilled.",
			);
			process.exitCode = 1;
		})
		.finally(closeIntegrationPools);
}

if (process.argv.includes("--write-private-manifest")) {
	const path =
		process.argv[process.argv.indexOf("--write-private-manifest") + 1];
	if (!path) throw new Error("Private manifest path required");
	seedPerformanceFixture()
		.then(async (fixture) => {
			await writeFile(path, JSON.stringify(fixture), {
				mode: 0o600,
				flag: "wx",
			});
			console.log(
				"Disposable synthetic performance fixture seeded; private manifest written.",
			);
		})
		.catch(() => {
			console.error(
				"Disposable fixture seeding failed; inspect the private local runtime log.",
			);
			process.exitCode = 1;
		})
		.finally(closeIntegrationPools);
}
