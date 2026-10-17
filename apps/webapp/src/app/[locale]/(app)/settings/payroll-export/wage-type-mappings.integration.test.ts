/** #966: wage mapping updates through the real server actions and PostgreSQL. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const session = vi.hoisted(() => ({
	userId: "t966-admin",
	organizationId: "t966-org",
}));
vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () => ({
				user: { id: session.userId, role: "user" },
				session: {
					id: "t966-session",
					userId: session.userId,
					activeOrganizationId: session.organizationId,
				},
			}),
		},
	},
}));
vi.mock("@/lib/billing/guard", async () =>
	(await import("@/test/integration-harness")).billingGuard(),
);
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));

const { deleteMappingAction, getMappingsAction, saveMappingAction } =
	await import("./actions");
const { wageTypeCodeFor } = await import("@/lib/payroll-export/wage-type-code");
const admin = integrationAdminPool();
const ORG = "t966-org";
const OTHER_ORG = "t966-other-org";
const USER = "t966-admin";
const OTHER_USER = "t966-other-admin";
const CATEGORY = "e9660000-0000-4000-8000-000000000001";
const OTHER_CATEGORY = "e9660000-0000-4000-8000-000000000002";

async function cleanup() {
	await admin.query("delete from organization where id in ($1, $2)", [
		ORG,
		OTHER_ORG,
	]);
	await admin.query('delete from "user" where id in ($1, $2)', [
		USER,
		OTHER_USER,
	]);
}

beforeEach(async () => {
	await cleanup();
	session.userId = USER;
	session.organizationId = ORG;
	for (const [organizationId, userId, categoryId, employeeId] of [
		[ORG, USER, CATEGORY, "e9661000-0000-4000-8000-000000000001"],
		[
			OTHER_ORG,
			OTHER_USER,
			OTHER_CATEGORY,
			"e9661000-0000-4000-8000-000000000002",
		],
	]) {
		await admin.query(
			"insert into organization (id, name, slug, timezone, created_at) values ($1, $1, $1, 'Europe/Berlin', now())",
			[organizationId],
		);
		await admin.query(
			'insert into "user" (id, name, email, created_at, updated_at) values ($1, $1, $2, now(), now())',
			[userId, `${userId}@example.test`],
		);
		await admin.query(
			"insert into member (id, organization_id, user_id, role, status, created_at) values ($1, $2, $3, 'owner', 'approved', now())",
			[`${userId}-member`, organizationId, userId],
		);
		await admin.query(
			"insert into employee (id, user_id, organization_id, role, updated_at) values ($1, $2, $3, 'admin', now())",
			[employeeId, userId, organizationId],
		);
		await admin.query(
			"insert into work_category (id, organization_id, name, created_by, updated_at) values ($1, $2, 'Night shift', $3, now())",
			[categoryId, organizationId, userId],
		);
	}
});
afterAll(cleanup);

function saved<T>(
	result: { success: true; data: T } | { success: false; error: string },
): T {
	if (!result.success) throw new Error(result.error);
	return result.data;
}

describe("wage type mapping updates", () => {
	const codes = {
		datevWageTypeCode: "1000",
		datevWageTypeName: "DATEV work",
		lexwareWageTypeCode: "LX-WORK",
		lexwareWageTypeName: "Lexware work",
		sageWageTypeCode: "SG-WORK",
		sageWageTypeName: "Sage work",
		successFactorsTimeTypeCode: "SF-WORK",
		successFactorsTimeTypeName: "Attendance",
	};

	it.each([
		["datevWageTypeCode", "datevWageTypeName", "datev"],
		["lexwareWageTypeCode", "lexwareWageTypeName", "lexware"],
		["sageWageTypeCode", "sageWageTypeName", "sage"],
		[
			"successFactorsTimeTypeCode",
			"successFactorsTimeTypeName",
			"successFactors",
		],
	] as const)(
		"clears %s and its name, preserves omitted fields and never borrows another format's code",
		async (code, name, format) => {
			const created = saved(
				await saveMappingAction({
					organizationId: ORG,
					workCategoryId: CATEGORY,
					...codes,
				}),
			);
			const updated = saved(
				await saveMappingAction({
					organizationId: ORG,
					workCategoryId: CATEGORY,
					[code]: null,
					[name]: null,
				}),
			);
			const expected = { id: created.id, ...codes, [code]: null, [name]: null };
			expect(updated).toMatchObject(expected);
			const mappings = saved(await getMappingsAction(ORG));
			expect(mappings).toEqual([expect.objectContaining(expected)]);
			expect(wageTypeCodeFor(mappings[0], format)).toBeNull();
		},
	);

	it("persists a SuccessFactors-only mapping", async () => {
		const mapping = saved(
			await saveMappingAction({
				organizationId: ORG,
				workCategoryId: CATEGORY,
				successFactorsTimeTypeCode: "SF-ONLY",
				successFactorsTimeTypeName: "Attendance",
			}),
		);
		expect(saved(await getMappingsAction(ORG))).toEqual([
			expect.objectContaining({
				id: mapping.id,
				datevWageTypeCode: null,
				lexwareWageTypeCode: null,
				sageWageTypeCode: null,
				successFactorsTimeTypeCode: "SF-ONLY",
				successFactorsTimeTypeName: "Attendance",
			}),
		]);
	});

	it("preserves saved unsupported categories when an unrelated mapping is saved and permits explicit deletion", async () => {
		const reduction = saved(
			await saveMappingAction({
				organizationId: ORG,
				specialCategory: "overtime_reduction",
				...codes,
			}),
		);
		const holiday = saved(
			await saveMappingAction({
				organizationId: ORG,
				specialCategory: "holiday_compensation",
				...codes,
			}),
		);
		await saveMappingAction({
			organizationId: ORG,
			workCategoryId: CATEGORY,
			datevWageTypeCode: "OTHER",
		});
		expect(saved(await getMappingsAction(ORG))).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: reduction.id,
					specialCategory: "overtime_reduction",
					...codes,
				}),
				expect.objectContaining({
					id: holiday.id,
					specialCategory: "holiday_compensation",
					...codes,
				}),
			]),
		);
		expect(
			(
				await deleteMappingAction({
					organizationId: ORG,
					mappingId: reduction.id,
				})
			).success,
		).toBe(true);
		expect(
			saved(await getMappingsAction(ORG)).map(({ id }) => id),
		).not.toContain(reduction.id);
		expect(saved(await getMappingsAction(ORG))).toContainEqual(
			expect.objectContaining({ id: holiday.id, ...codes }),
		);
	});

	it("refuses foreign sources and unauthorized organization reads and writes", async () => {
		session.userId = OTHER_USER;
		session.organizationId = OTHER_ORG;
		const foreign = saved(
			await saveMappingAction({
				organizationId: OTHER_ORG,
				workCategoryId: OTHER_CATEGORY,
				...codes,
			}),
		);
		session.userId = USER;
		session.organizationId = ORG;
		expect(
			(
				await saveMappingAction({
					organizationId: ORG,
					workCategoryId: OTHER_CATEGORY,
					datevWageTypeCode: "BAD",
				})
			).success,
		).toBe(false);
		expect(
			(
				await saveMappingAction({
					organizationId: OTHER_ORG,
					workCategoryId: OTHER_CATEGORY,
					successFactorsTimeTypeCode: null,
				})
			).success,
		).toBe(false);
		expect((await getMappingsAction(OTHER_ORG)).success).toBe(false);
		expect(saved(await getMappingsAction(ORG))).toEqual([]);
		session.userId = OTHER_USER;
		session.organizationId = OTHER_ORG;
		expect(saved(await getMappingsAction(OTHER_ORG))).toEqual([
			expect.objectContaining({ id: foreign.id, ...codes }),
		]);
	});
});
