import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	employeeSkill,
	qualificationRenewalRequest,
	qualificationRenewalRequestEvidence,
	shiftTemplateSkillRequirement,
	skill,
	subareaSkillRequirement,
} from "@/db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { DatabaseService } from "./database.service";
import { getQualificationExpiryBoundary, SkillService, SkillServiceLive } from "./skill.service";

const baseAssignment = {
	id: "employee-skill-1",
	employeeId: "employee-1",
	skillId: "skill-1",
	employee: {
		id: "employee-1",
		organizationId: "org-1",
	},
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
	reviewer = { id: "reviewer-1", organizationId: "org-1", userId: "reviewer-user-1" },
	reviewedRows,
	employeeSkillRows,
	pendingRequests = [baseRequest],
}: {
	assignment?: unknown;
	evidenceRecords?: unknown[];
	request?: unknown;
	reviewer?: unknown;
	reviewedRows?: unknown[];
	employeeSkillRows?: unknown[];
	pendingRequests?: unknown[];
} = {}) {
	const createdRequest = { ...baseRequest, id: "request-created" };
	const reviewedRequest = { ...baseRequest, status: "approved", reviewerId: "reviewer-1" };
	const requestReviewRows = reviewedRows ?? [reviewedRequest];
	const employeeQualificationRows = employeeSkillRows ?? [{ id: "employee-skill-1" }];
	const operationOrder: string[] = [];
	let committedTransactions = 0;
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

	const employeeUpdateReturning = vi.fn(async () => employeeQualificationRows);
	const employeeUpdateWhere = vi.fn(() => ({ returning: employeeUpdateReturning }));
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
	const transaction = vi.fn(async (callback) => {
		const result = await callback({ insert, update });
		committedTransactions += 1;
		return result;
	});

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
			query: (_name, query) =>
				Effect.tryPromise({
					try: query,
					catch: (error) => error,
				}) as never,
		}),
	);
	const layer = SkillServiceLive.pipe(Layer.provide(dbLayer));

	return {
		getCommittedTransactions: () => committedTransactions,
		evidenceLinkValues,
		employeeUpdateReturning,
		employeeUpdateSet,
		employeeUpdateWhere,
		mockDb,
		operationOrder,
		renewalReviewSet,
		renewalReviewReturning,
		runCreateRenewalRequest: (input: {
			organizationId?: string;
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
								organizationId: input.organizationId ?? "org-1",
								requestedIssuedAt: new Date("2026-01-01T00:00:00.000Z"),
								requestedIssuer: "Training Body",
								requestedCertificateNumber: "CERT-1",
							}),
						);
					}).pipe(Effect.provide(layer)),
				),
			),
		runReviewRenewalRequest: (input: {
			organizationId?: string;
			requestId: string;
			reviewerEmployeeId: string;
			approved: boolean;
			reviewNotes?: string;
		}) =>
			Effect.runPromise(
				Effect.either(
					Effect.gen(function* (_) {
						const service = yield* _(SkillService);
						return yield* _(
							service.reviewRenewalRequest({
								...input,
								organizationId: input.organizationId ?? "org-1",
							}),
						);
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

function createSkillValidationSecurityTestContext({
	employeeRecord = { id: "employee-1", organizationId: "org-1" },
	subareaRecord = { id: "subarea-1", location: { organizationId: "org-1" } },
	templateRecord = { id: "template-1", organizationId: "org-1" },
	subareaRequirements = [],
	templateRequirements = [],
}: {
	employeeRecord?: unknown;
	subareaRecord?: unknown;
	templateRecord?: unknown;
	subareaRequirements?: unknown[];
	templateRequirements?: unknown[];
} = {}) {
	const mockDb = {
		query: {
			employee: {
				findFirst: vi.fn(async () => employeeRecord),
			},
			employeeSkill: {
				findMany: vi.fn(async () => []),
			},
			locationSubarea: {
				findFirst: vi.fn(async () => subareaRecord),
			},
			shiftTemplate: {
				findFirst: vi.fn(async () => templateRecord),
			},
			subareaSkillRequirement: {
				findMany: vi.fn(async () => subareaRequirements),
			},
			shiftTemplateSkillRequirement: {
				findMany: vi.fn(async () => templateRequirements),
			},
		},
	};

	const dbLayer = Layer.succeed(
		DatabaseService,
		DatabaseService.of({
			db: mockDb as never,
			query: (_name, query) =>
				Effect.tryPromise({
					try: query,
					catch: (error) => error,
				}) as never,
		}),
	);
	const layer = SkillServiceLive.pipe(Layer.provide(dbLayer));

	return {
		mockDb,
		runValidateEmployeeForShift: (input?: {
			organizationId?: string;
			templateId?: string | null;
		}) =>
			Effect.runPromise(
				Effect.either(
					Effect.gen(function* (_) {
						const service = yield* _(SkillService);
						return yield* _(
							service.validateEmployeeForShift("employee-1", {
								organizationId: input?.organizationId ?? "org-1",
								subareaId: "subarea-1",
								templateId: input?.templateId ?? "template-1",
							}),
						);
					}).pipe(Effect.provide(layer)),
				),
			),
	};
}

function createSkillCatalogSecurityTestContext({
	existingSkill = {
		id: "skill-1",
		organizationId: "org-2",
		name: "Forklift",
		category: "certification",
		customCategoryName: null,
		requiresExpiry: true,
		expiryWarningDays: 30,
		isActive: true,
	},
	employeeRecord = { id: "employee-1", organizationId: "org-1" },
	skillRecord = {
		id: "skill-1",
		organizationId: "org-2",
		isActive: true,
		requiresExpiry: false,
	},
}: {
	existingSkill?: unknown;
	employeeRecord?: unknown;
	skillRecord?: unknown;
} = {}) {
	const conditionHasParam = (condition: unknown, columnName: string, value: string): boolean => {
		const seen = new WeakSet<object>();

		const visit = (node: unknown): boolean => {
			if (!node || typeof node !== "object") {
				return false;
			}

			if (seen.has(node)) {
				return false;
			}
			seen.add(node);

			if (
				"value" in node &&
				"encoder" in node &&
				(node as { value?: unknown }).value === value &&
				(node as { encoder?: { name?: unknown } }).encoder?.name === columnName
			) {
				return true;
			}

			return Object.values(node).some(visit);
		};

		return visit(condition);
	};

	const updateReturning = vi.fn(async () => [{ ...(existingSkill as object), name: "Updated" }]);
	const updateWhere = vi.fn(() => ({ returning: updateReturning }));
	const updateSet = vi.fn(() => ({ where: updateWhere }));
	const update = vi.fn((table) => {
		if (table === skill) {
			return { set: updateSet };
		}

		throw new Error("Unexpected update table");
	});

	const deleteWhere = vi.fn(async () => undefined);
	const deleteMock = vi.fn((table) => {
		if (table === employeeSkill) {
			return { where: deleteWhere };
		}

		throw new Error("Unexpected delete table");
	});

	const insertReturning = vi.fn(async () => [{ id: "employee-skill-1" }]);
	const onConflictDoUpdate = vi.fn(() => ({ returning: insertReturning }));
	const insertValues = vi.fn(() => ({ onConflictDoUpdate }));
	const insert = vi.fn((table) => {
		if (table === employeeSkill) {
			return { values: insertValues };
		}

		throw new Error("Unexpected insert table");
	});

	const mockDb = {
		query: {
			skill: {
				findFirst: vi.fn(async (options?: { where?: unknown }) => {
					const record = existingSkill ?? skillRecord;
					if (
						record &&
						conditionHasParam(options?.where, "organization_id", "org-1") &&
						(record as { organizationId?: string }).organizationId !== "org-1"
					) {
						return undefined;
					}

					return record;
				}),
			},
			employee: {
				findFirst: vi.fn(async () => employeeRecord),
			},
		},
		delete: deleteMock,
		insert,
		update,
	};

	const dbLayer = Layer.succeed(
		DatabaseService,
		DatabaseService.of({
			db: mockDb as never,
			query: (_name, query) =>
				Effect.tryPromise({
					try: query,
					catch: (error) => error,
				}) as never,
		}),
	);
	const layer = SkillServiceLive.pipe(Layer.provide(dbLayer));

	return {
		deleteMock,
		insert,
		mockDb,
		update,
		runAssignSkillToEmployee: () =>
			Effect.runPromise(
				Effect.either(
					Effect.gen(function* (_) {
						const service = yield* _(SkillService);
						return yield* _(
							service.assignSkillToEmployee({
								employeeId: "employee-1",
								skillId: "skill-1",
								assignedBy: "user-1",
								organizationId: "org-1",
							}),
						);
					}).pipe(Effect.provide(layer)),
				),
			),
		runDeleteSkill: () =>
			Effect.runPromise(
				Effect.either(
					Effect.gen(function* (_) {
						const service = yield* _(SkillService);
						return yield* _(service.deleteSkill("skill-1", "org-1"));
					}).pipe(Effect.provide(layer)),
				),
			),
		runUpdateSkill: () =>
			Effect.runPromise(
				Effect.either(
					Effect.gen(function* (_) {
						const service = yield* _(SkillService);
						return yield* _(
							service.updateSkill("skill-1", {
								name: "Updated",
								updatedBy: "user-1",
								organizationId: "org-1",
							}),
						);
					}).pipe(Effect.provide(layer)),
				),
			),
	};
}

function createRequirementMutationSecurityTestContext({
	subareaRecord = { id: "subarea-1", location: { organizationId: "org-1" } },
	templateRecord = { id: "template-1", organizationId: "org-1" },
	skillRecords = [{ id: "skill-1", organizationId: "org-1" }],
}: {
	subareaRecord?: unknown;
	templateRecord?: unknown;
	skillRecords?: unknown[];
} = {}) {
	const subareaDeleteWhere = vi.fn(async () => undefined);
	const templateDeleteWhere = vi.fn(async () => undefined);
	const deleteMock = vi.fn((table) => {
		if (table === subareaSkillRequirement) {
			return { where: subareaDeleteWhere };
		}

		if (table === shiftTemplateSkillRequirement) {
			return { where: templateDeleteWhere };
		}

		throw new Error("Unexpected delete table");
	});

	const insertReturning = vi.fn(async () => [{ id: "requirement-1" }]);
	const insertValues = vi.fn(() => ({ returning: insertReturning }));
	const insert = vi.fn((table) => {
		if (table === subareaSkillRequirement || table === shiftTemplateSkillRequirement) {
			return { values: insertValues };
		}

		throw new Error("Unexpected insert table");
	});

	const mockDb = {
		query: {
			locationSubarea: {
				findFirst: vi.fn(async () => subareaRecord),
			},
			shiftTemplate: {
				findFirst: vi.fn(async () => templateRecord),
			},
			skill: {
				findMany: vi.fn(async () => skillRecords),
			},
		},
		delete: deleteMock,
		insert,
	};

	const dbLayer = Layer.succeed(
		DatabaseService,
		DatabaseService.of({
			db: mockDb as never,
			query: (_name, query) =>
				Effect.tryPromise({
					try: query,
					catch: (error) => error,
				}) as never,
		}),
	);
	const layer = SkillServiceLive.pipe(Layer.provide(dbLayer));

	return {
		insert,
		mockDb,
		deleteMock,
		runSetSubareaSkillRequirements: () =>
			Effect.runPromise(
				Effect.either(
					Effect.gen(function* (_) {
						const service = yield* _(SkillService);
						return yield* _(
							service.setSubareaSkillRequirements({
								organizationId: "org-1",
								targetId: "subarea-1",
								requirements: [{ skillId: "skill-1", isRequired: true }],
								createdBy: "user-1",
							}),
						);
					}).pipe(Effect.provide(layer)),
				),
			),
		runSetTemplateSkillRequirements: () =>
			Effect.runPromise(
				Effect.either(
					Effect.gen(function* (_) {
						const service = yield* _(SkillService);
						return yield* _(
							service.setTemplateSkillRequirements({
								organizationId: "org-1",
								targetId: "template-1",
								requirements: [{ skillId: "skill-1", isRequired: true }],
								createdBy: "user-1",
							}),
						);
					}).pipe(Effect.provide(layer)),
				),
			),
	};
}

describe("SkillService catalog mutation security", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects catalog updates for skills outside the caller organization", async () => {
		const { runUpdateSkill, update } = createSkillCatalogSecurityTestContext();

		expect(await runUpdateSkill()).toMatchObject({ _tag: "Left", left: expect.any(NotFoundError) });
		expect(update).not.toHaveBeenCalled();
	});

	it("rejects catalog deletes for skills outside the caller organization", async () => {
		const { runDeleteSkill, update } = createSkillCatalogSecurityTestContext();

		expect(await runDeleteSkill()).toMatchObject({ _tag: "Left", left: expect.any(NotFoundError) });
		expect(update).not.toHaveBeenCalled();
	});

	it("rejects assigning a skill from a different organization than the employee", async () => {
		const { insert, runAssignSkillToEmployee } = createSkillCatalogSecurityTestContext();

		expect(await runAssignSkillToEmployee()).toMatchObject({
			_tag: "Left",
			left: expect.any(NotFoundError),
		});
		expect(insert).not.toHaveBeenCalled();
	});
});

describe("SkillService requirement mutation security", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects subarea requirement updates outside the caller organization before deleting", async () => {
		const { deleteMock, insert, runSetSubareaSkillRequirements } =
			createRequirementMutationSecurityTestContext({
				subareaRecord: { id: "subarea-1", location: { organizationId: "org-2" } },
			});

		expect(await runSetSubareaSkillRequirements()).toMatchObject({
			_tag: "Left",
			left: expect.any(NotFoundError),
		});
		expect(deleteMock).not.toHaveBeenCalled();
		expect(insert).not.toHaveBeenCalled();
	});

	it("rejects subarea requirement skills outside the caller organization before deleting", async () => {
		const { deleteMock, insert, runSetSubareaSkillRequirements } =
			createRequirementMutationSecurityTestContext({ skillRecords: [] });

		expect(await runSetSubareaSkillRequirements()).toMatchObject({
			_tag: "Left",
			left: expect.any(NotFoundError),
		});
		expect(deleteMock).not.toHaveBeenCalled();
		expect(insert).not.toHaveBeenCalled();
	});

	it("rejects template requirement updates outside the caller organization before deleting", async () => {
		const { deleteMock, insert, runSetTemplateSkillRequirements } =
			createRequirementMutationSecurityTestContext({
				templateRecord: { id: "template-1", organizationId: "org-2" },
			});

		expect(await runSetTemplateSkillRequirements()).toMatchObject({
			_tag: "Left",
			left: expect.any(NotFoundError),
		});
		expect(deleteMock).not.toHaveBeenCalled();
		expect(insert).not.toHaveBeenCalled();
	});

	it("rejects template requirement skills outside the caller organization before deleting", async () => {
		const { deleteMock, insert, runSetTemplateSkillRequirements } =
			createRequirementMutationSecurityTestContext({ skillRecords: [] });

		expect(await runSetTemplateSkillRequirements()).toMatchObject({
			_tag: "Left",
			left: expect.any(NotFoundError),
		});
		expect(deleteMock).not.toHaveBeenCalled();
		expect(insert).not.toHaveBeenCalled();
	});
});

describe("SkillService shift qualification validation security", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects shift validation when the employee is outside the caller organization", async () => {
		const { mockDb, runValidateEmployeeForShift } = createSkillValidationSecurityTestContext({
			employeeRecord: null,
		});

		expect(await runValidateEmployeeForShift()).toMatchObject({
			_tag: "Left",
			left: expect.any(NotFoundError),
		});
		expect(mockDb.query.employee.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({ where: expect.anything() }),
		);
		expect(mockDb.query.employeeSkill.findMany).not.toHaveBeenCalled();
	});

	it("rejects shift validation when the subarea is outside the caller organization", async () => {
		const { mockDb, runValidateEmployeeForShift } = createSkillValidationSecurityTestContext({
			subareaRecord: null,
		});

		expect(await runValidateEmployeeForShift()).toMatchObject({
			_tag: "Left",
			left: expect.any(NotFoundError),
		});
		expect(mockDb.query.subareaSkillRequirement.findMany).not.toHaveBeenCalled();
	});

	it("rejects shift validation when the template is outside the caller organization", async () => {
		const { mockDb, runValidateEmployeeForShift } = createSkillValidationSecurityTestContext({
			templateRecord: null,
		});

		expect(await runValidateEmployeeForShift()).toMatchObject({
			_tag: "Left",
			left: expect.any(NotFoundError),
		});
		expect(mockDb.query.shiftTemplateSkillRequirement.findMany).not.toHaveBeenCalled();
	});

	it("reports missing preferred qualifications as preferred informational issues", async () => {
		const preferredSkill = {
			id: "skill-preferred",
			organizationId: "org-1",
			name: "Forklift Familiarity",
			category: "certification",
		};
		const { runValidateEmployeeForShift } = createSkillValidationSecurityTestContext({
			subareaRequirements: [
				{
					skillId: preferredSkill.id,
					isRequired: false,
					enforcementMode: "warning",
					blockOnExpiringSoon: false,
					skill: preferredSkill,
				},
			],
		});

		expect(await runValidateEmployeeForShift({ templateId: null })).toMatchObject({
			_tag: "Right",
			right: {
				isQualified: true,
				requiresOverride: false,
				issues: [
					expect.objectContaining({
						id: "skill-preferred",
						isRequired: false,
						issueType: "preferred",
					}),
				],
			},
		});
	});
});

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

	it("rejects renewal creation outside the caller organization", async () => {
		const { evidenceLinkValues, mockDb, runCreateRenewalRequest } = createSkillServiceTestContext({
			assignment: {
				...baseAssignment,
				skill: { ...baseAssignment.skill, organizationId: "org-2" },
			},
			evidenceRecords: [
				{ id: "evidence-1", organizationId: "org-2", employeeSkillId: "employee-skill-1" },
			],
		});

		expect(
			await runCreateRenewalRequest({
				organizationId: "org-1",
				employeeId: "employee-1",
				employeeSkillId: "employee-skill-1",
				evidenceIds: ["evidence-1"],
				requestedExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
			}),
		).toMatchObject({ _tag: "Left", left: expect.any(NotFoundError) });
		expect(mockDb.transaction).not.toHaveBeenCalled();
		expect(evidenceLinkValues).not.toHaveBeenCalled();
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

	it("rejects renewal review outside the caller organization", async () => {
		const { employeeUpdateSet, mockDb, renewalReviewSet, runReviewRenewalRequest } =
			createSkillServiceTestContext({
				request: { ...baseRequest, organizationId: "org-2" },
				reviewer: { id: "reviewer-2", organizationId: "org-2" },
			});

		expect(
			await runReviewRenewalRequest({
				organizationId: "org-1",
				requestId: "request-1",
				reviewerEmployeeId: "reviewer-2",
				approved: true,
			}),
		).toMatchObject({ _tag: "Left", left: expect.any(NotFoundError) });
		expect(mockDb.transaction).not.toHaveBeenCalled();
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

	it("approval preserves existing qualification metadata when renewal fields are omitted", async () => {
		const existingIssuedAt = new Date("2025-01-01T00:00:00.000Z");
		const existingExpiresAt = new Date("2026-01-01T00:00:00.000Z");
		const { employeeUpdateSet, runReviewRenewalRequest } = createSkillServiceTestContext({
			assignment: {
				...baseAssignment,
				issuedAt: existingIssuedAt,
				expiresAt: existingExpiresAt,
				issuer: "Existing Issuer",
				certificateNumber: "EXISTING-CERT",
			},
			request: {
				...baseRequest,
				requestedIssuedAt: null,
				requestedExpiresAt: null,
				requestedIssuer: null,
				requestedCertificateNumber: null,
			},
		});

		expect(
			await runReviewRenewalRequest({
				requestId: "request-1",
				reviewerEmployeeId: "reviewer-1",
				approved: true,
			}),
		).toMatchObject({ _tag: "Right", right: { status: "approved" } });
		expect(employeeUpdateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				issuedAt: existingIssuedAt,
				expiresAt: existingExpiresAt,
				issuer: "Existing Issuer",
				certificateNumber: "EXISTING-CERT",
				renewedBy: "reviewer-user-1",
			}),
		);
	});

	it("fails approval when employee qualification update affects no rows", async () => {
		const {
			employeeUpdateReturning,
			getCommittedTransactions,
			mockDb,
			renewalReviewSet,
			runReviewRenewalRequest,
		} = createSkillServiceTestContext({
			employeeSkillRows: [],
		});

		expect(
			await runReviewRenewalRequest({
				requestId: "request-1",
				reviewerEmployeeId: "reviewer-1",
				approved: true,
			}),
		).toMatchObject({ _tag: "Left" });
		expect(mockDb.transaction).toHaveBeenCalledTimes(1);
		expect(renewalReviewSet).toHaveBeenCalledWith(expect.objectContaining({ status: "approved" }));
		expect(employeeUpdateReturning).toHaveBeenCalledTimes(1);
		expect(getCommittedTransactions()).toBe(0);
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

	it("returns pending renewal requests with employee, skill, and evidence metadata", async () => {
		const enrichedRequest = {
			...baseRequest,
			employee: {
				id: "employee-1",
				firstName: "Avery",
				lastName: "Nguyen",
				email: "avery@example.com",
			},
			employeeSkill: {
				id: "employee-skill-1",
				skill: {
					id: "skill-1",
					name: "Forklift License",
				},
			},
			evidenceLinks: [
				{
					id: "request-evidence-1",
					evidence: {
						id: "evidence-1",
						fileName: "forklift-renewal.pdf",
						mimeType: "application/pdf",
						fileSize: 12345,
					},
				},
			],
		};
		const { mockDb, runGetPendingRenewalRequests } = createSkillServiceTestContext({
			pendingRequests: [enrichedRequest],
		});

		expect(await runGetPendingRenewalRequests("org-1")).toEqual([enrichedRequest]);
		expect(mockDb.query.qualificationRenewalRequest.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				with: expect.objectContaining({
					employee: expect.anything(),
					employeeSkill: expect.objectContaining({
						with: expect.objectContaining({ skill: expect.anything() }),
					}),
					evidenceLinks: expect.objectContaining({
						with: expect.objectContaining({
							evidence: expect.objectContaining({
								columns: expect.not.objectContaining({ fileKey: true }),
							}),
						}),
					}),
				}),
			}),
		);
	});
});

describe("getQualificationExpiryBoundary", () => {
	it("returns the start of today in UTC so expiry dates remain valid through today", () => {
		expect(getQualificationExpiryBoundary(new Date("2026-04-28T12:34:56.000Z")).toISOString()).toBe(
			"2026-04-28T00:00:00.000Z",
		);
	});
});
