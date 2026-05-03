import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { buildDefaultLegalEntityValues } from "./default-entity";

describe("buildDefaultLegalEntityValues", () => {
	it("uses organization display data and safe defaults", () => {
		expect(
			buildDefaultLegalEntityValues({
				organizationId: "org-1",
				organizationName: "Acme Group",
				createdBy: "user-1",
			}),
		).toEqual({
			organizationId: "org-1",
			name: "Acme Group",
			legalName: "Acme Group",
			defaultCurrency: "EUR",
			timezone: "Europe/Berlin",
			isDefault: true,
			isActive: true,
			createdBy: "user-1",
			updatedBy: "user-1",
		});
	});
});
