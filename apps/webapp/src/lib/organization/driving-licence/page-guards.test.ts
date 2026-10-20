import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireDrivingLicenceActor: vi.fn(),
	readDrivingLicenceVisibility: vi.fn(),
	readDrivingLicenceCheckSubject: vi.fn(),
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
vi.mock("./check-subject", () => ({
	readDrivingLicenceCheckSubject: mocks.readDrivingLicenceCheckSubject,
}));

const {
	requireDrivingLicenceCheckPage,
	requireDrivingLicencePage,
	requireDrivingLicenceSettingsPage,
} = await import("./page-guards");

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

describe("/driving-licence/checks/[employee] route guard (#1429)", () => {
	const employeeId = "5b0f8f62-8a1a-4f4e-9f1a-2a7c4f0f6c11";
	const verifierView = { ...hidden, featureEnabled: true, verifier: true };
	const covered = { employeeId, name: "Anna Driver", canVerify: true };
	beforeEach(() => {
		mocks.readDrivingLicenceVisibility.mockResolvedValue(verifierView);
		mocks.readDrivingLicenceCheckSubject.mockResolvedValue(covered);
	});

	it("opens the check of an employee the viewer's grant covers", async () => {
		await expect(requireDrivingLicenceCheckPage(employeeId)).resolves.toEqual({
			actor,
			subject: covered,
		});
		expect(mocks.readDrivingLicenceCheckSubject).toHaveBeenCalledWith({
			organizationId: "org-1",
			userId: "user-1",
			employeeId,
		});
	});

	it.each([
		["the feature is off", { ...hidden, verifier: true }],
		[
			"the viewer holds no verifier grant",
			{ ...hidden, featureEnabled: true, intendedDriver: true },
		],
	])("returns not found when %s", async (_case, view) => {
		mocks.readDrivingLicenceVisibility.mockResolvedValue(view);
		await expect(requireDrivingLicenceCheckPage(employeeId)).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.readDrivingLicenceCheckSubject).not.toHaveBeenCalled();
	});

	it("returns not found when the grant does not cover the employee", async () => {
		mocks.readDrivingLicenceCheckSubject.mockResolvedValue(null);
		await expect(requireDrivingLicenceCheckPage(employeeId)).rejects.toThrow("NEXT_NOT_FOUND");
	});

	it("returns not found for the viewer's own check", async () => {
		mocks.requireDrivingLicenceActor.mockResolvedValue({ ...actor, employeeId });
		await expect(requireDrivingLicenceCheckPage(employeeId)).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.readDrivingLicenceCheckSubject).not.toHaveBeenCalled();
	});

	it("returns not found for a malformed employee id", async () => {
		await expect(requireDrivingLicenceCheckPage("not-an-id")).rejects.toThrow("NEXT_NOT_FOUND");
		expect(mocks.readDrivingLicenceCheckSubject).not.toHaveBeenCalled();
	});

	it("returns not found for a viewer without organization access", async () => {
		mocks.requireDrivingLicenceActor.mockRejectedValue(new Error("forbidden"));
		await expect(requireDrivingLicenceCheckPage(employeeId)).rejects.toThrow("NEXT_NOT_FOUND");
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
