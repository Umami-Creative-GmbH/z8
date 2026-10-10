/**
 * #1012: an absence's deputy shows wherever the absence already shows, against
 * PostgreSQL: the team absence calendar, /calendar's absence events, the bots'
 * "who's out" command and the organization data export. Only the session and
 * outside services are replaced.
 *
 * Local contract: pnpm --filter webapp test:integration
 */

import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotCommandContext } from "@/lib/bot-platform/types";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1012s-org",
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user", email: `${harness.userId}@example.test` },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));
vi.mock("@/lib/logger", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/logger")>();
	const quiet = { error: () => {}, warn: () => {}, info: () => {}, debug: () => {} };
	return {
		...original,
		logger: { ...original.logger, ...quiet },
		createLogger: () => ({ ...original.logger, ...quiet }),
	};
});

const { getManagerAbsenceCalendar } = await import("@/app/[locale]/(app)/team/absences/actions");
const { getAbsencesForMonth, linkAbsenceDeputyProfiles } = await import(
	"@/lib/calendar/absence-service"
);
const { whosOutCommand } = await import("@/lib/teams/commands/whos-out");
const { fetchAbsences } = await import("@/lib/export/data-fetchers");
const { CSV_COLUMNS, toCSV } = await import("@/lib/export/formatters/csv-formatter");

const ORG = "t1012s-org";
const OTHER_ORG = "t1012s-other-org";
const SEEDED_AT = new Date("2026-01-01T00:00:00Z");

const ids = {
	owner: "e1012500-0000-4000-8000-000000000001",
	manager: "e1012500-0000-4000-8000-000000000002",
	anna: "e1012500-0000-4000-8000-000000000003",
	ben: "e1012500-0000-4000-8000-000000000004",
	carla: "e1012500-0000-4000-8000-000000000005",
	outsider: "e1012500-0000-4000-8000-000000000006",
	vacation: "e1012600-0000-4000-8000-000000000001",
	otherVacation: "e1012600-0000-4000-8000-000000000002",
} as const;
type Person = Exclude<keyof typeof ids, "vacation" | "otherVacation">;
const userOf = (person: Person) => `t1012s-${person}`;

const admin = integrationAdminPool();

async function cleanup() {
	// Rows without an organization do not go with it.
	await admin.query(
		"delete from absence_entry where organization_id is null and employee_id = any($1::uuid[])",
		[Object.values(ids)],
	);
	await admin.query("delete from organization where id = any($1::text[])", [[ORG, OTHER_ORG]]);
	await admin.query('delete from "user" where id like $1', ["t1012s-%"]);
}

async function seedPerson(
	person: Person,
	input: { name: string; memberRole?: string; role?: string; organizationId?: string },
) {
	const organizationId = input.organizationId ?? ORG;
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,$4,$4)',
		[userOf(person), input.name, `${userOf(person)}@example.test`, SEEDED_AT],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',$5)",
		[
			`t1012s-member-${person}`,
			organizationId,
			userOf(person),
			input.memberRole ?? "member",
			SEEDED_AT,
		],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,is_active,updated_at) values ($1,$2,$3,$4,true,$5)",
		[ids[person], userOf(person), organizationId, input.role ?? "employee", SEEDED_AT],
	);
}

async function seedAbsence(input: {
	employee: Person;
	deputy: Person | null;
	startDate: string;
	endDate: string;
	status?: string;
	organizationId?: string | null;
	categoryId?: string;
}): Promise<string> {
	const { rows } = await admin.query<{ id: string }>(
		`insert into absence_entry
		 (employee_id, organization_id, category_id, start_date, end_date, status, deputy_employee_id, updated_at)
		 values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
		[
			ids[input.employee],
			input.organizationId === undefined ? ORG : input.organizationId,
			input.categoryId ?? ids.vacation,
			input.startDate,
			input.endDate,
			input.status ?? "approved",
			input.deputy ? ids[input.deputy] : null,
			SEEDED_AT,
		],
	);
	const [row] = rows;
	if (!row) throw new Error("absence not inserted");
	return row.id;
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at)
		 values ($1, $1, $1, 'UTC', $3), ($2, $2, $2, 'UTC', $3)`,
		[ORG, OTHER_ORG, SEEDED_AT],
	);
	await seedPerson("owner", { name: "Olga Owner", memberRole: "owner", role: "admin" });
	await seedPerson("manager", { name: "Mia Manager", role: "manager" });
	await seedPerson("anna", { name: "Anna Example" });
	await seedPerson("ben", { name: "Ben Example" });
	await seedPerson("carla", { name: "Carla Example" });
	await seedPerson("outsider", { name: "Oscar Outsider", organizationId: OTHER_ORG });
	for (const employee of [ids.anna, ids.carla]) {
		await admin.query(
			`insert into employee_managers
			 (id, employee_id, manager_id, is_primary, assigned_by, assigned_at, created_at)
			 values (gen_random_uuid(), $1, $2, true, $3, $4, $4)`,
			[employee, ids.manager, userOf("owner"), SEEDED_AT],
		);
	}
	await admin.query(
		`insert into absence_category
		 (id, organization_id, type, name, requires_approval, counts_against_vacation, deputy_required, is_active, updated_at)
		 values ($1, $3, 'vacation', 'Vacation', true, false, true, true, $5),
		        ($2, $4, 'vacation', 'Other vacation', true, false, false, true, $5)`,
		[ids.vacation, ids.otherVacation, ORG, OTHER_ORG, SEEDED_AT],
	);
}

function signIn(person: Person) {
	harness.userId = userOf(person);
	harness.organizationId = ORG;
}

describe("deputies on absence surfaces (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	beforeEach(seed);
	afterAll(cleanup);

	describe("team absence calendar", () => {
		it("shows a manager each absence's deputy and lets them change it until it has ended", async () => {
			const future = await seedAbsence({
				employee: "anna",
				deputy: "ben",
				startDate: "2099-06-09",
				endDate: "2099-06-12",
			});
			const withoutDeputy = await seedAbsence({
				employee: "carla",
				deputy: null,
				startDate: "2099-06-20",
				endDate: "2099-06-21",
				status: "pending",
			});
			const ended = await seedAbsence({
				employee: "anna",
				deputy: "carla",
				startDate: "2020-06-01",
				endDate: "2020-06-05",
			});

			signIn("manager");
			const upcoming = await getManagerAbsenceCalendar({ year: 2099 });
			const past = await getManagerAbsenceCalendar({ year: 2020 });

			expect(upcoming.success && past.success).toBe(true);
			if (!upcoming.success || !past.success) return;
			const byId = new Map(
				[...upcoming.data.entries, ...past.data.entries].map((entry) => [entry.id, entry]),
			);
			expect(byId.get(future)).toMatchObject({
				deputy: { id: ids.ben, name: "Ben Example", canOpenProfile: false },
				canChangeDeputy: true,
				deputyRequired: true,
			});
			expect(byId.get(withoutDeputy)?.deputy).toBeNull();
			expect(byId.get(withoutDeputy)?.canChangeDeputy).toBe(true);
			expect(byId.get(ended)).toMatchObject({
				// The manager manages Carla, so her name links to her profile.
				deputy: { id: ids.carla, name: "Carla Example", canOpenProfile: true },
				canChangeDeputy: false,
			});
		});

		it("narrows to the absences a deputy covers that have not ended at an instant (#1014)", async () => {
			const covered = await seedAbsence({
				employee: "anna",
				deputy: "ben",
				startDate: "2099-06-09",
				endDate: "2099-06-12",
			});
			// Ended at the instant, or covered by someone else: not listed.
			await seedAbsence({ employee: "carla", deputy: "ben", startDate: "2099-01-05", endDate: "2099-01-06" });
			await seedAbsence({ employee: "carla", deputy: "anna", startDate: "2099-07-01", endDate: "2099-07-02" });

			signIn("manager");
			const result = await getManagerAbsenceCalendar({
				year: 2099,
				deputyCover: { deputyEmployeeId: ids.ben, at: "2099-03-01T12:00:00Z" },
			});

			expect(result.success && result.data.entries.map((entry) => entry.id)).toEqual([covered]);
		});
	});

	describe("/calendar absence events", () => {
		it("carries the deputy of the employee's absences of this organization only", async () => {
			const withDeputy = await seedAbsence({
				employee: "anna",
				deputy: "ben",
				startDate: "2026-03-02",
				endDate: "2026-03-04",
				status: "pending",
			});
			const withoutDeputy = await seedAbsence({
				employee: "anna",
				deputy: null,
				startDate: "2026-03-10",
				endDate: "2026-03-10",
			});
			// A row of Anna's without the organization is not this organization's absence.
			await seedAbsence({
				employee: "anna",
				deputy: null,
				startDate: "2026-03-20",
				endDate: "2026-03-20",
				organizationId: null,
			});

			const events = await getAbsencesForMonth(2, 2026, {
				organizationId: ORG,
				employeeId: ids.anna,
			});

			expect(events.map((event) => event.id).sort()).toEqual([withDeputy, withoutDeputy].sort());
			const byId = new Map(events.map((event) => [event.id, event]));
			expect(byId.get(withDeputy)?.metadata).toMatchObject({
				status: "pending",
				deputy: { id: ids.ben, name: "Ben Example", canOpenProfile: false },
			});
			expect(byId.get(withoutDeputy)?.metadata.deputy).toBeNull();
		});

		it("links the deputy's name for viewers who may open their profile", async () => {
			await seedAbsence({
				employee: "anna",
				deputy: "carla",
				startDate: "2026-03-02",
				endDate: "2026-03-04",
			});
			const events = await getAbsencesForMonth(2, 2026, {
				organizationId: ORG,
				employeeId: ids.anna,
			});
			const deputyOf = async (person: Person) =>
				(
					await linkAbsenceDeputyProfiles(events, {
						organizationId: ORG,
						viewerUserId: userOf(person),
					})
				)[0]?.metadata.deputy;

			expect(await deputyOf("manager")).toMatchObject({ id: ids.carla, canOpenProfile: true });
			expect(await deputyOf("owner")).toMatchObject({ canOpenProfile: true });
			expect(await deputyOf("anna")).toMatchObject({ canOpenProfile: false });
		});
	});

	describe("the bots' who's out command", () => {
		function whosOut() {
			const now = Temporal.Instant.from("2026-03-03T12:00:00Z");
			return whosOutCommand.handler({
				platform: "telegram",
				organizationId: ORG,
				employeeId: ids.manager,
				userId: userOf("manager"),
				platformUserId: "t1012s-telegram",
				config: {} as BotCommandContext["config"],
				args: [],
				locale: "en",
				temporal: {
					effectiveTimezone: "UTC",
					organizationTimezone: "UTC",
					locale: "en",
					timezone: "UTC",
					timeFormat: "24h",
					now,
					clock: { nowInstant: () => now },
				} as BotCommandContext["temporal"],
			});
		}

		it("names the deputy of each absent team member who has one", async () => {
			await seedAbsence({
				employee: "anna",
				deputy: "ben",
				startDate: "2026-03-02",
				endDate: "2026-03-04",
			});
			await seedAbsence({
				employee: "carla",
				deputy: null,
				startDate: "2026-03-03",
				endDate: "2026-03-03",
			});

			const response = await whosOut();

			const text = response.type === "text" ? response.text : "";
			const lines = text.split("\n");
			expect(lines.find((line) => line.includes("Anna Example"))).toContain("Deputy: Ben Example");
			expect(lines.find((line) => line.includes("Carla Example"))).not.toContain("Deputy");
		});

		it("leaves out absences that are not this organization's", async () => {
			await seedAbsence({
				employee: "anna",
				deputy: null,
				startDate: "2026-03-02",
				endDate: "2026-03-04",
				organizationId: null,
			});

			const response = await whosOut();

			expect(response.type === "text" ? response.text : "").not.toContain("Anna Example");
		});
	});

	describe("organization data export", () => {
		it("adds the deputy's employee id and name, empty when there is none", async () => {
			const withDeputy = await seedAbsence({
				employee: "anna",
				deputy: "ben",
				startDate: "2026-03-02",
				endDate: "2026-03-04",
			});
			const withoutDeputy = await seedAbsence({
				employee: "carla",
				deputy: null,
				startDate: "2026-03-03",
				endDate: "2026-03-03",
			});
			await seedAbsence({
				employee: "anna",
				deputy: null,
				startDate: "2026-04-01",
				endDate: "2026-04-01",
				organizationId: null,
			});

			const { absences } = await fetchAbsences(ORG);

			const byId = new Map(absences.map((row) => [row.id, row]));
			expect([...byId.keys()].sort()).toEqual([withDeputy, withoutDeputy].sort());
			expect(byId.get(withDeputy)).toMatchObject({
				deputyEmployeeId: ids.ben,
				deputyName: "Ben Example",
			});
			expect(byId.get(withoutDeputy)).toMatchObject({ deputyEmployeeId: null, deputyName: null });

			const csv = toCSV(absences, CSV_COLUMNS.absences).split("\n");
			expect(csv[0]?.endsWith(",createdAt,deputyEmployeeId,deputyName")).toBe(true);
			expect(csv.find((line) => line.startsWith(withDeputy))).toMatch(
				new RegExp(`,${ids.ben},Ben Example$`),
			);
			expect(csv.find((line) => line.startsWith(withoutDeputy))?.endsWith(",,")).toBe(true);
		});
	});
});
