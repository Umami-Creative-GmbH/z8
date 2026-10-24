import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
	now: "2026-10-23T22:30:00Z",
}));

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);

vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `t1459-dashboard-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));

vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

vi.mock("@/lib/datetime/temporal-core", async (importOriginal) => {
	const original = await importOriginal<typeof import("@/lib/datetime/temporal-core")>();
	return { ...original, systemClock: { nowInstant: () => original.parseInstant(harness.now) } };
});

import { eq } from "drizzle-orm";
import {
	absenceCategory,
	absenceEntry,
	vacationAllowance,
	workPolicy,
	workPolicyAssignment,
	workPolicyPresence,
	workPolicySchedule,
} from "@/db/schema";

const traces = vi.hoisted(() => ({ queries: [] as string[] }));
vi.mock("@/db", async () =>
	(await import("@/test/integration-database")).integrationDbModule({
		logQuery: (query) => traces.queries.push(query),
	}),
);

import type { ServerWidgetId } from "./dashboard-types";

const { readDashboardWidget } = await import("./dashboard-reads");
const { logWaterIntake } = await import("@/app/[locale]/(app)/wellness/actions");
const { getPresenceStatus } = await import("@/app/[locale]/(app)/time-tracking/actions");

describe("scoped personal Dashboard snapshots", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
	let fixture: LifecycleDatabaseFixture;
	let subject: Awaited<ReturnType<LifecycleDatabaseFixture["seedEmployee"]>>;
	let birthdayId: string;
	let policyId: string;
	beforeAll(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
		fixture = await createLifecycleDatabaseFixture();
		subject = await fixture.seedEmployee();
		await fixture.pool.query(`update organization set timezone='Europe/Berlin' where id=$1`, [
			fixture.organizationId,
		]);
		await fixture.pool.query(`update employee set birthday='1990-10-24T00:00:00Z' where id=$1`, [
			fixture.employeeId,
		]);
		birthdayId = fixture.employeeId;
		await fixture.pool.query(
			`insert into user_settings (user_id,timezone,water_reminder_enabled,water_reminder_daily_goal,updated_at) values ($1,'Europe/Berlin',false,4,now())`,
			[subject.userId],
		);
		const [policy] = await fixture.db
			.insert(workPolicy)
			.values({
				organizationId: fixture.organizationId,
				name: "Presence",
				presenceEnabled: true,
				scheduleEnabled: true,
				createdBy: fixture.ownerUserId,
			})
			.returning();
		policyId = policy.id;
		await fixture.db.insert(workPolicySchedule).values({
			policyId,
			scheduleType: "simple",
			scheduleCycle: "weekly",
			workingDaysPreset: "weekdays",
		});
		await fixture.db.insert(workPolicyAssignment).values({
			policyId,
			organizationId: fixture.organizationId,
			assignmentType: "employee",
			employeeId: subject.employeeId,
			priority: 2,
			createdBy: fixture.ownerUserId,
		});
		await fixture.db.insert(workPolicyPresence).values({
			policyId,
			presenceMode: "minimum_count",
			evaluationPeriod: "weekly",
			requiredOnsiteDays: 3,
		});
	});
	beforeEach(() => {
		harness.userId = null;
		harness.organizationId = fixture.organizationId;
		harness.now = "2026-10-23T22:30:00Z";
	});
	afterAll(async () => {
		await fixture?.close();
		vi.useRealTimers();
	});
	async function read<K extends ServerWidgetId>(id: K) {
		const snapshot = await readDashboardWidget(id, {
			userId: subject.userId,
			organizationId: fixture.organizationId,
			employee: {
				id: subject.employeeId,
				organizationId: fixture.organizationId,
				role: "employee",
			},
		});
		if (!snapshot.result.success) throw new Error(snapshot.result.error);
		expect(await Response.json(snapshot).json()).toEqual(snapshot);
		return snapshot.result.data;
	}
	it("delivers a current-roster birthday on the organization's today even after UTC midnight differs", async () => {
		const data = await read("birthday-reminders");
		expect(data?.map((row) => row.id)).toEqual([birthdayId]);
		expect(data?.[0]).toMatchObject({ nextBirthday: "2026-10-24", daysUntil: 0 });
	});
	it("excludes birthdays outside the current organization roster and observes roster reductions immediately", async () => {
		const inactive = await fixture.seedEmployee({ isActive: false });
		const foreignOrganization = await fixture.createOrganization();
		const foreign = await fixture.seedEmployee({ organizationId: foreignOrganization });
		await fixture.pool.query(
			"update employee set birthday='1990-10-24T00:00:00Z' where id=any($1::uuid[])",
			[[inactive.employeeId, foreign.employeeId]],
		);
		expect((await read("birthday-reminders"))?.map((row) => row.id)).toEqual([birthdayId]);
		await fixture.pool.query("update employee set is_active=false where id=$1", [birthdayId]);
		try {
			expect(await read("birthday-reminders")).toEqual([]);
		} finally {
			await fixture.pool.query("update employee set is_active=true where id=$1", [birthdayId]);
		}
	});
	it("delivers a leap-day occurrence as a calendar date in the organization zone", async () => {
		harness.now = "2028-02-27T23:30:00Z";
		await fixture.pool.query("update employee set birthday='1992-02-29T00:00:00Z' where id=$1", [
			birthdayId,
		]);
		try {
			expect(await read("birthday-reminders")).toMatchObject([
				{ id: birthdayId, nextBirthday: "2028-02-29", daysUntil: 1 },
			]);
		} finally {
			await fixture.pool.query("update employee set birthday='1990-10-24T00:00:00Z' where id=$1", [
				birthdayId,
			]);
		}
	});
	it("does not query hydration data or preferences when disabled eligibility is already known in this render", async () => {
		traces.queries = [];
		const snapshot = await readDashboardWidget("hydration", {
			userId: subject.userId,
			organizationId: fixture.organizationId,
			employee: {
				id: subject.employeeId,
				organizationId: fixture.organizationId,
				role: "employee",
			},
			hydrationSettings: { waterReminderEnabled: false, waterReminderDailyGoal: 4 },
		});
		expect(snapshot.result.success && snapshot.result.data?.enabled).toBe(false);
		expect(traces.queries).toEqual([]);
	});
	it("checks fresh disabled hydration eligibility before loading personal or organization data", async () => {
		traces.queries = [];
		expect((await read("hydration"))?.enabled).toBe(false);
		expect(
			traces.queries.some((query) =>
				/hydration_stats|water_intake_log|team_membership/.test(query),
			),
		).toBe(false);
	});
	it("observes the authoritative water command on the immediately following scoped read", async () => {
		await fixture.pool.query(
			`update user_settings set water_reminder_enabled=true where user_id=$1`,
			[subject.userId],
		);
		harness.userId = subject.userId;
		try {
			const result = await logWaterIntake({ amount: 2, source: "widget" });
			if (!result.success) throw new Error(result.error);
			expect(result.data.todayIntake).toBe(2);
			harness.userId = null;
			const data = await read("hydration");
			expect(data).toMatchObject({ enabled: true, todayIntake: 2, dailyGoal: 4, goalProgress: 50 });
		} finally {
			await fixture.pool.query(
				`update user_settings set water_reminder_enabled=false where user_id=$1`,
				[subject.userId],
			);
		}
	});
	it("retains the canonical missing vacation policy state instead of manufacturing a zero balance", async () => {
		const data = await read("vacation-balance");
		expect(data?.year).toBe(2026);
		expect(data?.balance).toBeNull();
		expect(data?.configuration?.status).toBe("missing");
	});
	it("uses canonical vacation allowance and per-day half-day counting in the delivered balance", async () => {
		await fixture.db
			.insert(vacationAllowance)
			.values({
				organizationId: fixture.organizationId,
				name: "Annual",
				startDate: "2020-01-01",
				isCompanyDefault: true,
				defaultAnnualDays: "30",
				statutoryMinimumDays: "20",
				accrualType: "annual",
				createdBy: fixture.ownerUserId,
			})
			.returning();
		const [category] = await fixture.db
			.insert(absenceCategory)
			.values({
				organizationId: fixture.organizationId,
				type: "vacation",
				name: "Vacation",
				countsAgainstVacation: true,
			})
			.returning();
		const [absence] = await fixture.db
			.insert(absenceEntry)
			.values({
				organizationId: fixture.organizationId,
				employeeId: subject.employeeId,
				categoryId: category.id,
				startDate: "2026-10-19",
				endDate: "2026-10-19",
				startPeriod: "pm",
				endPeriod: "pm",
				status: "approved",
			})
			.returning();
		try {
			const data = await read("vacation-balance");
			expect(data?.balance).toMatchObject({
				totalDays: 30,
				usedDays: 0.5,
				pendingDays: 0,
				remainingDays: 29.5,
			});
		} finally {
			await fixture.db.delete(absenceEntry).where(eq(absenceEntry.id, absence.id));
			await fixture.db.delete(absenceCategory).where(eq(absenceCategory.id, category.id));
			// Dated policy history is removed only by the fixture tenant cascade.
		}
	});
	it("shares the real presence calculation with the fresh action, excluding deleted work and reading new work immediately", async () => {
		const seedWork = async (date: string, deleted: boolean) => {
			const entryId = randomUUID(),
				periodId = randomUUID();
			await fixture.pool.query(
				`insert into time_entry (id,employee_id,organization_id,type,timestamp,utc_offset_minutes,timezone,timezone_source,hash,created_by) values ($1::uuid,$2,$3,'clock_in',$4,120,'Europe/Berlin','backfill',$1::text,$5)`,
				[entryId, subject.employeeId, fixture.organizationId, date, subject.userId],
			);
			await fixture.pool.query(
				`insert into work_period (id,employee_id,organization_id,clock_in_id,start_time,work_location_type,deleted_at,updated_at) values ($1,$2,$3,$4,$5,'office',$6,now())`,
				[
					periodId,
					subject.employeeId,
					fixture.organizationId,
					entryId,
					date,
					deleted ? "2026-10-23T12:00:00Z" : null,
				],
			);
		};
		await seedWork("2026-10-19T08:00:00Z", false);
		await seedWork("2026-10-20T08:00:00Z", true);
		const first = await read("presence-status");
		expect(first?.presenceEnabled).toBe(true);
		expect(first?.available).toBe(true);
		expect(first?.officeDaysCompleted).toBe(1);
		harness.userId = subject.userId;
		const action = await getPresenceStatus(subject.employeeId);
		if (!action.success) throw new Error(action.error);
		expect(action.data).toEqual(first);
		await seedWork("2026-10-21T08:00:00Z", false);
		expect((await read("presence-status"))?.officeDaysCompleted).toBe(2);
	});
	it("does not load attendance when the effective presence feature is disabled", async () => {
		await fixture.db
			.update(workPolicy)
			.set({ presenceEnabled: false })
			.where(eq(workPolicy.id, policyId));
		try {
			traces.queries = [];
			expect((await read("presence-status"))?.presenceEnabled).toBe(false);
			expect(traces.queries.some((query) => /work_period|absence_entry/.test(query))).toBe(false);
		} finally {
			await fixture.db
				.update(workPolicy)
				.set({ presenceEnabled: true })
				.where(eq(workPolicy.id, policyId));
		}
	});
});
