import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureSCIMProjectionReplay } from "@/lib/scim/role-projection-replay";

const mocks = vi.hoisted(() => {
	const returning = vi.fn();
	const values = vi.fn(() => ({ returning }));
	const insert = vi.fn(() => ({ values }));
	const deleteWhere = vi.fn();
	const deleteFrom = vi.fn(() => ({ where: deleteWhere }));
	const mappingFindFirst = vi.fn();
	const assignmentFindFirst = vi.fn();
	return {
		returning,
		values,
		insert,
		deleteWhere,
		deleteFrom,
		mappingFindFirst,
		assignmentFindFirst,
	};
});

vi.mock("@/db", () => ({
	db: {
		insert: mocks.insert,
		delete: mocks.deleteFrom,
		query: {
			roleTemplateMapping: { findFirst: mocks.mappingFindFirst },
			userRoleTemplateAssignment: { findFirst: mocks.assignmentFindFirst },
		},
	},
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

import {
	RoleTemplateService,
	RoleTemplateServiceLive,
} from "./role-template.service";

function collectColumnNames(value: unknown): string[] {
	if (!value || typeof value !== "object") return [];
	const node = value as { name?: unknown; queryChunks?: unknown[] };
	return [
		...(typeof node.name === "string" ? [node.name] : []),
		...(node.queryChunks?.flatMap(collectColumnNames) ?? []),
	];
}

function collectValues(value: unknown): unknown[] {
	if (!value || typeof value !== "object") return [];
	const node = value as { value?: unknown; queryChunks?: unknown[] };
	return [
		...(node.value !== undefined ? [node.value] : []),
		...(node.queryChunks?.flatMap(collectValues) ?? []),
	];
}

function runService<A>(
	use: (
		service: import("./role-template.service").RoleTemplateService,
	) => Effect.Effect<A, Error>,
) {
	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* RoleTemplateService;
			return yield* use(service);
		}).pipe(Effect.provide(RoleTemplateServiceLive)),
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.deleteWhere.mockResolvedValue(undefined);
});
afterEach(() => configureSCIMProjectionReplay(null));

describe("RoleTemplateService SCIM replay", () => {
	it("requests replay after a SCIM mapping is created", async () => {
		const order: string[] = [];
		mocks.returning.mockImplementation(async () => {
			order.push("persist");
			return [{ id: "mapping_1", idpType: "scim" }];
		});
		configureSCIMProjectionReplay(async () => async (organizationId) => {
			order.push(`replay:${organizationId}`);
		});

		await runService((service) =>
			service.createIdpMapping({
				organizationId: "org_target",
				idpType: "scim",
				idpGroupId: "group_opaque",
				roleTemplateId: "template_opaque",
				createdBy: "user_opaque",
			}),
		);

		expect(order).toEqual(["persist", "replay:org_target"]);
	});

	it("checks replay availability before creating a SCIM mapping", async () => {
		await expect(
			runService((service) =>
				service.createIdpMapping({
					organizationId: "org_target",
					idpType: "scim",
					idpGroupId: "group_opaque",
					roleTemplateId: "template_opaque",
					createdBy: "user_opaque",
				}),
			),
		).rejects.toThrow("SCIM projection replay is not configured");
		expect(mocks.returning).not.toHaveBeenCalled();
	});

	it("undoes a created SCIM mapping when replay rejects", async () => {
		const replayError = new Error("replay rejected");
		mocks.returning.mockResolvedValue([
			{
				id: "mapping_1",
				organizationId: "org_target",
				idpType: "scim",
				idpGroupId: "group_opaque",
				roleTemplateId: "template_opaque",
			},
		]);
		configureSCIMProjectionReplay(async () => async () => {
			throw replayError;
		});

		await expect(
			runService((service) =>
				service.createIdpMapping({
					organizationId: "org_target",
					idpType: "scim",
					idpGroupId: "group_opaque",
					roleTemplateId: "template_opaque",
					createdBy: "user_opaque",
				}),
			),
		).rejects.toThrow("replay rejected");
		const condition = mocks.deleteWhere.mock.calls[0]?.[0];
		expect(collectColumnNames(condition)).toEqual(
			expect.arrayContaining(["id", "organization_id"]),
		);
		expect(collectValues(condition).flat()).toEqual(
			expect.arrayContaining(["mapping_1", "org_target"]),
		);
	});

	it("scopes mapping deletion to organization and replays SCIM only after delete", async () => {
		const order: string[] = [];
		mocks.mappingFindFirst.mockResolvedValue({
			id: "mapping_1",
			idpType: "scim",
		});
		mocks.deleteWhere.mockImplementation(async () => order.push("delete"));
		configureSCIMProjectionReplay(async () => async (organizationId) => {
			order.push(`replay:${organizationId}`);
		});

		await runService((service) =>
			service.deleteIdpMapping("mapping_1", "org_target"),
		);

		expect(order).toEqual(["delete", "replay:org_target"]);
		for (const condition of [
			mocks.mappingFindFirst.mock.calls[0]?.[0].where,
			mocks.deleteWhere.mock.calls[0]?.[0],
		]) {
			expect(collectColumnNames(condition)).toEqual(
				expect.arrayContaining(["id", "organization_id"]),
			);
			expect(collectValues(condition).flat()).toEqual(
				expect.arrayContaining(["mapping_1", "org_target"]),
			);
		}
	});

	it("does not replay an SSO mapping deletion", async () => {
		const replay = vi.fn();
		mocks.mappingFindFirst.mockResolvedValue({
			id: "mapping_1",
			idpType: "sso",
		});
		configureSCIMProjectionReplay(async () => replay);

		await runService((service) =>
			service.deleteIdpMapping("mapping_1", "org_target"),
		);

		expect(replay).not.toHaveBeenCalled();
	});

	it("restores the exact deleted SCIM mapping when replay rejects", async () => {
		const replayError = new Error("replay rejected");
		const snapshot = {
			id: "mapping_1",
			organizationId: "org_target",
			idpType: "scim",
			idpGroupId: "group_opaque",
			idpGroupName: "Opaque group",
			roleTemplateId: "template_opaque",
			priority: 7,
			createdBy: "user_opaque",
			createdAt: new Date("2026-08-25T00:00:00Z"),
		};
		mocks.mappingFindFirst.mockResolvedValue(snapshot);
		configureSCIMProjectionReplay(async () => async () => {
			throw replayError;
		});

		await expect(
			runService((service) =>
				service.deleteIdpMapping("mapping_1", "org_target"),
			),
		).rejects.toThrow("replay rejected");
		expect(mocks.values).toHaveBeenCalledWith(snapshot);
	});

	it("requests replay after deleting a manual assignment", async () => {
		const order: string[] = [];
		mocks.assignmentFindFirst.mockResolvedValue({ assignmentSource: "manual" });
		mocks.deleteWhere.mockImplementation(async () => order.push("delete"));
		configureSCIMProjectionReplay(async () => async (organizationId) => {
			order.push(`replay:${organizationId}`);
		});

		await runService((service) =>
			service.removeUserTemplateAssignment({
				userId: "user_opaque",
				organizationId: "org_target",
			}),
		);

		expect(order).toEqual(["delete", "replay:org_target"]);
	});

	it("restores the exact manual assignment when replay rejects", async () => {
		const replayError = new Error("replay rejected");
		const snapshot = {
			id: "assignment_1",
			organizationId: "org_target",
			userId: "user_opaque",
			roleTemplateId: "template_manual",
			assignmentSource: "manual",
			idpGroupId: null,
			assignedBy: "admin_opaque",
			assignedAt: new Date("2026-08-25T00:00:00Z"),
		};
		mocks.assignmentFindFirst.mockResolvedValue(snapshot);
		configureSCIMProjectionReplay(async () => async () => {
			throw replayError;
		});

		await expect(
			runService((service) =>
				service.removeUserTemplateAssignment({
					userId: "user_opaque",
					organizationId: "org_target",
				}),
			),
		).rejects.toThrow("replay rejected");
		expect(mocks.values).toHaveBeenCalledWith(snapshot);
	});
});
