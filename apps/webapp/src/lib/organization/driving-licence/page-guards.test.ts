import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireDrivingLicenceActor: vi.fn(),
	readDrivingLicenceVisibility: vi.fn(),
	notFound: vi.fn(() => {
		throw new Error("NEXT_NOT_FOUND");
	}),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("./context", () => ({
	requireDrivingLicenceActor: mocks.requireDrivingLicenceActor,
}));
vi.mock("./visibility", async () => ({
	...(await import("./visibility-rules")),
	readDrivingLicenceVisibility: mocks.readDrivingLicenceVisibility,
}));

const { requireDrivingLicencePage, requireDrivingLicenceSettingsPage } = await import(
	"./page-guards"
);

const actor = {
	organizationId: "org-1",
	userId: "user-1",
	memberId: "member-1",
	employeeId: "employee-1",
	isAdministrator: true,
};
const hidden = {
	featureEnabled: false,
	intendedDriver: false,
	ownRetainedRecords: false,
	verifier: false,
	planner: false,
	settings: "hidden",
};
beforeEach(() => {
	vi.clearAllMocks();
	mocks.requireDrivingLicenceActor.mockResolvedValue(actor);
});

describe("/driving-licence route guard (#1420)", () => {
	it.each([
		["the feature is off", { ...hidden, intendedDriver: true }],
		["the member holds no role", { ...hidden, featureEnabled: true }],
	])("returns not found when %s", async (_case, view) => {
		mocks.readDrivingLicenceVisibility.mockResolvedValue(view);
		await expect(requireDrivingLicencePage()).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.readDrivingLicenceVisibility).toHaveBeenCalledWith({
			organizationId: "org-1",
			userId: "user-1",
		});
	});

	it("returns not found instead of an error for a viewer without organization access", async () => {
		mocks.requireDrivingLicenceActor.mockRejectedValue(new Error("forbidden"));
		await expect(requireDrivingLicencePage()).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.readDrivingLicenceVisibility).not.toHaveBeenCalled();
	});

	it.each([
		[
			"an intended driver",
			{ intendedDriver: true },
			{ myLicence: true, checks: false, planning: false },
		],
		[
			"a former intended driver with records",
			{ ownRetainedRecords: true },
			{ myLicence: true, checks: false, planning: false },
		],
		["a verifier", { verifier: true }, { myLicence: false, checks: true, planning: false }],
		["a planner", { planner: true }, { myLicence: false, checks: false, planning: true }],
	])("opens the page for %s with that role", async (_case, facts, roles) => {
		mocks.readDrivingLicenceVisibility.mockResolvedValue({
			...hidden,
			featureEnabled: true,
			...facts,
		});
		await expect(requireDrivingLicencePage()).resolves.toMatchObject({
			actor,
			roles,
		});
		expect(mocks.notFound).not.toHaveBeenCalled();
	});
});

describe("/settings/driving-licence route guard (#1420)", () => {
	it("returns not found while the reader hides the settings", async () => {
		mocks.readDrivingLicenceVisibility.mockResolvedValue(hidden);
		await expect(requireDrivingLicenceSettingsPage()).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it.each(["full", "retention_only"] as const)(
		"opens the %s settings the reader offers",
		async (settings) => {
			mocks.readDrivingLicenceVisibility.mockResolvedValue({
				...hidden,
				settings,
			});
			await expect(requireDrivingLicenceSettingsPage()).resolves.toEqual({
				actor,
				settings,
			});
		},
	);
});
