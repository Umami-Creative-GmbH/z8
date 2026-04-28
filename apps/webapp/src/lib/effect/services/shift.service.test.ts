import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shift, skillRequirementOverride } from "@/db/schema";
import { NotFoundError, ValidationError } from "../errors";
import { DatabaseService } from "./database.service";
import { ShiftService, ShiftServiceLive, type UpsertShiftInput } from "./shift.service";

const baseInput: UpsertShiftInput = {
	organizationId: "org-1",
	employeeId: "employee-1",
	subareaId: "subarea-1",
	date: new Date("2026-04-29T00:00:00.000Z"),
	startTime: "09:00",
	endTime: "17:00",
	createdBy: "user-1",
};

const requiredWarningRequirement = {
	skillId: "skill-required-warning",
	isRequired: true,
	enforcementMode: "warning" as const,
	blockOnExpiringSoon: false,
	skill: {
		id: "skill-required-warning",
		organizationId: "org-1",
		name: "Forklift License",
		category: "certification",
		expiryWarningDays: 30,
	},
};

const preferredWarningRequirement = {
	skillId: "skill-preferred-warning",
	isRequired: false,
	enforcementMode: "warning" as const,
	blockOnExpiringSoon: false,
	skill: {
		id: "skill-preferred-warning",
		organizationId: "org-1",
		name: "First Aid",
		category: "training",
		expiryWarningDays: 30,
	},
};

const blockingRequirement = {
	skillId: "skill-blocking",
	isRequired: true,
	enforcementMode: "blocking" as const,
	blockOnExpiringSoon: false,
	skill: {
		id: "skill-blocking",
		organizationId: "org-1",
		name: "Hazmat Certification",
		category: "certification",
		expiryWarningDays: 30,
	},
};

function createShiftServiceTestContext({
	employeeRecord = { id: "employee-1", organizationId: "org-1" },
	subareaRecord = {
		id: "subarea-1",
		locationId: "location-1",
		location: { organizationId: "org-1" },
	},
	subareaRequirements = [requiredWarningRequirement, preferredWarningRequirement],
	templateRecord = null,
	templateRequirements = [],
	createdShift = { id: "shift-1", organizationId: "org-1" },
	insertOverrideThrows = false,
}: {
	employeeRecord?: unknown;
	subareaRecord?: unknown;
	subareaRequirements?: unknown[];
	templateRecord?: unknown;
	templateRequirements?: unknown[];
	createdShift?: unknown;
	insertOverrideThrows?: boolean;
} = {}) {
	const operationOrder: string[] = [];
	const overrideValues = vi.fn(async (values: unknown) => {
		operationOrder.push("overrideInsert");
		if (insertOverrideThrows) {
			throw new Error("override insert failed");
		}
		return [{ id: "override-1", ...(values as object) }];
	});
	const shiftReturning = vi.fn(async () => [createdShift]);
	const shiftValues = vi.fn(() => {
		operationOrder.push("shiftInsert");
		return { returning: shiftReturning };
	});
	const insert = vi.fn((table) => {
		if (table === shift) {
			return { values: shiftValues };
		}
		if (table === skillRequirementOverride) {
			return { values: (values: unknown) => ({ returning: () => overrideValues(values) }) };
		}
		throw new Error("Unexpected insert table");
	});
	const transaction = vi.fn(async (callback) => callback({ insert }));

	const mockDb = {
		query: {
			employee: {
				findFirst: vi.fn(async () => employeeRecord),
			},
			shift: {
				findFirst: vi.fn(async () => null),
				findMany: vi.fn(async () => []),
			},
			employeeSkill: {
				findMany: vi.fn(async () => []),
			},
			locationSubarea: {
				findFirst: vi.fn(async () => subareaRecord),
			},
			subareaSkillRequirement: {
				findMany: vi.fn(async () => subareaRequirements),
			},
			shiftTemplate: {
				findFirst: vi.fn(async () => templateRecord),
			},
			shiftTemplateSkillRequirement: {
				findMany: vi.fn(async () => templateRequirements),
			},
		},
		insert,
		transaction,
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
	const layer = ShiftServiceLive.pipe(Layer.provide(dbLayer));

	return {
		mockDb,
		operationOrder,
		overrideValues,
		runUpsertShift: (input: Partial<UpsertShiftInput> = {}) =>
			Effect.runPromise(
				Effect.either(
					Effect.gen(function* (_) {
						const service = yield* _(ShiftService);
						return yield* _(service.upsertShift({ ...baseInput, ...input }));
					}).pipe(Effect.provide(layer)),
				),
			),
	};
}

describe("ShiftService qualification enforcement", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("rejects assigned employees from another organization", async () => {
		const context = createShiftServiceTestContext({
			employeeRecord: { id: "employee-1", organizationId: "org-2" },
			subareaRequirements: [],
		});

		const result = await context.runUpsertShift();

		if (result._tag !== "Left") {
			throw new Error("Expected effect to fail");
		}
		expect(result.left).toBeInstanceOf(NotFoundError);
		expect(context.mockDb.insert).not.toHaveBeenCalled();
	});

	it("rejects open shifts for subareas from another organization", async () => {
		const context = createShiftServiceTestContext({
			subareaRecord: { id: "subarea-1", location: { organizationId: "org-2" } },
			subareaRequirements: [],
		});

		const result = await context.runUpsertShift({ employeeId: null });

		if (result._tag !== "Left") {
			throw new Error("Expected effect to fail");
		}
		expect(result.left).toBeInstanceOf(NotFoundError);
		expect(context.mockDb.insert).not.toHaveBeenCalled();
	});

	it("rejects open shifts using templates from another organization", async () => {
		const context = createShiftServiceTestContext({
			subareaRequirements: [],
			templateRecord: { id: "template-1", organizationId: "org-2" },
		});

		const result = await context.runUpsertShift({ employeeId: null, templateId: "template-1" });

		if (result._tag !== "Left") {
			throw new Error("Expected effect to fail");
		}
		expect(result.left).toBeInstanceOf(NotFoundError);
		expect(context.mockDb.insert).not.toHaveBeenCalled();
	});

	it("rejects blocking required qualification issues", async () => {
		const context = createShiftServiceTestContext({
			subareaRequirements: [blockingRequirement],
		});

		const result = await context.runUpsertShift();

		if (result._tag !== "Left") {
			throw new Error("Expected effect to fail");
		}
		expect(result.left).toBeInstanceOf(ValidationError);
		expect(context.mockDb.insert).not.toHaveBeenCalled();
	});

	it("requires an override reason for required warning qualification issues", async () => {
		const context = createShiftServiceTestContext();

		const result = await context.runUpsertShift();

		if (result._tag !== "Left") {
			throw new Error("Expected effect to fail");
		}
		expect(result.left).toBeInstanceOf(ValidationError);
		expect(context.mockDb.insert).not.toHaveBeenCalled();
	});

	it("allows missing preferred-only requirements and reports preferred metadata", async () => {
		const context = createShiftServiceTestContext({
			subareaRequirements: [preferredWarningRequirement],
		});

		const result = await context.runUpsertShift();

		expect(result).toMatchObject({
			_tag: "Right",
			right: {
				metadata: {
					skillWarning: {
						isQualified: true,
						requiresOverride: false,
						issues: [
							expect.objectContaining({
								id: "skill-preferred-warning",
								isRequired: false,
								issueType: "preferred",
							}),
						],
					},
				},
			},
		});
		expect(context.mockDb.insert).toHaveBeenCalledWith(shift);
		expect(context.mockDb.transaction).not.toHaveBeenCalled();
	});

	it("records only required warning issue IDs in the same transaction as the shift", async () => {
		const context = createShiftServiceTestContext();

		const result = await context.runUpsertShift({
			qualificationOverrideReason: "Manager approved",
		});

		expect(result._tag).toBe("Right");
		expect(context.mockDb.transaction).toHaveBeenCalledTimes(1);
		expect(context.operationOrder).toEqual(["shiftInsert", "overrideInsert"]);
		expect(context.overrideValues).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				shiftId: "shift-1",
				employeeId: "employee-1",
				missingSkillIds: JSON.stringify(["skill-required-warning"]),
				overrideReason: "Manager approved",
				overriddenBy: "user-1",
			}),
		);
	});

	it("does not persist the shift when transaction-local override recording fails", async () => {
		const context = createShiftServiceTestContext({ insertOverrideThrows: true });

		const result = await context.runUpsertShift({
			qualificationOverrideReason: "Manager approved",
		});

		expect(result._tag).toBe("Left");
		expect(context.mockDb.transaction).toHaveBeenCalledTimes(1);
		expect(context.operationOrder).toEqual(["shiftInsert", "overrideInsert"]);
	});
});
