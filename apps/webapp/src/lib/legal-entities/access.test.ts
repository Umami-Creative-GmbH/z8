import { describe, expect, it } from "vitest";
import { canAccessLegalEntity, resolveSelectedLegalEntityId } from "./access";

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
