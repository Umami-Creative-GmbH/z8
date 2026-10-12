/**
 * #1015: "is Y covering for X?" read from a disposable PostgreSQL database,
 * through the Promise loaders and their Effect wrappers. The day rules live in
 * the pure core (`covering.test.ts`); this suite pins what the loader reads:
 * the organization switch, the deputy's state and inbox access, the approvers'
 * timezones, and organization scoping.
 */

import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { DatabaseService, makeDatabaseService } from "@/lib/effect/services/database.service";
import { integrationAdminPool } from "@/test/integration-database";
import {
	coveredApprovers,
	coverFor,
	isCovering,
	loadCover,
	loadCoveredApprovers,
} from "./covering-store";

const ORG = "t1015-cover-org";
const OTHER_ORG = "t1015-cover-other-org";
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");

const ids = {
	xLosAngeles: "e1015000-0000-4000-8000-000000000001",
	xBerlin: "e1015000-0000-4000-8000-000000000002",
	xHomeOffice: "e1015000-0000-4000-8000-000000000003",
	xForeignCategory: "e1015000-0000-4000-8000-000000000004",
	deputy: "e1015000-0000-4000-8000-000000000005",
	contactOnly: "e1015000-0000-4000-8000-000000000006",
	inactiveDeputy: "e1015000-0000-4000-8000-000000000007",
	vacation: "e1015100-0000-4000-8000-000000000001",
	homeOffice: "e1015100-0000-4000-8000-000000000002",
	foreignVacation: "e1015100-0000-4000-8000-000000000003",
} as const;
type Person =
	| "xLosAngeles"
	| "xBerlin"
	| "xHomeOffice"
	| "xForeignCategory"
	| "deputy"
	| "contactOnly"
	| "inactiveDeputy";
const userOf = (person: Person) => `t1015-${person}`;

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id = any($1::text[])", [[ORG, OTHER_ORG]]);
	await admin.query('delete from "user" where id like $1', ["t1015-%"]);
}

async function seedPerson(
	person: Person,
	input: { employeeRole: string; isActive?: boolean; timezone?: string },
) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$1,$2,$3,$3)',
		[userOf(person), `${userOf(person)}@example.test`, SEEDED_AT],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,'member','approved',$4)",
		[`t1015-member-${person}`, ORG, userOf(person), SEEDED_AT],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,is_active,updated_at) values ($1,$2,$3,$4,$5,$6)",
		[ids[person], userOf(person), ORG, input.employeeRole, input.isActive ?? true, SEEDED_AT],
	);
	if (input.timezone) {
		await admin.query(
			"insert into user_settings (user_id, locale, timezone, time_format, updated_at) values ($1, 'en', $2, '24h', $3)",
			[userOf(person), input.timezone, SEEDED_AT],
		);
	}
}

async function insertAbsence(input: {
	employee: Person;
	deputy: Person;
	category?: string;
	startDate: string;
	endDate: string;
	status?: "pending" | "approved" | "rejected";
}) {
	await admin.query(
		`insert into absence_entry
		 (employee_id, category_id, start_date, end_date, status, organization_id, deputy_employee_id, updated_at)
		 values ($1, $2, $3, $4, $5, $6, $7, $8)`,
		[
			ids[input.employee],
			input.category ?? ids.vacation,
			input.startDate,
			input.endDate,
			input.status ?? "approved",
			ORG,
			ids[input.deputy],
			SEEDED_AT,
		],
	);
}

async function setDeputyDecisions(enabled: boolean) {
	await admin.query(
		`insert into approval_setting (organization_id, deputy_decisions_enabled) values ($1, $2)
		 on conflict (organization_id) do update set deputy_decisions_enabled = excluded.deputy_decisions_enabled`,
		[ORG, enabled],
	);
}

// 4 June, 12:00 in Berlin and 03:00 in Los Angeles.
const FOURTH_NOON_BERLIN = parseInstant("2026-06-04T10:00:00Z");
// 5 June, 07:00 in Berlin; still 4 June (22:00) in Los Angeles.
const FIFTH_MORNING_BERLIN = parseInstant("2026-06-05T05:00:00Z");
// 5 June, 10:00 in Berlin and 01:00 in Los Angeles.
const FIFTH_LATER = parseInstant("2026-06-05T08:00:00Z");

const query = (deputy: Person, at = FOURTH_NOON_BERLIN, organizationId = ORG) => ({
	organizationId,
	deputyId: ids[deputy],
	at,
});
const approverIds = (covers: readonly { approverId: string }[]) =>
	covers.map((cover) => cover.approverId).sort();

describe("covering read from the database (#1015)", () => {
	beforeAll(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, $1, $1, 'Europe/Berlin', $3), ($2, $2, $2, 'UTC', $3)`,
			[ORG, OTHER_ORG, SEEDED_AT],
		);
		await admin.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_approval, requires_work_time, counts_against_vacation, is_active, updated_at)
			 values ($1, $4, 'vacation', 'Vacation', true, false, true, true, $5),
			        ($2, $4, 'home_office', 'Home office', true, true, false, true, $5),
			        ($3, $6, 'vacation', 'Other vacation', true, false, true, true, $5)`,
			[ids.vacation, ids.homeOffice, ids.foreignVacation, ORG, SEEDED_AT, OTHER_ORG],
		);
		await seedPerson("xLosAngeles", { employeeRole: "manager", timezone: "America/Los_Angeles" });
		// No settings row: the organization's timezone applies.
		await seedPerson("xBerlin", { employeeRole: "manager" });
		await seedPerson("xHomeOffice", { employeeRole: "manager" });
		await seedPerson("xForeignCategory", { employeeRole: "manager" });
		await seedPerson("deputy", { employeeRole: "manager", timezone: "UTC" });
		await seedPerson("contactOnly", { employeeRole: "employee" });
		await seedPerson("inactiveDeputy", { employeeRole: "manager", isActive: false });

		await insertAbsence({
			employee: "xLosAngeles",
			deputy: "deputy",
			startDate: "2026-06-04",
			endDate: "2026-06-04",
		});
		await insertAbsence({
			employee: "xBerlin",
			deputy: "deputy",
			startDate: "2026-06-03",
			endDate: "2026-06-05",
		});
		await insertAbsence({
			employee: "xHomeOffice",
			deputy: "deputy",
			category: ids.homeOffice,
			startDate: "2026-06-04",
			endDate: "2026-06-04",
		});
		await insertAbsence({
			employee: "xHomeOffice",
			deputy: "deputy",
			startDate: "2026-06-04",
			endDate: "2026-06-04",
			status: "pending",
		});
		await insertAbsence({
			employee: "xForeignCategory",
			deputy: "deputy",
			category: ids.foreignVacation,
			startDate: "2026-06-04",
			endDate: "2026-06-04",
		});
		for (const deputy of ["contactOnly", "inactiveDeputy"] as const) {
			await insertAbsence({
				employee: "xBerlin",
				deputy,
				startDate: "2026-06-04",
				endDate: "2026-06-04",
			});
		}
	});
	afterAll(cleanup);

	it("lists every approver the deputy covers for at the instant, and only those", async () => {
		const covers = await loadCoveredApprovers(db, query("deputy"));
		expect(approverIds(covers)).toEqual([ids.xLosAngeles, ids.xBerlin].sort());
		expect(covers.find((cover) => cover.approverId === ids.xBerlin)).toMatchObject({
			day: "2026-06-04",
			absenceEndDate: "2026-06-05",
		});
	});

	it("reads each approver's day in their own timezone, else the organization's", async () => {
		expect(
			approverIds(await loadCoveredApprovers(db, query("deputy", FIFTH_MORNING_BERLIN))),
		).toEqual([ids.xLosAngeles, ids.xBerlin].sort());
		expect(approverIds(await loadCoveredApprovers(db, query("deputy", FIFTH_LATER)))).toEqual([
			ids.xBerlin,
		]);
	});

	it("answers for one approver", async () => {
		expect(await isCovering(db, { ...query("deputy"), approverId: ids.xLosAngeles })).toBe(true);
		expect(await isCovering(db, { ...query("deputy"), approverId: ids.xHomeOffice })).toBe(false);
		expect(
			await isCovering(db, { ...query("deputy", FIFTH_LATER), approverId: ids.xLosAngeles }),
		).toBe(false);
		expect(await loadCover(db, { ...query("deputy"), approverId: ids.xBerlin })).toMatchObject({
			approverId: ids.xBerlin,
			day: "2026-06-04",
			absenceEndDate: "2026-06-05",
		});
	});

	it("covers for nobody as a contact-only or inactive deputy", async () => {
		expect(await loadCoveredApprovers(db, query("contactOnly"))).toEqual([]);
		expect(await loadCoveredApprovers(db, query("inactiveDeputy"))).toEqual([]);
	});

	it("covers for nobody in another organization", async () => {
		expect(await loadCoveredApprovers(db, query("deputy", FOURTH_NOON_BERLIN, OTHER_ORG))).toEqual(
			[],
		);
		expect(
			await isCovering(db, {
				...query("deputy", FOURTH_NOON_BERLIN, OTHER_ORG),
				approverId: ids.xBerlin,
			}),
		).toBe(false);
	});

	it("covers for nobody while the organization has deputy decisions turned off", async () => {
		await setDeputyDecisions(false);
		try {
			expect(await loadCoveredApprovers(db, query("deputy"))).toEqual([]);
			expect(await isCovering(db, { ...query("deputy"), approverId: ids.xBerlin })).toBe(false);
		} finally {
			await setDeputyDecisions(true);
		}
		expect(await isCovering(db, { ...query("deputy"), approverId: ids.xBerlin })).toBe(true);
	});

	it("runs as an effect over the caller's database service", async () => {
		const run = <A, E>(effect: Effect.Effect<A, E, DatabaseService>) =>
			Effect.runPromise(
				effect.pipe(Effect.provideService(DatabaseService, makeDatabaseService(db))),
			);

		expect(approverIds(await run(coveredApprovers(query("deputy"))))).toEqual(
			[ids.xLosAngeles, ids.xBerlin].sort(),
		);
		expect(await run(coverFor({ ...query("deputy"), approverId: ids.xBerlin }))).toMatchObject({
			approverId: ids.xBerlin,
		});
		expect(await run(coverFor({ ...query("deputy"), approverId: ids.xHomeOffice }))).toBeNull();
	});
});
