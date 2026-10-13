/**
 * #1143: skill expiry reminders against a disposable PostgreSQL database. The
 * hourly job runs with a fixed clock; notification delivery is replaced by a
 * recorder, so the assertions read who was told what. Only the session is
 * mocked for the lead time setting.
 */

import { randomUUID } from "node:crypto";
import { Effect, Layer } from "effect";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import type { CreateNotificationParams } from "@/lib/notifications/types";

const sent = vi.hoisted(() => [] as CreateNotificationParams[]);
const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: null as string | null,
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
								id: `t1143-session-${harness.userId}`,
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
vi.mock("@/lib/notifications/notification-service", () => ({
	createNotification: async (params: CreateNotificationParams) => {
		sent.push(params);
		return null;
	},
}));

const { db } = await import("@/db");
const { runSkillExpiryReminders } = await import("./skill-expiry-reminders");
const { loadSkillReminderLeadDays } = await import("./skill-reminder-store");
const { loadOwnSkills } = await import("./own-skills");
const { saveSkillReminderLeadDays } = await import("@/app/[locale]/(app)/settings/skills/actions");
const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");
const { SkillService, SkillServiceLive } = await import("@/lib/effect/services/skill.service");

const at = (value: string) => Temporal.Instant.from(value);
const run = (instant: string) => runSkillExpiryReminders(db, { now: at(instant) });

/** Notifications about one employee skill, as sorted `user:type` pairs. */
function toldAbout(employeeSkillId: string): string[] {
	return sent
		.filter((notification) => notification.entityId === employeeSkillId)
		.map((notification) => `${notification.userId}:${notification.type}`)
		.toSorted();
}

const pairs = (users: string[], type: string) => users.map((user) => `${user}:${type}`).toSorted();

describe("skill expiry reminders (#1143)", () => {
	vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

	let fixture: LifecycleDatabaseFixture;
	let org: string;
	let otherOrg: string;
	let admin: SeededEmployee;
	let anna: SeededEmployee;
	let manager: SeededEmployee;
	let formerManager: SeededEmployee;
	let ben: SeededEmployee;
	let leaver: SeededEmployee;
	let foreignOwner: SeededEmployee;
	let foreignEmployee: SeededEmployee;
	let forklift: string;
	let retired: string;
	const employeeSkills = {
		annaForklift: "",
		annaRetired: "",
		benForklift: "",
		leaverForklift: "",
		foreignForklift: "",
		annaLater: "",
	};

	async function createSkill(organizationId: string, name: string, isActive = true) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into skill (id, organization_id, name, category, requires_expiry, is_active, created_by, updated_at)
			 values ($1, $2, $3, 'certification', true, $4, $5, now())`,
			[id, organizationId, name, isActive, fixture.ownerUserId],
		);
		return id;
	}

	async function assign(employee: SeededEmployee, skillId: string, expiresAt: string | null) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into employee_skill (id, employee_id, skill_id, expires_at, assigned_by)
			 values ($1, $2, $3, $4, $5)`,
			[id, employee.employeeId, skillId, expiresAt, fixture.ownerUserId],
		);
		return id;
	}

	async function manage(employee: SeededEmployee, by: SeededEmployee) {
		await fixture.pool.query(`update employee set role = 'manager' where id = $1`, [by.employeeId]);
		await fixture.pool.query(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, false, $3)`,
			[employee.employeeId, by.employeeId, fixture.ownerUserId],
		);
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		org = fixture.organizationId;
		otherOrg = await fixture.createOrganization();
		await fixture.pool.query(
			`update organization set timezone = 'Europe/Berlin' where id = any($1)`,
			[[org, otherOrg]],
		);
		admin = await fixture.seedEmployee({ role: "admin" });
		anna = await fixture.seedEmployee();
		manager = await fixture.seedEmployee();
		formerManager = await fixture.seedEmployee();
		ben = await fixture.seedEmployee();
		leaver = await fixture.seedEmployee({ isActive: false });
		foreignOwner = await fixture.seedEmployee({ organizationId: otherOrg, role: "owner" });
		foreignEmployee = await fixture.seedEmployee({ organizationId: otherOrg });
		await manage(anna, manager);
		await manage(anna, formerManager);
		await manage(leaver, manager);
		await fixture.pool.query(`update employee set is_active = false where id = $1`, [
			formerManager.employeeId,
		]);

		forklift = await createSkill(org, "Forklift licence");
		retired = await createSkill(org, "Retired certificate", false);
		const foreignForklift = await createSkill(otherOrg, "Forklift licence");
		employeeSkills.annaForklift = await assign(anna, forklift, "2026-11-30");
		employeeSkills.annaRetired = await assign(anna, retired, "2026-11-30");
		employeeSkills.benForklift = await assign(ben, forklift, "2026-11-30");
		employeeSkills.leaverForklift = await assign(leaver, forklift, "2026-11-30");
		employeeSkills.foreignForklift = await assign(foreignEmployee, foreignForklift, "2026-11-30");
	});

	afterAll(async () => {
		harness.userId = null;
		await fixture?.close();
	});

	beforeEach(() => {
		sent.length = 0;
	});

	describe("the job", () => {
		it("sends nothing before the lead time starts in the organization's timezone", async () => {
			// 30 October 23:30 in Berlin: one day before the 30-day lead time.
			await run("2026-10-30T22:30:00Z");
			expect(toldAbout(employeeSkills.annaForklift)).toEqual([]);
		});

		it("sends the expires-soon reminder to the employee and their managers once the org's day is within the lead time", async () => {
			// 30 October 23:30 UTC is already 31 October in Berlin.
			const result = await run("2026-10-30T23:30:00Z");
			expect(result.success).toBe(true);
			expect(toldAbout(employeeSkills.annaForklift)).toEqual(
				pairs([anna.userId, manager.userId], "skill_expiry_upcoming"),
			);
			const own = sent.find(
				(notification) =>
					notification.entityId === employeeSkills.annaForklift &&
					notification.userId === anna.userId,
			);
			expect(own).toMatchObject({
				organizationId: org,
				actionUrl: "/settings/profile#skills",
				metadata: expect.objectContaining({ expiryDate: "2026-11-30" }),
			});
			const managers = sent.find(
				(notification) =>
					notification.entityId === employeeSkills.annaForklift &&
					notification.userId === manager.userId,
			);
			expect(managers?.actionUrl).toBe(`/settings/employees/${anna.employeeId}`);
		});

		it("tells owners and admins instead when the employee has no manager", async () => {
			// Ben's reminder went out with the previous run.
			await fixture.pool.query("delete from skill_expiry_reminder where employee_skill_id = $1", [
				employeeSkills.benForklift,
			]);
			await run("2026-10-31T09:00:00Z");
			expect(toldAbout(employeeSkills.benForklift)).toEqual(
				pairs([ben.userId, fixture.ownerUserId, admin.userId], "skill_expiry_upcoming"),
			);
		});

		it("keeps each organization's reminders to its own people", async () => {
			await fixture.pool.query("delete from skill_expiry_reminder where employee_skill_id = $1", [
				employeeSkills.foreignForklift,
			]);
			await run("2026-10-31T09:00:00Z");
			expect(toldAbout(employeeSkills.foreignForklift)).toEqual(
				pairs([foreignEmployee.userId, foreignOwner.userId], "skill_expiry_upcoming"),
			);
			expect(
				sent
					.filter((notification) => notification.entityId === employeeSkills.foreignForklift)
					.every((notification) => notification.organizationId === otherOrg),
			).toBe(true);
		});

		it("sends nothing new when the job runs again the same day", async () => {
			await run("2026-10-31T10:00:00Z");
			await run("2026-10-31T11:00:00Z");
			expect(sent).toEqual([]);
		});

		it("sends the expires-today reminder on the skill expiry date, once", async () => {
			await run("2026-11-30T08:00:00Z");
			expect(toldAbout(employeeSkills.annaForklift)).toEqual(
				pairs([anna.userId, manager.userId], "skill_expired_today"),
			);
			sent.length = 0;
			await run("2026-11-30T12:00:00Z");
			expect(toldAbout(employeeSkills.annaForklift)).toEqual([]);
		});

		it("never reminds about former employees or inactive skills", async () => {
			for (const instant of ["2026-10-31T09:00:00Z", "2026-11-30T09:00:00Z"]) {
				await run(instant);
			}
			expect(toldAbout(employeeSkills.leaverForklift)).toEqual([]);
			expect(toldAbout(employeeSkills.annaRetired)).toEqual([]);
			expect(sent.some((notification) => notification.userId === formerManager.userId)).toBe(false);
		});

		it("re-arms both reminders when the skill expiry date moves", async () => {
			await fixture.pool.query(
				"update employee_skill set expires_at = '2027-03-31' where id = $1",
				[employeeSkills.annaForklift],
			);
			await run("2027-03-01T08:00:00Z");
			expect(toldAbout(employeeSkills.annaForklift)).toEqual(
				pairs([anna.userId, manager.userId], "skill_expiry_upcoming"),
			);
			sent.length = 0;
			await run("2027-03-31T08:00:00Z");
			expect(toldAbout(employeeSkills.annaForklift)).toEqual(
				pairs([anna.userId, manager.userId], "skill_expired_today"),
			);
		});
	});

	describe("the employee's own skills (the reminder's link target)", () => {
		it("lists only the employee's skills of their organization, with today and the lead time", async () => {
			const own = await loadOwnSkills(db, {
				organizationId: org,
				employeeId: ben.employeeId,
				now: at("2026-11-01T08:00:00Z"),
			});
			expect(own).toEqual({
				today: "2026-11-01",
				expiringSoonDays: 30,
				skills: [
					{ id: employeeSkills.benForklift, name: "Forklift licence", expiresAt: "2026-11-30" },
				],
			});
			expect(
				(
					await loadOwnSkills(db, {
						organizationId: otherOrg,
						employeeId: ben.employeeId,
						now: at("2026-11-01T08:00:00Z"),
					})
				).skills,
			).toEqual([]);
		});
	});

	describe("the lead time setting", () => {
		const window = (organizationId: string, now: string) =>
			Effect.runPromise(
				Effect.gen(function* () {
					return yield* (yield* SkillService).getSkillExpiryWindow(organizationId, at(now));
				}).pipe(Effect.provide(Layer.provide(SkillServiceLive, DatabaseServiceLive))),
			);

		it("defaults to 30 days", async () => {
			expect(await loadSkillReminderLeadDays(db, org)).toBe(30);
			expect(await window(org, "2026-10-30T23:30:00Z")).toEqual({
				today: "2026-10-31",
				expiringSoonDays: 30,
			});
		});

		it("lets owners and admins change it for their own organization only", async () => {
			harness.organizationId = org;
			harness.userId = admin.userId;
			expect(await saveSkillReminderLeadDays({ leadDays: "7" })).toEqual({
				success: true,
				data: { leadDays: 7 },
			});
			expect(await loadSkillReminderLeadDays(db, org)).toBe(7);
			expect(await loadSkillReminderLeadDays(db, otherOrg)).toBe(30);
		});

		it("refuses managers and employees", async () => {
			harness.organizationId = org;
			for (const person of [manager, anna]) {
				harness.userId = person.userId;
				expect(await saveSkillReminderLeadDays({ leadDays: 60 })).toMatchObject({
					success: false,
				});
			}
			expect(await loadSkillReminderLeadDays(db, org)).toBe(7);
		});

		it("refuses a lead time outside 1 to 365 days", async () => {
			harness.organizationId = org;
			harness.userId = fixture.ownerUserId;
			for (const leadDays of [0, 366, 1.5, "abc", null]) {
				expect(await saveSkillReminderLeadDays({ leadDays })).toMatchObject({
					success: false,
					error: "Enter a lead time between 1 and 365 days.",
				});
			}
			expect(await loadSkillReminderLeadDays(db, org)).toBe(7);
		});

		it("moves the badge window and the reminders with it", async () => {
			expect(await window(org, "2027-06-22T08:00:00Z")).toEqual({
				today: "2027-06-22",
				expiringSoonDays: 7,
			});
			employeeSkills.annaLater = await assign(
				anna,
				await createSkill(org, "First aid"),
				"2027-06-30",
			);
			// 22 June is 8 days before; 23 June is within the 7-day lead time.
			await run("2027-06-22T08:00:00Z");
			expect(toldAbout(employeeSkills.annaLater)).toEqual([]);
			await run("2027-06-23T08:00:00Z");
			expect(toldAbout(employeeSkills.annaLater)).toEqual(
				pairs([anna.userId, manager.userId], "skill_expiry_upcoming"),
			);
		});
	});
});
