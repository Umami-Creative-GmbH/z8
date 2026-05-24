import { createMongoAbility } from "@casl/ability";
import { describe, expect, it } from "vitest";
import type { AppAbility } from "@/lib/authorization/ability";
import {
	canConfigureWorksCouncilMode,
	canExportWorksCouncilReview,
	canViewWorksCouncilPortal,
} from "./permissions";

function abilityWithWorksCouncilPermissions(): AppAbility {
	return createMongoAbility([
		{ action: "read", subject: "WorksCouncil" },
		{ action: "export", subject: "WorksCouncil" },
		{ action: "configure", subject: "WorksCouncil" },
	]) as AppAbility;
}

function emptyAbility(): AppAbility {
	return createMongoAbility([]) as AppAbility;
}

describe("works council permission helpers", () => {
	it("deny access when requested organization does not match the active organization", () => {
		const ability = abilityWithWorksCouncilPermissions();

		expect(canViewWorksCouncilPortal(ability, "org-requested", "org-active")).toBe(false);
		expect(canExportWorksCouncilReview(ability, "org-requested", "org-active")).toBe(false);
		expect(canConfigureWorksCouncilMode(ability, "org-requested", "org-active")).toBe(false);
	});

	it("respect CASL permissions when requested organization matches the active organization", () => {
		const allowedAbility = abilityWithWorksCouncilPermissions();
		const deniedAbility = emptyAbility();

		expect(canViewWorksCouncilPortal(allowedAbility, "org-1", "org-1")).toBe(true);
		expect(canExportWorksCouncilReview(allowedAbility, "org-1", "org-1")).toBe(true);
		expect(canConfigureWorksCouncilMode(allowedAbility, "org-1", "org-1")).toBe(true);
		expect(canViewWorksCouncilPortal(deniedAbility, "org-1", "org-1")).toBe(false);
		expect(canExportWorksCouncilReview(deniedAbility, "org-1", "org-1")).toBe(false);
		expect(canConfigureWorksCouncilMode(deniedAbility, "org-1", "org-1")).toBe(false);
	});
});
