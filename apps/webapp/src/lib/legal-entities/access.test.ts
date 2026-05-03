import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	canAccessLegalEntity,
	getLegalEntitySelectionContext,
	resolveSelectedLegalEntityId,
	shouldShowLegalEntitySelector,
} from "./access";
import { getDefaultLegalEntity } from "./default-entity";

const dbSelect = vi.fn();

vi.mock("@/db", () => ({
	db: {
		select: (...args: unknown[]) => dbSelect(...args),
	},
}));

vi.mock("./default-entity", () => ({
	getDefaultLegalEntity: vi.fn(),
}));

const mockGetDefaultLegalEntity = vi.mocked(getDefaultLegalEntity);

function mockLegalEntityQuery(entities: Array<{ id: string; name: string; organizationId: string }>) {
	dbSelect.mockReturnValue({
		from: vi.fn(() => ({
			where: vi.fn(async () => entities),
		})),
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mockGetDefaultLegalEntity.mockResolvedValue({ id: "entity-a" } as Awaited<ReturnType<typeof getDefaultLegalEntity>>);
});

describe("canAccessLegalEntity", () => {
	it("allows org admins to access every legal entity", () => {
		expect(canAccessLegalEntity({ isOrgAdmin: true, allowedLegalEntityIds: [] }, "entity-a")).toBe(true);
	});

	it("allows entity admins only for granted legal entities", () => {
		expect(canAccessLegalEntity({ isOrgAdmin: false, allowedLegalEntityIds: ["entity-a"] }, "entity-a")).toBe(true);
		expect(canAccessLegalEntity({ isOrgAdmin: false, allowedLegalEntityIds: ["entity-a"] }, "entity-b")).toBe(false);
	});
});

describe("resolveSelectedLegalEntityId", () => {
	it("uses requested entity when allowed", () => {
		expect(
			resolveSelectedLegalEntityId({
				requestedLegalEntityId: "entity-b",
				defaultLegalEntityId: "entity-a",
				isOrgAdmin: false,
				allowedLegalEntityIds: ["entity-b"],
			}),
		).toBe("entity-b");
	});

	it("falls back to default for org admins without a requested entity", () => {
		expect(
			resolveSelectedLegalEntityId({
				requestedLegalEntityId: null,
				defaultLegalEntityId: "entity-a",
				isOrgAdmin: true,
				allowedLegalEntityIds: [],
			}),
		).toBe("entity-a");
	});

	it("uses the first allowed entity for entity admins without a requested entity", () => {
		expect(
			resolveSelectedLegalEntityId({
				requestedLegalEntityId: null,
				defaultLegalEntityId: "entity-a",
				isOrgAdmin: false,
				allowedLegalEntityIds: ["entity-c"],
			}),
		).toBe("entity-c");
	});

	it("uses the default entity for entity admins when it is allowed", () => {
		expect(
			resolveSelectedLegalEntityId({
				requestedLegalEntityId: null,
				defaultLegalEntityId: "entity-a",
				isOrgAdmin: false,
				allowedLegalEntityIds: ["entity-c", "entity-a"],
			}),
		).toBe("entity-a");
	});

	it("rejects unauthorized requested entities", () => {
		expect(() =>
			resolveSelectedLegalEntityId({
				requestedLegalEntityId: "entity-x",
				defaultLegalEntityId: "entity-a",
				isOrgAdmin: false,
				allowedLegalEntityIds: ["entity-c"],
			}),
		).toThrow("You do not have access to this legal entity.");
	});
});

describe("shouldShowLegalEntitySelector", () => {
	it("shows the selector for org admins and legal entity admins only", () => {
		expect(shouldShowLegalEntitySelector({ isOrgAdmin: true, allowedLegalEntityIds: [] })).toBe(true);
		expect(shouldShowLegalEntitySelector({ isOrgAdmin: false, allowedLegalEntityIds: ["entity-a"] })).toBe(true);
		expect(shouldShowLegalEntitySelector({ isOrgAdmin: false, allowedLegalEntityIds: [] })).toBe(false);
	});
});

describe("getLegalEntitySelectionContext", () => {
	it("returns all organization entities for org admins", async () => {
		const entities = [
			{ id: "entity-a", name: "Germany GmbH", organizationId: "org-1" },
			{ id: "entity-b", name: "Portugal Lda", organizationId: "org-1" },
		];
		mockLegalEntityQuery(entities);

		await expect(
			getLegalEntitySelectionContext({
				organizationId: "org-1",
				requestedLegalEntityId: "entity-b",
				isOrgAdmin: true,
				allowedLegalEntityIds: [],
			}),
		).resolves.toEqual({ entities, selectedLegalEntityId: "entity-b" });
		expect(Object.keys(dbSelect.mock.calls[0]?.[0] ?? {})).toEqual(["id", "name"]);
	});

	it("rejects org-admin requested entities outside the organization entity list", async () => {
		mockLegalEntityQuery([{ id: "entity-a", name: "Germany GmbH", organizationId: "org-1" }]);

		await expect(
			getLegalEntitySelectionContext({
				organizationId: "org-1",
				requestedLegalEntityId: "entity-outside-org",
				isOrgAdmin: true,
				allowedLegalEntityIds: [],
			}),
		).rejects.toThrow("You do not have access to this legal entity.");
	});

	it("rejects unauthorized requested entities before returning entity-admin context", async () => {
		mockLegalEntityQuery([{ id: "entity-a", name: "Germany GmbH", organizationId: "org-1" }]);

		await expect(
			getLegalEntitySelectionContext({
				organizationId: "org-1",
				requestedLegalEntityId: "entity-b",
				isOrgAdmin: false,
				allowedLegalEntityIds: ["entity-a"],
			}),
		).rejects.toThrow("You do not have access to this legal entity.");
	});
});
