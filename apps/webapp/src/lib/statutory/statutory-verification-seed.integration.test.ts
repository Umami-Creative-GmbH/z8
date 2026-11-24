/**
 * #2018: the development seed for live verification (`pnpm db:seed:statutory-verification`)
 * produces every statutory warning Scheduling and Staffing show, gives the scoped manager the team
 * permissions the shift dialog needs, and creates logins that work. Real PostgreSQL.
 */
import { verifyPassword } from "better-auth/crypto";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { integrationAdminPool } from "@/test/integration-database";
import {
	STATUTORY_VERIFICATION_ORGANIZATION_ID as organizationId,
	removeStatutoryVerificationSeed,
	seedStatutoryVerification,
	type StatutoryVerificationPerson,
} from "./__tests__/verification-seed";
import type { StatutoryFinding } from "./finding";
import { evaluateStatutoryFindings } from "./scheduling/evaluate";

/** Tuesday 24 November 2026, 11:00 in Berlin. */
const now = Temporal.Instant.from("2026-11-24T10:00:00Z");
const password = "seed-test-password";

describe("statutory verification seed (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 120_000 });
	const admin = integrationAdminPool();
	let people: Map<string, StatutoryVerificationPerson>;
	let findings: StatutoryFinding[];

	beforeAll(async () => {
		await removeStatutoryVerificationSeed(admin);
		const seeded = await seedStatutoryVerification(admin, { password, now });
		people = new Map(seeded.map((person) => [person.key, person]));
		// The planning horizon a planner pages through: this week and the next four.
		findings = await evaluateStatutoryFindings(db, {
			organizationId,
			timezone: "Europe/Berlin",
			window: { start: "2026-11-23", endExclusive: "2026-12-28" },
			employeeIds: seeded.map((person) => person.employeeId),
			now,
		});
	});
	afterAll(() => removeStatutoryVerificationSeed(admin));

	function kindsOf(key: string): string[] {
		const employeeId = people.get(key)?.employeeId;
		return findings
			.filter((finding) => finding.employeeId === employeeId)
			.map((finding) => `${finding.kind}:${finding.severity}`);
	}

	it("produces a warning of every statutory monitor", () => {
		expect(kindsOf("mini-warn")).toContain("minijob_monthly_cap:warning");
		expect(kindsOf("mini-over")).toContain("minijob_monthly_cap:critical");
		expect(kindsOf("seasonal")).toContain("short_term_work_days:warning");
		expect(kindsOf("student")).toEqual(
			expect.arrayContaining([
				expect.stringMatching(/^working_student_lecture_week:/),
				expect.stringMatching(/^working_student_26_week_ceiling:/),
			]),
		);
		expect(kindsOf("on-call")).toContain("on_call_short_notice:warning");
		expect(kindsOf("apprentice")).toEqual(
			expect.arrayContaining([
				"jarbschg_night_work:critical",
				"jarbschg_saturday_work:critical",
				"jarbschg_school_day_workplace_return:critical",
				"bbig_release_day_shift:critical",
			]),
		);
	});

	it("leaves the JArbSchG publish block off, and the apprentice's drafts blocked once it is on", async () => {
		const apprentice = people.get("apprentice")?.employeeId ?? "";
		const blockingDrafts = async () => {
			const judged = await evaluateStatutoryFindings(db, {
				organizationId,
				timezone: "Europe/Berlin",
				window: { start: "2026-11-30", endExclusive: "2026-12-07" },
				employeeIds: [apprentice],
				now,
			});
			return judged.filter((finding) => finding.blocksPublication).map((finding) => finding.kind);
		};
		expect(await blockingDrafts()).toEqual([]);

		await admin.query(
			`UPDATE organization_statutory_preference SET block_jarbschg_shift_publish = true
			 WHERE organization_id = $1`,
			[organizationId],
		);
		try {
			expect(await blockingDrafts()).toEqual(
				expect.arrayContaining(["jarbschg_night_work", "jarbschg_saturday_work"]),
			);
		} finally {
			await admin.query(
				`UPDATE organization_statutory_preference SET block_jarbschg_shift_publish = false
				 WHERE organization_id = $1`,
				[organizationId],
			);
		}
	});

	it("gives the scoped manager the team permissions the shift dialog needs", async () => {
		const manager = people.get("manager")?.employeeId;
		const {
			rows: [scope],
		} = await admin.query<{ teams: number; subareas: number; reports: number; templates: number }>(
			`SELECT
				(SELECT count(*)::int FROM team_permissions
				 WHERE employee_id = $1 AND can_manage_team_settings AND team_id IS NOT NULL) AS teams,
				(SELECT count(*)::int FROM subarea_employee WHERE employee_id = $1) AS subareas,
				(SELECT count(*)::int FROM employee_managers WHERE manager_id = $1) AS reports,
				(SELECT count(*)::int FROM shift_template t
				 WHERE t.organization_id = $2 AND t.subarea_id IN (
					SELECT se.subarea_id FROM subarea_employee se
					JOIN employee e ON e.id = se.employee_id
					JOIN team_permissions tp ON tp.team_id = e.team_id
					WHERE tp.employee_id = $1 AND tp.can_manage_team_settings)) AS templates`,
			[manager, organizationId],
		);
		expect(scope).toEqual({ teams: 1, subareas: 1, reports: 6, templates: 3 });
	});

	it("creates logins that sign in without onboarding or email verification", async () => {
		const { rows } = await admin.query<{
			email: string;
			email_verified: boolean;
			onboarding_complete: boolean;
			password: string;
			member_status: string;
		}>(
			`SELECT u.email, u.email_verified, s.onboarding_complete, a.password, m.status AS member_status
			 FROM "user" u
			 JOIN account a ON a.user_id = u.id AND a.provider_id = 'credential'
			 JOIN user_settings s ON s.user_id = u.id
			 JOIN member m ON m.user_id = u.id AND m.organization_id = $1
			 ORDER BY u.email`,
			[organizationId],
		);
		expect(rows).toHaveLength(9);
		for (const row of rows) {
			expect(row.email).toMatch(/^stv-[a-z-]+@example\.test$/);
			expect(row).toMatchObject({
				email_verified: true,
				onboarding_complete: true,
				member_status: "approved",
			});
			expect(await verifyPassword({ hash: row.password, password })).toBe(true);
		}
	});

	it("stores recorded work in UTC, whatever the seeding process's time zone", async () => {
		const {
			rows: [first],
		} = await admin.query<{ start: string }>(
			`SELECT to_char(wp.start_time, 'YYYY-MM-DD"T"HH24:MI') AS start
			 FROM work_period wp WHERE wp.employee_id = $1 ORDER BY wp.start_time LIMIT 1`,
			[people.get("student")?.employeeId],
		);
		// Monday 16 November 2026, 14:00 in Berlin.
		expect(first?.start).toBe("2026-11-16T13:00");
	});
});
