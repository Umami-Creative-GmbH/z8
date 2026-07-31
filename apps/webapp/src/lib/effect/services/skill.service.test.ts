import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { DatabaseError } from "../errors";
import { DatabaseService } from "./database.service";
import { SkillService, SkillServiceLive } from "./skill.service";

function collectColumnNames(value: unknown): string[] {
	if (!value || typeof value !== "object") return [];
	const node = value as {
		config?: { name?: unknown };
		queryChunks?: unknown[];
	};
	const ownName =
		typeof node.config?.name === "string" ? [node.config.name] : [];
	const chunkNames = Array.isArray(node.queryChunks)
		? node.queryChunks.flatMap(collectColumnNames)
		: [];
	return [...ownName, ...chunkNames];
}

function collectParams(
	value: unknown,
	params: unknown[] = [],
	seen = new WeakSet<object>(),
): unknown[] {
	if (!value || typeof value !== "object" || seen.has(value)) return params;
	seen.add(value);
	const node = value as {
		constructor?: { name?: string };
		queryChunks?: unknown[];
		value?: unknown;
	};
	if (node.constructor?.name === "Param") params.push(node.value);
	for (const chunk of node.queryChunks ?? [])
		collectParams(chunk, params, seen);
	return params;
}

function overrideRow(id: string, missingSkillIds: string) {
	return {
		id,
		organizationId: "org-1",
		shiftId: "shift-1",
		employeeId: "employee-1",
		missingSkillIds,
		overrideReason: "Coverage required",
		overriddenBy: "manager-1",
		overriddenAt: new Date("2026-07-29T08:00:00.000Z"),
		shift: {
			date: new Date("2026-07-30T00:00:00.000Z"),
			startTime: "08:00",
			endTime: "16:00",
		},
		employee: { firstName: "Ada", lastName: "Lovelace" },
	};
}

function testContext({
	overrides,
	skills = [],
}: {
	overrides: ReturnType<typeof overrideRow>[];
	skills?: Array<{ id: string; name: string; organizationId: string }>;
}) {
	let historyWhere: unknown;
	let skillWhere: unknown;
	const findOverrides = vi.fn(async (query: { where: unknown }) => {
		historyWhere = query.where;
		return overrides;
	});
	const findSkills = vi.fn(async (query: { where: unknown }) => {
		skillWhere = query.where;
		const params = collectParams(query.where);
		const isOrganizationScoped =
			collectColumnNames(query.where).includes("organization_id") &&
			params.includes("org-1");
		return skills
			.filter((row) => !isOrganizationScoped || row.organizationId === "org-1")
			.map(({ id, name }) => ({ id, name }));
	});
	const db = {
		query: {
			skillRequirementOverride: { findMany: findOverrides },
			skill: { findMany: findSkills },
		},
	};
	const databaseLayer = Layer.succeed(
		DatabaseService,
		DatabaseService.of({
			db: db as never,
			query: (name, query) =>
				Effect.tryPromise({
					try: query,
					catch: (cause) =>
						new DatabaseError({
							message: `Database query failed: ${name}`,
							operation: name,
							cause,
						}),
				}) as never,
		}),
	);
	const layer = SkillServiceLive.pipe(Layer.provide(databaseLayer));
	const effect = Effect.gen(function* () {
		const service = yield* SkillService;
		return yield* service.getOverrideHistory("org-1");
	}).pipe(Effect.provide(layer));

	return {
		effect,
		findSkills,
		getHistoryWhere: () => historyWhere,
		getSkillWhere: () => skillWhere,
	};
}

describe("SkillService.getOverrideHistory", () => {
	it("resolves valid skill IDs while preserving order, duplicates, and unknown fallbacks", async () => {
		const context = testContext({
			overrides: [
				overrideRow(
					"override-1",
					JSON.stringify(["skill-a", "skill-missing", "skill-a"]),
				),
			],
			skills: [{ id: "skill-a", name: "First aid", organizationId: "org-1" }],
		});

		const result = await Effect.runPromise(context.effect);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			id: "override-1",
			missingSkillNames: ["First aid", "Unknown Skill", "First aid"],
		});
	});

	it("returns malformed persisted JSON through the typed database error channel", async () => {
		const context = testContext({
			overrides: [overrideRow("override-malformed", '["skill-a"')],
		});

		const result = await Effect.runPromise(Effect.either(context.effect));

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.any(DatabaseError),
		});
		expect(context.findSkills).not.toHaveBeenCalled();
	});

	it.each([
		["an object", JSON.stringify({ skillId: "skill-a" })],
		["an array containing numbers", JSON.stringify([1, 2])],
	])("returns %s through the typed database error channel", async (_case, value) => {
		const context = testContext({
			overrides: [overrideRow("override-wrong-shape", value)],
		});

		const result = await Effect.runPromise(Effect.either(context.effect));

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.any(DatabaseError),
		});
		expect(context.findSkills).not.toHaveBeenCalled();
	});

	it("contains both history and skill-name queries within the requested organization", async () => {
		const context = testContext({
			overrides: [
				overrideRow(
					"override-foreign-skill",
					JSON.stringify(["skill-foreign"]),
				),
			],
			skills: [
				{
					id: "skill-foreign",
					name: "Foreign private skill",
					organizationId: "org-2",
				},
			],
		});

		const result = await Effect.runPromise(context.effect);

		expect(result[0]?.missingSkillNames).toEqual(["Unknown Skill"]);
		expect(collectColumnNames(context.getHistoryWhere())).toContain(
			"organization_id",
		);
		expect(collectParams(context.getHistoryWhere())).toContain("org-1");
		expect(collectColumnNames(context.getSkillWhere())).toEqual(
			expect.arrayContaining(["id", "organization_id"]),
		);
		expect(collectParams(context.getSkillWhere())).toContain("org-1");
	});
});
