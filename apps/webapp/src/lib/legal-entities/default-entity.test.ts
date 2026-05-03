import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
	from: vi.fn(),
	limit: vi.fn(),
	select: vi.fn(),
	where: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		select: dbMock.select,
	},
}));

import { buildDefaultLegalEntityValues, getDefaultLegalEntity } from "./default-entity";

function mockDefaultLegalEntityRows(rows: unknown[]) {
	dbMock.select.mockReturnValue({ from: dbMock.from });
	dbMock.from.mockReturnValue({ where: dbMock.where });
	dbMock.where.mockReturnValue({ limit: dbMock.limit });
	dbMock.limit.mockResolvedValue(rows);
}

beforeEach(() => {
	vi.clearAllMocks();
});

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

describe("getDefaultLegalEntity", () => {
	it("returns the first selected default legal entity", async () => {
		const entity = { id: "entity-1", organizationId: "org-1" };

		mockDefaultLegalEntityRows([entity]);

		await expect(getDefaultLegalEntity("org-1")).resolves.toBe(entity);
		expect(dbMock.limit).toHaveBeenCalledWith(1);
	});

	it("returns null when no default legal entity is selected", async () => {
		mockDefaultLegalEntityRows([]);

		await expect(getDefaultLegalEntity("org-1")).resolves.toBeNull();
		expect(dbMock.limit).toHaveBeenCalledWith(1);
	});
});
