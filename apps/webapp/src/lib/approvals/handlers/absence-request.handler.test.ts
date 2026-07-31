import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	AuthorizationError,
	ConflictError,
	NotFoundError,
	ValidationError,
} from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import {
	AbsenceRequestHandler,
	redactNonSickAbsenceSickDetail,
} from "./absence-request.handler";

function collectColumnNames(value: unknown): string[] {
	if (!value || typeof value !== "object") return [];
	const candidate = value as {
		config?: { name?: unknown };
		queryChunks?: unknown[];
	};
	return [
		...(typeof candidate.config?.name === "string"
			? [candidate.config.name]
			: []),
		...(candidate.queryChunks?.flatMap(collectColumnNames) ?? []),
	];
}

const absence = {
	id: "absence-1",
	organizationId: "org-1",
	startDate: "2026-06-01",
	startPeriod: "full_day" as const,
	endDate: "2026-06-01",
	endPeriod: "full_day" as const,
	notes: null,
	sickDetail: null,
	status: "pending" as const,
	createdAt: new Date("2026-05-01T00:00:00.000Z"),
	employee: {
		id: "employee-1",
		userId: "user-1",
		teamId: null,
		organizationId: "org-1",
		user: {
			id: "user-1",
			name: "Ada Lovelace",
			email: "ada@example.com",
			image: null,
		},
	},
	category: {
		id: "category-vacation",
		name: "Vacation",
		type: "vacation",
		color: null,
	},
};

const approval = {
	id: "approval-1",
	entityType: "absence_entry" as const,
	entityId: "absence-1",
	requestedBy: "employee-1",
	approverId: "employee-2",
	organizationId: "org-1",
	status: "pending" as const,
	createdAt: new Date("2026-05-01T00:00:00.000Z"),
	approvedAt: null,
	rejectionReason: null,
	reason: null,
	metadata: null,
	requester: absence.employee,
	approver: null,
};

describe("redactNonSickAbsenceSickDetail", () => {
	it("redacts stale sick detail from non-sick absence entities", () => {
		const absence = redactNonSickAbsenceSickDetail({
			id: "absence-vacation",
			startDate: "2026-06-01",
			startPeriod: "full_day",
			endDate: "2026-06-01",
			endPeriod: "full_day",
			notes: null,
			sickDetail: "with_certificate",
			status: "pending",
			createdAt: new Date("2026-05-01T00:00:00.000Z"),
			employee: {
				id: "employee-1",
				userId: "user-1",
				teamId: null,
				organizationId: "org-1",
				user: {
					id: "user-1",
					name: "Ada Lovelace",
					email: "ada@example.com",
					image: null,
				},
			},
			category: {
				id: "category-vacation",
				name: "Vacation",
				type: "vacation",
				color: null,
			},
		});

		expect(absence.sickDetail).toBeNull();
	});
});

describe("absence approval handler tenant scope", () => {
	it("scopes batch absence reads to the requested organization", async () => {
		const requestFindMany = vi.fn().mockResolvedValue([approval]);
		const absenceFindMany = vi.fn().mockResolvedValue([absence]);
		const dbService = DatabaseService.of({
			db: {
				query: {
					approvalRequest: { findMany: requestFindMany },
					absenceEntry: { findMany: absenceFindMany },
				},
			},
			query: (_name: string, operation: () => Promise<unknown>) =>
				Effect.promise(operation),
		});

		const result = await Effect.runPromise(
			AbsenceRequestHandler.getApprovals({
				approverId: "employee-2",
				organizationId: "org-1",
			}).pipe(Effect.provideService(DatabaseService, dbService)),
		);

		expect(result).toHaveLength(1);
		expect(
			collectColumnNames(absenceFindMany.mock.calls[0]?.[0]?.where),
		).toEqual(expect.arrayContaining(["id", "organization_id"]));
	});

	it("scopes both detail reads to the requested organization", async () => {
		const absenceFindFirst = vi.fn().mockResolvedValue(absence);
		const requestFindFirst = vi.fn().mockResolvedValue(approval);
		const dbService = DatabaseService.of({
			db: {
				query: {
					absenceEntry: { findFirst: absenceFindFirst },
					approvalRequest: { findFirst: requestFindFirst },
				},
			},
			query: (_name: string, operation: () => Promise<unknown>) =>
				Effect.promise(operation),
		});

		const result = await Effect.runPromise(
			AbsenceRequestHandler.getDetail("absence-1", "org-1").pipe(
				Effect.provideService(DatabaseService, dbService),
			),
		);

		expect(result.approval.organizationId).toBe("org-1");
		expect(
			collectColumnNames(absenceFindFirst.mock.calls[0]?.[0]?.where),
		).toEqual(expect.arrayContaining(["id", "organization_id"]));
		expect(
			collectColumnNames(requestFindFirst.mock.calls[0]?.[0]?.where),
		).toEqual(
			expect.arrayContaining(["organization_id", "entity_type", "entity_id"]),
		);
	});

	it.each([
		["approve", undefined],
		["reject", "Needs clarification"],
	] as const)("dispatches %s through authenticated identity resolution", async (action, reason) => {
		const executeAuthenticatedAbsenceDecision = vi
			.fn()
			.mockResolvedValue(undefined);
		vi.doMock("@/lib/approvals/server/absence-approvals", () => ({
			executeAuthenticatedAbsenceDecision,
		}));

		if (action === "approve") {
			await Effect.runPromise(
				AbsenceRequestHandler.approve("absence-1", "caller-employee", {
					approvalRequestId: "approval-1",
				}),
			);
		} else {
			await Effect.runPromise(
				AbsenceRequestHandler.reject("absence-1", "caller-employee", reason, {
					approvalRequestId: "approval-1",
				}),
			);
		}

		expect(executeAuthenticatedAbsenceDecision).toHaveBeenCalledWith(
			"absence-1",
			action,
			reason,
			{ approvalRequestId: "approval-1" },
		);
		expect(executeAuthenticatedAbsenceDecision.mock.calls[0]).not.toContain(
			"caller-employee",
		);
		vi.doUnmock("@/lib/approvals/server/absence-approvals");
	});

	it.each([
		new NotFoundError({
			message: "Approval not found",
			entityType: "approval_request",
		}),
		new AuthorizationError({
			message: "Forbidden",
			resource: "Approval",
			action: "approve",
		}),
		new ConflictError({
			message: "Already approved",
			conflictType: "approval_status",
		}),
		new ValidationError({ message: "Invalid decision" }),
	])("preserves typed handler error $name", async (error) => {
		const executeAuthenticatedAbsenceDecision = vi
			.fn()
			.mockRejectedValue(error);
		vi.doMock("@/lib/approvals/server/absence-approvals", () => ({
			executeAuthenticatedAbsenceDecision,
		}));

		const exit = await Effect.runPromiseExit(
			AbsenceRequestHandler.approve("absence-1", "caller-employee", {
				approvalRequestId: "approval-1",
			}),
		);
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect(Option.getOrNull(Cause.failureOption(exit.cause))).toBe(error);
		}
		vi.doUnmock("@/lib/approvals/server/absence-approvals");
	});
});
