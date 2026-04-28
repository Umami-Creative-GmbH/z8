import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	employeeSkill,
	qualificationRenewalRequest,
	qualificationRenewalRequestEvidence,
} from "@/db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { DatabaseService } from "./database.service";
import { SkillService, SkillServiceLive } from "./skill.service";

const baseAssignment = {
	id: "employee-skill-1",
	employeeId: "employee-1",
	skillId: "skill-1",
	skill: {
		id: "skill-1",
		organizationId: "org-1",
		requiresExpiry: true,
	},
};

const baseRequest = {
	id: "request-1",
	organizationId: "org-1",
	employeeId: "employee-1",
	employeeSkillId: "employee-skill-1",
	requestedIssuedAt: new Date("2026-01-01T00:00:00.000Z"),
	requestedExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
	requestedIssuer: "Training Body",
	requestedCertificateNumber: "CERT-1",
	notes: "Renewal evidence",
	status: "pending",
	reviewerId: null,
	reviewedAt: null,
	reviewNotes: null,
	createdAt: new Date("2026-01-02T00:00:00.000Z"),
	updatedAt: new Date("2026-01-02T00:00:00.000Z"),
};

function createSkillServiceTestContext({
	assignment = baseAssignment,
	evidenceRecords = [
		{ id: "evidence-1", organizationId: "org-1", employeeSkillId: "employee-skill-1" },
	],
	request = baseRequest,
	reviewer = { id: "reviewer-1", organizationId: "org-1" },
	reviewedRows,
	pendingRequests = [baseRequest],
}: {
	assignment?: unknown;
	evidenceRecords?: unknown[];
	request?: unknown;
	reviewer?: unknown;
	reviewedRows?: unknown[];
	pendingRequests?: unknown[];
} = {}) {
	const createdRequest = { ...baseRequest, id: "request-created" };
	const reviewedRequest = { ...baseRequest, status: "approved", reviewerId: "reviewer-1" };
	const requestReviewRows = reviewedRows ?? [reviewedRequest];
	const operationOrder: string[] = [];
	const renewalRequestReturning = vi.fn(async () => [createdRequest]);
	const renewalRequestValues = vi.fn(() => ({ returning: renewalRequestReturning }));
	const evidenceLinkValues = vi.fn(async () => undefined);
	const insert = vi.fn((table) => {
		if (table === qualificationRenewalRequest) {
			return { values: renewalRequestValues };
		}

		if (table === qualificationRenewalRequestEvidence) {
			return { values: evidenceLinkValues };
		}

		throw new Error("Unexpected insert table");
	});

	const employeeUpdateWhere = vi.fn(async () => undefined);
	const employeeUpdateSet = vi.fn(() => {
		operationOrder.push("employeeQualificationUpdate");
		return { where: employeeUpdateWhere };
	});
	const renewalReviewReturning = vi.fn(async () => requestReviewRows);
	const renewalReviewWhere = vi.fn(() => {
		operationOrder.push("renewalRequestWhere");
		return { returning: renewalReviewReturning };
	});
	const renewalReviewSet = vi.fn(() => {
		operationOrder.push("renewalRequestStatusUpdate");
		return { where: renewalReviewWhere };
	});
	const update = vi.fn((table) => {
		if (table === employeeSkill) {
			return { set: employeeUpdateSet };
		}

		if (table === qualificationRenewalRequest) {
			return { set: renewalReviewSet };
		}

		throw new Error("Unexpected update table");
	});
	const transaction = vi.fn(async (callback) => callback({ insert, update }));

	const qualificationRenewalRequestFindMany = vi.fn(async () => pendingRequests);
	const mockDb = {
		query: {
			employeeSkill: {
				findFirst: vi.fn(async () => assignment),
			},
			qualificationEvidence: {
				findMany: vi.fn(async () => evidenceRecords),
			},
			qualificationRenewalRequest: {
				findFirst: vi.fn(async () => request),
				findMany: qualificationRenewalRequestFindMany,
			},
			employee: {
				findFirst: vi.fn(async () => reviewer),
			},
		},
		transaction,
		update,
	};

	const dbLayer = Layer.succeed(
		DatabaseService,
		DatabaseService.of({
			db: mockDb as never,
			query: (_name, query) => Effect.promise(query) as never,
		}),
	);
	const layer = SkillServiceLive.pipe(Layer.provide(dbLayer));

	return {
		evidenceLinkValues,
		employeeUpdateSet,
		employeeUpdateWhere,
		mockDb,
		operationOrder,
		renewalReviewSet,
		renewalReviewReturning,
		runCreateRenewalRequest: (input: {
			employeeId: string;
			employeeSkillId: string;
			evidenceIds: string[];
			requestedExpiresAt?: Date;
		}) =>
			Effect.runPromise(
				Effect.either(
					Effect.gen(function* (_) {
						const service = yield* _(SkillService);
						return yield* _(
							service.createRenewalRequest({
								...input,
								requestedIssuedAt: new Date("2026-01-01T00:00:00.000Z"),
								requestedIssuer: "Training Body",
								requestedCertificateNumber: "CERT-1",
							}),
						);
					}).pipe(Effect.provide(layer)),
				),
			),
		runReviewRenewalRequest: (input: {
			requestId: string;
			reviewerEmployeeId: string;
			approved: boolean;
			reviewNotes?: string;
		}) =>
			Effect.runPromise(
				Effect.either(
					Effect.gen(function* (_) {
						const service = yield* _(SkillService);
						return yield* _(service.reviewRenewalRequest(input));
					}).pipe(Effect.provide(layer)),
				),
			),
		runGetPendingRenewalRequests: (organizationId: string) =>
			Effect.runPromise(
				Effect.gen(function* (_) {
					const service = yield* _(SkillService);
					return yield* _(service.getPendingRenewalRequests(organizationId));
				}).pipe(Effect.provide(layer)),
			),
	};
}

describe("SkillService qualification renewal behavior", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("requires an expiry date when renewing a qualification type that requires expiry", async () => {
		const { evidenceLinkValues, runCreateRenewalRequest } = createSkillServiceTestContext();

		expect(
			await runCreateRenewalRequest({
				employeeId: "employee-1",
				employeeSkillId: "employee-skill-1",
				evidenceIds: ["evidence-1"],
			}),
		).toMatchObject({ _tag: "Left", left: expect.any(ValidationError) });
		expect(evidenceLinkValues).not.toHaveBeenCalled();
	});

	it("requires at least one evidence ID", async () => {
		const { evidenceLinkValues, runCreateRenewalRequest } = createSkillServiceTestContext();

		expect(
			await runCreateRenewalRequest({
				employeeId: "employee-1",
				employeeSkillId: "employee-skill-1",
				evidenceIds: [],
				requestedExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
			}),
		).toMatchObject({ _tag: "Left", left: expect.any(ValidationError) });
		expect(evidenceLinkValues).not.toHaveBeenCalled();
	});

	it("rejects evidence from the wrong organization or employee qualification", async () => {
		const { evidenceLinkValues, runCreateRenewalRequest } = createSkillServiceTestContext({
			evidenceRecords: [],
		});

		expect(
			await runCreateRenewalRequest({
				employeeId: "employee-1",
				employeeSkillId: "employee-skill-1",
				evidenceIds: ["wrong-scope-evidence"],
				requestedExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
			}),
		).toMatchObject({ _tag: "Left", left: expect.any(ValidationError) });
		expect(evidenceLinkValues).not.toHaveBeenCalled();
	});

	it("creates a renewal request and links evidence", async () => {
		const { evidenceLinkValues, runCreateRenewalRequest } = createSkillServiceTestContext();

		expect(
			await runCreateRenewalRequest({
				employeeId: "employee-1",
				employeeSkillId: "employee-skill-1",
				evidenceIds: ["evidence-1", "evidence-1"],
				requestedExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
			}),
		).toMatchObject({ _tag: "Right", right: { id: "request-created" } });
		expect(evidenceLinkValues).toHaveBeenCalledWith([
			{
				organizationId: "org-1",
				renewalRequestId: "request-created",
				evidenceId: "evidence-1",
			},
		]);
	});

	it("only reviews requests still pending at transaction update time", async () => {
		const { employeeUpdateSet, renewalReviewSet, runReviewRenewalRequest } =
			createSkillServiceTestContext({
				reviewedRows: [],
			});

		expect(
			await runReviewRenewalRequest({
				requestId: "request-1",
				reviewerEmployeeId: "reviewer-1",
				approved: true,
			}),
		).toMatchObject({ _tag: "Left", left: expect.any(ValidationError) });
		expect(employeeUpdateSet).not.toHaveBeenCalled();
		expect(renewalReviewSet).toHaveBeenCalledWith(expect.objectContaining({ status: "approved" }));
	});

	it("rejects requests that were already reviewed before the transaction", async () => {
		const { employeeUpdateSet, renewalReviewSet, runReviewRenewalRequest } =
			createSkillServiceTestContext({
				request: { ...baseRequest, status: "approved" },
			});

		expect(
			await runReviewRenewalRequest({
				requestId: "request-1",
				reviewerEmployeeId: "reviewer-1",
				approved: true,
			}),
		).toMatchObject({ _tag: "Left", left: expect.any(ValidationError) });
		expect(employeeUpdateSet).not.toHaveBeenCalled();
		expect(renewalReviewSet).not.toHaveBeenCalled();
	});

	it("rejects review by an employee outside the request organization", async () => {
		const { employeeUpdateSet, renewalReviewSet, runReviewRenewalRequest } =
			createSkillServiceTestContext({
				reviewer: { id: "reviewer-2", organizationId: "org-2" },
			});

		expect(
			await runReviewRenewalRequest({
				requestId: "request-1",
				reviewerEmployeeId: "reviewer-2",
				approved: true,
			}),
		).toMatchObject({ _tag: "Left", left: expect.any(NotFoundError) });
		expect(employeeUpdateSet).not.toHaveBeenCalled();
		expect(renewalReviewSet).not.toHaveBeenCalled();
	});

	it("approval updates employee qualification and request status", async () => {
		const { employeeUpdateSet, mockDb, operationOrder, renewalReviewSet, runReviewRenewalRequest } =
			createSkillServiceTestContext();

		expect(
			await runReviewRenewalRequest({
				requestId: "request-1",
				reviewerEmployeeId: "reviewer-1",
				approved: true,
				reviewNotes: "Approved",
			}),
		).toMatchObject({ _tag: "Right", right: { status: "approved" } });
		expect(employeeUpdateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				issuedAt: baseRequest.requestedIssuedAt,
				expiresAt: baseRequest.requestedExpiresAt,
				issuer: baseRequest.requestedIssuer,
				certificateNumber: baseRequest.requestedCertificateNumber,
				status: "active",
			}),
		);
		expect(mockDb.transaction).toHaveBeenCalledTimes(1);
		expect(operationOrder).toEqual([
			"renewalRequestStatusUpdate",
			"renewalRequestWhere",
			"employeeQualificationUpdate",
		]);
		expect(renewalReviewSet).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "approved",
				reviewerId: "reviewer-1",
				reviewNotes: "Approved",
			}),
		);
	});

	it("rejection updates request status without updating employee qualification", async () => {
		const { employeeUpdateSet, renewalReviewSet, runReviewRenewalRequest } =
			createSkillServiceTestContext();

		expect(
			await runReviewRenewalRequest({
				requestId: "request-1",
				reviewerEmployeeId: "reviewer-1",
				approved: false,
				reviewNotes: "Needs newer certificate",
			}),
		).toMatchObject({ _tag: "Right" });
		expect(employeeUpdateSet).not.toHaveBeenCalled();
		expect(renewalReviewSet).toHaveBeenCalledWith(
			expect.objectContaining({
				status: "rejected",
				reviewerId: "reviewer-1",
				reviewNotes: "Needs newer certificate",
			}),
		);
	});

	it("returns pending renewal requests scoped to an organization", async () => {
		const pendingRequests = [
			{ ...baseRequest, id: "request-older", createdAt: new Date("2026-01-01T00:00:00.000Z") },
			{ ...baseRequest, id: "request-newer", createdAt: new Date("2026-01-02T00:00:00.000Z") },
		];
		const { mockDb, runGetPendingRenewalRequests } = createSkillServiceTestContext({
			pendingRequests,
		});

		expect(await runGetPendingRenewalRequests("org-1")).toEqual(pendingRequests);
		expect(mockDb.query.qualificationRenewalRequest.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				where: expect.anything(),
				orderBy: expect.any(Function),
			}),
		);
	});
});
