import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureFlag } from "@/components/settings/settings-config";

const mocks = vi.hoisted(() => ({
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
	rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("next/navigation", () => ({
	notFound: mocks.notFound,
}));

vi.mock("@/db", () => ({
	db: {
		select: vi.fn(),
	},
}));

import {
	isOrganizationFeatureEnabled,
	type OrganizationFeatureReader,
	requireOrganizationFeatureEnabled,
} from "./feature-flags.server";

function createFakeDb(rows: Array<Record<string, unknown>>): {
	reader: OrganizationFeatureReader;
	select: ReturnType<typeof vi.fn>;
	where: ReturnType<typeof vi.fn>;
	limit: ReturnType<typeof vi.fn>;
} {
	const limit = vi.fn(async () => rows);
	const where = vi.fn(() => ({ limit }));
	const from = vi.fn(() => ({ where }));
	const select = vi.fn(() => ({ from }));
	return {
		reader: { select } as unknown as OrganizationFeatureReader,
		select,
		where,
		limit,
	};
}

describe("organization feature-flag guard", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		"worksCouncilEnabled",
		"projectsEnabled",
		"surchargesEnabled",
		"shiftsEnabled",
		"equipmentEnabled",
		"personnelFilesEnabled",
	] satisfies FeatureFlag[])("returns true only when %s is explicitly enabled", async (feature) => {
		const enabledDb = createFakeDb([{ enabled: true }]);
		await expect(isOrganizationFeatureEnabled("org-1", feature, enabledDb.reader)).resolves.toBe(
			true,
		);

		const disabledDb = createFakeDb([{ enabled: false }]);
		await expect(isOrganizationFeatureEnabled("org-1", feature, disabledDb.reader)).resolves.toBe(
			false,
		);

		const nullDb = createFakeDb([{ enabled: null }]);
		await expect(isOrganizationFeatureEnabled("org-1", feature, nullDb.reader)).resolves.toBe(
			false,
		);

		const missingOrgDb = createFakeDb([]);
		await expect(
			isOrganizationFeatureEnabled("org-missing", feature, missingOrgDb.reader),
		).resolves.toBe(false);
	});

	it("treats demoDataEnabled as true when null on an existing organization and false when disabled or missing", async () => {
		await expect(
			isOrganizationFeatureEnabled(
				"org-1",
				"demoDataEnabled",
				createFakeDb([{ enabled: null }]).reader,
			),
		).resolves.toBe(true);

		await expect(
			isOrganizationFeatureEnabled(
				"org-1",
				"demoDataEnabled",
				createFakeDb([{ enabled: true }]).reader,
			),
		).resolves.toBe(true);

		await expect(
			isOrganizationFeatureEnabled(
				"org-1",
				"demoDataEnabled",
				createFakeDb([{ enabled: false }]).reader,
			),
		).resolves.toBe(false);

		await expect(
			isOrganizationFeatureEnabled("org-missing", "demoDataEnabled", createFakeDb([]).reader),
		).resolves.toBe(false);
	});

	it("requires both billableTimeEnabled and projectsEnabled for billableTimeEnabled", async () => {
		await expect(
			isOrganizationFeatureEnabled(
				"org-1",
				"billableTimeEnabled",
				createFakeDb([{ enabled: true, projectsEnabled: true }]).reader,
			),
		).resolves.toBe(true);

		await expect(
			isOrganizationFeatureEnabled(
				"org-1",
				"billableTimeEnabled",
				createFakeDb([{ enabled: true, projectsEnabled: false }]).reader,
			),
		).resolves.toBe(false);

		await expect(
			isOrganizationFeatureEnabled(
				"org-1",
				"billableTimeEnabled",
				createFakeDb([{ enabled: false, projectsEnabled: true }]).reader,
			),
		).resolves.toBe(false);
	});

	it("resolves without calling notFound when the feature is enabled", async () => {
		const fakeDb = createFakeDb([{ enabled: true }]);
		await expect(
			requireOrganizationFeatureEnabled("org-1", "projectsEnabled", fakeDb.reader),
		).resolves.toBeUndefined();
		expect(mocks.notFound).not.toHaveBeenCalled();
	});

	it("calls notFound when the feature is disabled", async () => {
		const fakeDb = createFakeDb([{ enabled: false }]);
		await expect(
			requireOrganizationFeatureEnabled("org-1", "worksCouncilEnabled", fakeDb.reader),
		).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.notFound).toHaveBeenCalledTimes(1);
	});
});
