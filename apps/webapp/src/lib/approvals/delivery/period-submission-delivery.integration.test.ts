/**
 * #1059 runtime evidence: a period submission, a canonical-only kind with no legacy request,
 * gets its card on the approval delivery channels, bound to the approver's exact assignment and
 * submitted revision, and a card action decides it like any canonical kind.
 *
 * The real delivery owner expands the workflow's outbox, plans the work and prepares the shared
 * presentation; only the Telegram transport is replaced by a recording adapter.
 *
 * Local contract: pnpm --filter webapp test:integration
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";

const sent = vi.hoisted(() => ({
	cards: [] as unknown[],
	refreshes: [] as unknown[],
}));

vi.mock("@/lib/approvals/delivery/kick", async () =>
	(await import("@/test/integration-harness")).deliveryKick(),
);

vi.mock("@/lib/app-url", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/app-url")>()),
	getOrganizationBaseUrl: async () => "https://t1059.example.test",
}));

vi.mock("@/lib/telegram/approval-delivery", async () => {
	const { prepareApprovalPresentation } = await import("@/lib/approvals/presentation");
	return {
		telegramApprovalDeliveryAdapter: {
			provider: "telegram",
			acceptsEscalationDelivery: async () => false,
			async sendInitial(
				input: Parameters<typeof prepareApprovalPresentation>[0] & {
					approvalRequestId: string | null;
				},
			) {
				const card = await prepareApprovalPresentation({
					approvalId: input.approvalRequestId,
					...(input.canonicalAssignment ? { canonicalAssignment: input.canonicalAssignment } : {}),
					recipientEmployeeId: input.recipientEmployeeId,
					organizationId: input.organizationId,
					provider: "telegram",
				});
				if (card.status === "undisclosable") return { kind: "suppressed", reason: "not_entitled" };
				sent.cards.push(card);
				return {
					kind: "accepted",
					receiverScope: "telegram-bot:1059",
					destinationId: "chat-1059",
					remoteMessageId: String(sent.cards.length),
					bindingId: card.status === "actionable" ? card.bindingId : null,
					controls: card.status === "actionable" ? "actionable" : "none",
				};
			},
			async refresh(input: unknown) {
				sent.refreshes.push(input);
				return { kind: "accepted" };
			},
		},
	};
});

const { db } = await import("@/db");
const { createClosedMonthDatabaseFixture } = await import(
	"@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture"
);
const { submitPeriodSubmission } = await import(
	"@/lib/time-tracking/period-submissions/submission-service"
);
const { processApprovalDeliveries } = await import("./owner");
const { decideBoundPeriodSubmissionInvocation } = await import(
	"../server/period-submission-bound-decision"
);

type Fixture = Awaited<ReturnType<typeof createClosedMonthDatabaseFixture>>;

describe("period submission cards on PostgreSQL", () => {
	let fixture: Fixture;
	let organizationId: string;
	let employee: { employeeId: string; userId: string };
	let manager: { employeeId: string; userId: string };
	let workflowId: string;

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture.close();
	});

	beforeEach(async () => {
		sent.cards.length = 0;
		sent.refreshes.length = 0;
		const organization = await fixture.organization("Europe/Berlin");
		organizationId = organization.organizationId;
		employee = await fixture.employee({ organizationId });
		manager = await fixture.employee({ organizationId });
		await fixture.pool.query("update employee set role = 'manager' where id = $1", [
			manager.employeeId,
		]);
		await fixture.pool.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, true, $4)`,
			[randomUUID(), employee.employeeId, manager.employeeId, organization.ownerUserId],
		);
		await fixture.pool.query(
			`insert into period_submission_cadence_change
			 (id, organization_id, cadence, week_start_day, changed_at)
			 values ($1, $2, 'weekly', 'monday', '2026-01-01T00:00:00Z')`,
			[randomUUID(), organizationId],
		);
		await fixture.pool.query(
			`insert into approval_delivery_control (organization_id, workflow_type, provider, activated_at)
			 values ($1, 'period_submission', 'telegram', '2026-01-01T00:00:00Z')`,
			[organizationId],
		);
		await fixture.pool.query(
			`insert into approval_presentation_control (organization_id, workflow_type, provider, mode)
			 values ($1, 'period_submission', 'telegram', 'actionable')`,
			[organizationId],
		);
		await fixture.work({
			organizationId,
			employeeId: employee.employeeId,
			userId: employee.userId,
			start: "2026-03-04T08:00:00Z",
			end: "2026-03-04T16:00:00Z",
		});
		const submitted = await submitPeriodSubmission(
			{ organizationId, userId: employee.userId, periodStartDate: "2026-03-02" },
			{ database: db, clock: { nowInstant: () => parseInstant("2026-03-08T12:00:00Z") } },
		);
		if (submitted.kind !== "submitted") throw new Error(`not submitted: ${submitted.reason}`);
		workflowId = submitted.workflowId;
	});

	const deliver = () =>
		// Work is due from the database's now: the owner runs on the real clock.
		processApprovalDeliveries({ organizationId });

	it("sends the approver an actionable card with the employee, period and total", async () => {
		const summary = await deliver();
		expect(summary.outcomes).toEqual({ delivered: 1 });
		expect(sent.cards).toEqual([
			expect.objectContaining({
				status: "actionable",
				bindingId: expect.any(String),
				facts: expect.arrayContaining([expect.objectContaining({ value: "8:00 h" })]),
				reviewUrl: expect.stringContaining("/approvals/review/"),
			}),
		]);
		const { rows } = await fixture.pool.query(
			`select approval_request_id, assignment_id is not null as assigned, controls
			 from approval_delivery_message where organization_id = $1 and workflow_id = $2`,
			[organizationId, workflowId],
		);
		expect(rows).toEqual([{ approval_request_id: null, assigned: true, controls: "actionable" }]);
	});

	it("decides from the bound card, refreshes the card, and replays the same invocation", async () => {
		await deliver();
		const card = sent.cards[0] as { bindingId: string };
		const press = (invocationId: string) =>
			decideBoundPeriodSubmissionInvocation({
				database: db,
				organizationId,
				actorEmployeeId: manager.employeeId,
				actorUserId: manager.userId,
				bindingId: card.bindingId,
				action: "reject",
				reason: "Rejected via Telegram",
				invocation: {
					identity: {
						organizationId,
						scheme: "telegram_callback_query",
						schemeVersion: 1,
						receiverScope: "telegram-bot:1059",
						invocationId,
					},
					deliveryId: "update-1",
					providerActorId: "telegram-user-1059",
				},
			});
		const first = await press("callback-1");
		expect(first).toMatchObject({ status: "decided", replayed: false });
		await expect(press("callback-1")).resolves.toMatchObject({ status: "decided", replayed: true });
		await expect(press("callback-2")).resolves.toMatchObject({ status: "review_required" });

		const { rows } = await fixture.pool.query<{ status: string; decision_reason: string }>(
			"select status, decision_reason from period_submission where organization_id = $1",
			[organizationId],
		);
		expect(rows).toEqual([{ status: "rejected", decision_reason: "Rejected via Telegram" }]);

		await deliver();
		expect(sent.refreshes).toHaveLength(1);
	});

	it("never binds a card for anyone but the assigned approver", async () => {
		const { prepareApprovalPresentation } = await import("@/lib/approvals/presentation");
		const { rows } = await fixture.pool.query<{ id: string; stage_id: string }>(
			"select id, stage_id from approval_stage_assignment where organization_id = $1 and workflow_id = $2",
			[organizationId, workflowId],
		);
		const assignment = rows[0];
		if (!assignment) throw new Error("no assignment");
		await expect(
			prepareApprovalPresentation({
				approvalId: null,
				canonicalAssignment: {
					workflowId,
					stageId: assignment.stage_id,
					assignmentId: assignment.id,
				},
				recipientEmployeeId: employee.employeeId,
				organizationId,
				provider: "telegram",
			}),
		).resolves.toEqual({ status: "undisclosable" });
	});
});
