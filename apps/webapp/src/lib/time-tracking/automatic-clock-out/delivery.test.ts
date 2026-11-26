import { describe, expect, it, vi } from "vitest";
import {
	DurableDispatchConfirmedUnsentError,
	DurableDispatchUncertainError,
} from "@/lib/chat-installations/durable-dispatch";
import {
	type AutoClockOutDurableChatDispatchGuard,
	executeDurableChatChannelDelivery,
} from "./delivery";
import { runAutoClockOutFollowUps } from "./follow-ups";
import { decision } from "./testing.test.fixture";

describe("durable automatic follow-ups", () => {
	it("resumes after the failed step without repeating completed compliance and breaks", async () => {
		const d = decision();
		const progress: Record<string, unknown> = {};
		const effects = {
			checkCompliance: vi.fn(async () => []),
			recordYouthProtection: vi.fn(async () => {}),
			enforceBreaks: vi.fn(async () => ({
				wasAdjusted: false,
				affectedWorkPeriodIds: [d.workPeriodId],
			})),
			reconcileSurcharges: vi.fn(),
			markBalanceDirty: vi
				.fn()
				.mockRejectedValueOnce(new Error("offline"))
				.mockResolvedValue(undefined),
			checkProjectBudget: vi.fn(),
		};
		const closure = {
			...d,
			end: d.cutoff,
			durationMinutes: 720,
			actorUserId: d.provenanceUserId,
			projectId: "project",
			surchargeSnapshot: null,
			balanceRefreshCommitted: false,
		};
		const context = {
			recordProgress: async (patch: Record<string, unknown>) => {
				Object.assign(progress, patch);
			},
		};
		await expect(runAutoClockOutFollowUps(closure, progress, context, effects)).rejects.toThrow(
			"offline",
		);
		await runAutoClockOutFollowUps(closure, progress, context, effects);
		expect(effects.checkCompliance).toHaveBeenCalledTimes(1);
		expect(effects.recordYouthProtection).toHaveBeenCalledTimes(1);
		expect(effects.enforceBreaks).toHaveBeenCalledTimes(1);
		expect(effects.markBalanceDirty).toHaveBeenCalledTimes(2);
		expect(effects.checkProjectBudget).toHaveBeenCalledTimes(1);
		await runAutoClockOutFollowUps(closure, progress, context, effects);
		expect(effects.checkProjectBudget).toHaveBeenCalledTimes(1);
	});
	it("honors the committed balance intent while retaining the break owner's idempotent reconciliation", async () => {
		const d = decision();
		const effects = {
			checkCompliance: vi.fn(async () => []),
			recordYouthProtection: vi.fn(async () => {}),
			enforceBreaks: vi.fn(async () => ({
				wasAdjusted: false,
				affectedWorkPeriodIds: [d.workPeriodId],
			})),
			reconcileSurcharges: vi.fn(),
			markBalanceDirty: vi.fn(),
			checkProjectBudget: vi.fn(),
		};
		await runAutoClockOutFollowUps(
			{
				...d,
				end: d.cutoff,
				durationMinutes: 720,
				actorUserId: d.provenanceUserId,
				projectId: null,
				surchargeSnapshot: null,
				balanceRefreshCommitted: true,
			},
			{},
			{ recordProgress: async () => {} },
			effects,
		);
		expect(effects.markBalanceDirty).not.toHaveBeenCalled();
		expect(effects.enforceBreaks).toHaveBeenCalledTimes(1);
	});
});

describe("durable chat channel delivery guard in automatic clock-out", () => {
	const baseNotification = {
		organizationId: "org-1",
		userId: "user-1",
		type: "automatic_clock_out" as const,
		title: "Automatically clocked out",
		message: "Your shift ended.",
	};

	const makeAttempt = (
		overrides: Partial<{
			id: string;
			installationId: string | null;
			credentialRevisionId: string | null;
			status:
				| "intent_recorded"
				| "confirmed_unsent"
				| "sent"
				| "reconciliation_required"
				| "closed_unknown";
			attemptNumber: number;
		}> = {},
	) => ({
		id: overrides.id ?? "attempt-1",
		organizationId: "org-1",
		provider: "slack" as const,
		sourceKind: "persistent_notification" as const,
		sourceRefId: "task-1",
		dedupeKey: "notification:op-1:user-1:slack",
		installationId: overrides.installationId !== undefined ? overrides.installationId : "inst-1",
		credentialRevisionId:
			overrides.credentialRevisionId !== undefined ? overrides.credentialRevisionId : "rev-1",
		status: overrides.status ?? "intent_recorded",
		attemptNumber: overrides.attemptNumber ?? 1,
		intentRecordedAt: new Date("2026-11-26T10:00:00.000Z"),
		providerCalledAt: null,
		completedAt: null,
		reconciliationRequiredAt: null,
		unknownClosedAt: null,
		failureClassification: null,
		redactedDiagnostics: null,
		createdAt: new Date("2026-11-26T10:00:00.000Z"),
		updatedAt: new Date("2026-11-26T10:00:00.000Z"),
	});

	it("commits dispatch intent before invoking transport.deliver and binds the recorded installation", async () => {
		const order: string[] = [];
		const guard: AutoClockOutDurableChatDispatchGuard = {
			recordIntent: vi.fn(async () => {
				order.push("record_intent");
				return { kind: "proceed", attempt: makeAttempt(), reroutedFromAttemptId: null };
			}),
			markSent: vi.fn(async () => {
				order.push("mark_sent");
			}),
			markConfirmedUnsent: vi.fn(),
			markUncertain: vi.fn(),
			hasActiveInstallation: vi.fn(async () => true),
		};
		const deliver = vi.fn(async () => {
			order.push("deliver");
			return "sent" as const;
		});

		const result = await executeDurableChatChannelDelivery({
			organizationId: "org-1",
			provider: "slack",
			sourceRefId: "task-1",
			dedupeKey: "notification:op-1:user-1:slack",
			notification: baseNotification,
			deliver,
			guard,
		});

		expect(order).toEqual(["record_intent", "deliver", "mark_sent"]);
		expect(deliver).toHaveBeenCalledWith("slack", baseNotification, {
			attemptId: "attempt-1",
			installationId: "inst-1",
			credentialRevisionId: "rev-1",
		});
		expect(result).toEqual({
			outcome: "sent",
			dispatchAttemptId: "attempt-1",
			installationId: "inst-1",
		});
	});

	it("never calls transport.deliver again when prior attempt is quarantined for reconciliation", async () => {
		const guard: AutoClockOutDurableChatDispatchGuard = {
			recordIntent: vi.fn(async () => ({
				kind: "reconciliation_required",
				attempt: makeAttempt({ status: "reconciliation_required", installationId: "inst-old" }),
				installationSwitched: true,
			})),
			markSent: vi.fn(),
			markConfirmedUnsent: vi.fn(),
			markUncertain: vi.fn(),
			hasActiveInstallation: vi.fn(async () => true),
		};
		const deliver = vi.fn();

		const result = await executeDurableChatChannelDelivery({
			organizationId: "org-1",
			provider: "slack",
			sourceRefId: "task-1",
			dedupeKey: "notification:op-1:user-1:slack",
			notification: baseNotification,
			deliver,
			guard,
		});

		expect(deliver).not.toHaveBeenCalled();
		expect(result).toEqual({
			outcome: "reconciliation_required",
			dispatchAttemptId: "attempt-1",
			installationId: "inst-old",
		});
	});

	it("marks confirmed_unsent and rethrows for retry on pre-flight errors so a retry can reroute", async () => {
		const guard: AutoClockOutDurableChatDispatchGuard = {
			recordIntent: vi.fn(async () => ({
				kind: "proceed",
				attempt: makeAttempt({ installationId: "inst-old", credentialRevisionId: "rev-old" }),
				reroutedFromAttemptId: null,
			})),
			markSent: vi.fn(),
			markConfirmedUnsent: vi.fn(),
			markUncertain: vi.fn(),
			hasActiveInstallation: vi.fn(async () => true),
		};
		const deliver = vi.fn(async () => {
			throw new DurableDispatchConfirmedUnsentError("lookup offline", {
				reason: "slack_preflight_failed",
			});
		});

		await expect(
			executeDurableChatChannelDelivery({
				organizationId: "org-1",
				provider: "slack",
				sourceRefId: "task-1",
				dedupeKey: "notification:op-1:user-1:slack",
				notification: baseNotification,
				deliver,
				guard,
			}),
		).rejects.toThrow("lookup offline");

		expect(guard.markConfirmedUnsent).toHaveBeenCalledOnce();
		expect(guard.markUncertain).not.toHaveBeenCalled();
	});

	it("quarantines uncertain provider errors without rethrowing for automatic resend", async () => {
		const guard: AutoClockOutDurableChatDispatchGuard = {
			recordIntent: vi.fn(async () => ({
				kind: "proceed",
				attempt: makeAttempt({ installationId: "inst-old", credentialRevisionId: "rev-old" }),
				reroutedFromAttemptId: null,
			})),
			markSent: vi.fn(),
			markConfirmedUnsent: vi.fn(),
			markUncertain: vi.fn(),
			hasActiveInstallation: vi.fn(async () => true),
		};
		const deliver = vi.fn(async () => {
			throw new DurableDispatchUncertainError("slack_delivery_unacknowledged", {
				reason: "provider_unacknowledged",
			});
		});

		const result = await executeDurableChatChannelDelivery({
			organizationId: "org-1",
			provider: "slack",
			sourceRefId: "task-1",
			dedupeKey: "notification:op-1:user-1:slack",
			notification: baseNotification,
			deliver,
			guard,
		});

		expect(guard.markUncertain).toHaveBeenCalledOnce();
		expect(guard.markConfirmedUnsent).not.toHaveBeenCalled();
		expect(result).toEqual({
			outcome: "reconciliation_required",
			dispatchAttemptId: "attempt-1",
			installationId: "inst-old",
		});
	});
});
