/**
 * #1600 parity: for period submissions the approval route preview and the submit path agree on
 * routed or unroutable, and on who decides. Each case previews first, then submits for real.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { readOnlyTransaction } from "@/db/read-only-transaction";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import { submitPeriodSubmission } from "@/lib/time-tracking/period-submissions/submission-service";
import { previewApprovalRoutes } from "./preview";
import type { ApprovalRoute } from "./types";

const WEEK_START = "2026-03-02";
const LAST_DAY = parseInstant("2026-03-08T12:00:00Z");

describe("period submission route parity (PostgreSQL)", () => {
	let fixture: ClosedMonthDatabaseFixture;
	let organizationId: string;
	let ownerUserId: string;
	let subject: { employeeId: string; userId: string };

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture.close();
	});

	beforeEach(async () => {
		({ organizationId, ownerUserId } = await fixture.organization("Europe/Berlin"));
		subject = await fixture.employee({ organizationId });
		await fixture.pool.query(
			`insert into period_submission_cadence_change
			 (id, organization_id, cadence, week_start_day, changed_at)
			 values ($1, $2, 'weekly', 'monday', '2026-01-01T00:00:00Z')`,
			[randomUUID(), organizationId],
		);
		await fixture.work({
			organizationId,
			employeeId: subject.employeeId,
			userId: subject.userId,
			start: "2026-03-02T07:00:00Z",
			end: "2026-03-02T15:30:00Z",
		});
	});

	const sql = (text: string, values: unknown[] = []) => fixture.pool.query(text, values);

	async function employeeWithRole(role: "manager" | "admin") {
		const seeded = await fixture.employee({ organizationId });
		await sql("update employee set role = $1 where id = $2", [role, seeded.employeeId]);
		return seeded;
	}

	async function preview(): Promise<ApprovalRoute | undefined> {
		const found = await readOnlyTransaction(db as unknown as DatabaseClient, (reader) =>
			previewApprovalRoutes(reader, {
				organizationId,
				at: LAST_DAY,
				requesters: [{ kind: "employee", employeeId: subject.employeeId }],
			}),
		);
		return found.routes.get(`employee:${subject.employeeId}`)?.get("period_submission");
	}

	const submit = () =>
		submitPeriodSubmission(
			{ organizationId, userId: subject.userId, periodStartDate: WEEK_START },
			{ database: db, clock: { nowInstant: () => LAST_DAY } },
		);

	const firstApprovers = (route: ApprovalRoute | undefined) =>
		new Set(
			(route?.variants ?? []).flatMap(({ outcome }) =>
				outcome.kind === "routed"
					? outcome.stages
							.filter((stage) => stage.activation !== "not_activated")
							.flatMap((stage) => stage.approverEmployeeIds)
					: [],
			),
		);

	async function expectRoutedAlike(expectedApprovers: string[]) {
		const route = await preview();
		const submitted = await submit();
		expect(route?.kind).toBe("routed");
		expect(submitted).toMatchObject({ kind: "submitted" });
		if (submitted.kind !== "submitted") return;
		expect(new Set(submitted.approverEmployeeIds)).toEqual(firstApprovers(route));
		expect(firstApprovers(route)).toEqual(new Set(expectedApprovers));
	}

	async function expectRefusedAlike(
		reason: string,
		unroutable: Extract<ApprovalRoute, { kind: "unroutable" }>["reason"]["code"],
	) {
		const route = await preview();
		const submitted = await submit();
		expect(route).toMatchObject({ kind: "unroutable", reason: { code: unroutable } });
		expect(submitted).toEqual({ kind: "refused", reason });
	}

	it("routes to the primary manager", async () => {
		const manager = await employeeWithRole("manager");
		await sql(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, true, $4)`,
			[randomUUID(), subject.employeeId, manager.employeeId, ownerUserId],
		);

		await expectRoutedAlike([manager.employeeId]);
	});

	it("routes through a matching period submission policy", async () => {
		const admin = await employeeWithRole("admin");
		const { rows } = await sql(
			`insert into approval_policy (organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, 'Admins', true, 1, $2, now()) returning id`,
			[organizationId, ownerUserId],
		);
		await sql(
			`insert into approval_policy_condition (organization_id, policy_id, condition_type, operator, value_json, updated_at)
			 values ($1, $2, 'approval_type', 'equals', $3, now())`,
			[organizationId, rows[0].id, JSON.stringify({ value: "period_submission" })],
		);
		await sql(
			`insert into approval_policy_stage
			 (organization_id, policy_id, step_order, label, approver_type, fallback_behavior, updated_at)
			 values ($1, $2, 1, 'Stage', 'org_admin', 'fail', now())`,
			[organizationId, rows[0].id],
		);
		const { rows: admins } = await sql(
			`select id from employee where organization_id = $1 and role = 'admin' and is_active`,
			[organizationId],
		);

		await expectRoutedAlike(admins.map((row) => row.id as string));
		expect(admins.map((row) => row.id)).toContain(admin.employeeId);
	});

	it("is refused with nobody to decide", async () => {
		await expectRefusedAlike("no_approver", "no_default_approver");
	});

	it("is refused outside complete mode", async () => {
		await sql(
			`insert into approval_workflow_rollout (organization_id, workflow_type, lifecycle_mode, side_effect_mode, updated_at)
			 values ($1, 'period_submission', 'canonical', 'canonical', now())`,
			[organizationId],
		);

		await expectRefusedAlike("write_gate_closed", "approval_mode_unsupported");
	});
});
