/**
 * #1601 parity: for absence requests the approval route preview and the submit path agree on
 * routed, skipped or unroutable, and on who decides. Each case previews first, then submits for
 * real through `requestAbsenceForEmployeeEffect`.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readOnlyTransaction } from "@/db/read-only-transaction";
import { systemClock } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import type { ApprovalRoute } from "./types";

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/queue", async (original) =>
	(await import("@/test/integration-harness")).calendarSyncQueue(original),
);
vi.mock("@/lib/notifications/triggers", async (original) =>
	(await import("@/test/integration-harness")).notificationTriggers(original),
);
vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);

const { requestAbsenceForEmployeeEffect } = await import(
	"@/app/[locale]/(app)/absences/request-absence-effect"
);
const { previewApprovalRoutes } = await import("./preview");

type Seeded = { employeeId: string; userId: string };

describe("absence route parity (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let organizationId: string;
	let owner: Seeded;
	let subject: Seeded;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(async () => {
		organizationId = await fixture.createOrganization();
		await sql("update organization set timezone = 'Europe/Berlin' where id = $1", [organizationId]);
		owner = await fixture.seedEmployee({ organizationId, role: "owner" });
		subject = await seed("employee");
	});

	const sql = (text: string, values: unknown[] = []) => fixture.pool.query(text, values);

	async function seed(role: "employee" | "manager") {
		const seeded = await fixture.seedEmployee({
			organizationId,
			startDate: new Date("2020-01-01T00:00:00Z"),
		});
		await sql("update employee set role = $1 where id = $2", [role, seeded.employeeId]);
		return seeded;
	}

	async function managedBy(manager: Seeded) {
		await sql(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[subject.employeeId, manager.employeeId, owner.userId],
		);
	}

	/** The organization's only category; it counts against no vacation balance. */
	async function category(requiresApproval: boolean) {
		const id = randomUUID();
		await sql(
			`insert into absence_category
			 (id, organization_id, type, name, requires_approval, counts_against_vacation, is_active, updated_at)
			 values ($1, $2, 'personal', 'Personal', $3, false, true, now())`,
			[id, organizationId, requiresApproval],
		);
		return id;
	}

	/** A legacy absence policy with one stage naming one employee. */
	async function policyNaming(approverEmployeeId: string) {
		const { rows } = await sql(
			`insert into approval_policy (organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, 'Named', true, 1, $2, now()) returning id`,
			[organizationId, owner.userId],
		);
		await sql(
			`insert into approval_policy_condition (organization_id, policy_id, condition_type, operator, value_json, updated_at)
			 values ($1, $2, 'approval_type', 'equals', $3, now())`,
			[organizationId, rows[0].id, JSON.stringify({ value: "absence_entry" })],
		);
		await sql(
			`insert into approval_policy_stage
			 (organization_id, policy_id, step_order, label, approver_type, approver_employee_id, fallback_behavior, updated_at)
			 values ($1, $2, 1, 'Stage', 'specific_employee', $3, 'fail', now())`,
			[organizationId, rows[0].id, approverEmployeeId],
		);
	}

	async function preview(): Promise<ApprovalRoute | undefined> {
		const found = await readOnlyTransaction(fixture.db as unknown as DatabaseClient, (reader) =>
			previewApprovalRoutes(reader, {
				organizationId,
				at: systemClock.nowInstant(),
				requesters: [{ kind: "employee", employeeId: subject.employeeId }],
			}),
		);
		return found.routes.get(`employee:${subject.employeeId}`)?.get("absence");
	}

	function submit(categoryId: string) {
		return requestAbsenceForEmployeeEffect(
			{
				categoryId,
				startDate: "2026-12-07",
				startPeriod: "full_day",
				endDate: "2026-12-07",
				endPeriod: "full_day",
			},
			{ id: subject.employeeId, organizationId },
			subject.userId,
		);
	}

	const previewedApprovers = (route: ApprovalRoute | undefined) =>
		new Set(
			(route?.variants ?? []).flatMap(({ outcome }) =>
				outcome.kind === "routed"
					? outcome.stages
							.filter((stage) => stage.activation !== "not_activated")
							.flatMap((stage) => stage.approverEmployeeIds)
					: [],
			),
		);

	async function submittedAbsence() {
		const { rows } = await sql(
			"select id, status, approval_workflow_id from absence_entry where employee_id = $1",
			[subject.employeeId],
		);
		return rows[0] as
			| { id: string; status: string; approval_workflow_id: string | null }
			| undefined;
	}

	/** Who the submission asked to decide: legacy approval requests, or canonical assignments. */
	async function submittedApprovers(absence: { id: string; approval_workflow_id: string | null }) {
		const { rows } = absence.approval_workflow_id
			? await sql(
					"select approver_employee_id as id from approval_stage_assignment where workflow_id = $1",
					[absence.approval_workflow_id],
				)
			: await sql(
					`select approver_id as id from approval_request
					 where entity_type = 'absence_entry' and entity_id = $1`,
					[absence.id],
				);
		return new Set(rows.map((row) => row.id as string));
	}

	async function expectRoutedAlike(
		categoryId: string,
		expected: { approvers: string[]; autoCompleted: boolean },
	) {
		const route = await preview();
		const result = await submit(categoryId);

		expect(result).toMatchObject({ success: true });
		expect(route).toMatchObject({ kind: "routed", autoCompleted: expected.autoCompleted });
		const absence = await submittedAbsence();
		expect(absence?.status).toBe(expected.autoCompleted ? "approved" : "pending");
		if (!absence) return;
		expect(await submittedApprovers(absence)).toEqual(previewedApprovers(route));
		expect(previewedApprovers(route)).toEqual(new Set(expected.approvers));
	}

	it("skips a category that needs no approval: approved on submission, no request", async () => {
		const categoryId = await category(false);
		const manager = await seed("manager");
		await managedBy(manager);

		const route = await preview();
		const result = await submit(categoryId);

		expect(route).toMatchObject({ kind: "skipped", reason: "no_category_requires_approval" });
		expect(result).toMatchObject({ success: true });
		const absence = await submittedAbsence();
		expect(absence?.status).toBe("approved");
		if (absence) expect(await submittedApprovers(absence)).toEqual(new Set());
	});

	it("routes to the default approver when no policy matches", async () => {
		const categoryId = await category(true);
		const manager = await seed("manager");
		await managedBy(manager);

		await expectRoutedAlike(categoryId, { approvers: [manager.employeeId], autoCompleted: false });
	});

	it("is refused with no policy and no default approver", async () => {
		const categoryId = await category(true);

		const route = await preview();
		const result = await submit(categoryId);

		expect(route).toMatchObject({ kind: "unroutable", reason: { code: "no_default_approver" } });
		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "No manager assigned to approve absence requests",
		});
		expect(await submittedAbsence()).toBeUndefined();
	});

	it("falls back to the default approver when a matched policy can't resolve", async () => {
		const categoryId = await category(true);
		const manager = await seed("manager");
		await managedBy(manager);
		const departed = await seed("employee");
		await sql("update employee set is_active = false where id = $1", [departed.employeeId]);
		await policyNaming(departed.employeeId);

		await expectRoutedAlike(categoryId, { approvers: [manager.employeeId], autoCompleted: false });
	});

	it("is refused when a matched policy can't resolve and there is no default approver", async () => {
		const categoryId = await category(true);
		const departed = await seed("employee");
		await sql("update employee set is_active = false where id = $1", [departed.employeeId]);
		await policyNaming(departed.employeeId);

		const route = await preview();
		const result = await submit(categoryId);

		expect(route).toMatchObject({ kind: "unroutable", reason: { code: "no_default_approver" } });
		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "No manager assigned to approve absence requests",
		});
	});

	it("completes on submission when the requester is their own approver", async () => {
		const categoryId = await category(true);
		const manager = await seed("manager");
		await managedBy(manager);
		await policyNaming(subject.employeeId);

		await expectRoutedAlike(categoryId, { approvers: [subject.employeeId], autoCompleted: true });
	});

	it("routes through the canonical workflow under canonical authority", async () => {
		await sql(
			`insert into approval_workflow_rollout (organization_id, workflow_type, lifecycle_mode, side_effect_mode, updated_at)
			 values ($1, 'absence', 'canonical', 'canonical', now())`,
			[organizationId],
		);
		const categoryId = await category(true);
		const manager = await seed("manager");
		await managedBy(manager);

		await expectRoutedAlike(categoryId, { approvers: [manager.employeeId], autoCompleted: false });
		expect((await submittedAbsence())?.approval_workflow_id).toBeTruthy();
	});
});
