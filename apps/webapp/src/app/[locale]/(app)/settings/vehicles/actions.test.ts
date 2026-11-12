import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	changeOrganizationVehicles: vi.fn(),
	listOrganizationVehicles: vi.fn(),
	listPhotos: vi.fn(),
	initiatePhotoUpload: vi.fn(),
	initiatePhotoBatchUpload: vi.fn(),
	removePhoto: vi.fn(),
	reconcilePhotoUpload: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db: {} }));
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/organization/vehicles/vehicles", () => ({
	changeOrganizationVehicles: mocks.changeOrganizationVehicles,
	listOrganizationVehicles: mocks.listOrganizationVehicles,
}));

vi.mock("@/lib/organization/vehicles/vehicle-photos", () => ({
	listPhotos: mocks.listPhotos,
	initiatePhotoUpload: mocks.initiatePhotoUpload,
	initiatePhotoBatchUpload: mocks.initiatePhotoBatchUpload,
	removePhoto: mocks.removePhoto,
}));

vi.mock("@/lib/organization/vehicles/vehicle-photo-reconciliation", () => ({
	reconcilePhotoUpload: mocks.reconcilePhotoUpload,
}));

const { changeVehicles, getVehicleSettings } = await import("./actions");
const {
	initiateVehiclePhotoBatchUpload,
	initiateVehiclePhotoUpload,
	listVehiclePhotos,
	reconcileVehiclePhotoUpload,
	removeVehiclePhoto,
} = await import("./photo-actions");

const vehicleId = "6f1c7a1e-0d7b-4b1a-9c55-2f4f0b6a1d11";
const photoId = "8d2e5f3a-1b4c-4d6e-8f70-91a2b3c4d5e6";

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "employee-1", role: "admin", former: false },
};
const scopedManager: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-1", role: "manager", former: false },
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
});

const actions = [
	["getVehicleSettings", () => getVehicleSettings()],
	["changeVehicles", () => changeVehicles({ kind: "archive", vehicleId })],
	["listVehiclePhotos", () => listVehiclePhotos({ vehicleId })],
	["initiateVehiclePhotoUpload", () => initiateVehiclePhotoUpload({ vehicleId })],
	["removeVehiclePhoto", () => removeVehiclePhoto({ vehicleId, photoId })],
	[
		"reconcileVehiclePhotoUpload",
		() => reconcileVehiclePhotoUpload({ vehicleId, uploadId: photoId }),
	],
	[
		"initiateVehiclePhotoBatchUpload",
		() => initiateVehiclePhotoBatchUpload({ vehicleId, uploadIds: [photoId] }),
	],
] as const;

describe("vehicle settings actions", () => {
	it.each(actions)("%s refuses a scoped manager", async (_name, call) => {
		mocks.caller = scopedManager;

		await expect(call()).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		for (const fn of Object.values(mocks)) {
			if (typeof fn === "function") expect(fn).not.toHaveBeenCalled();
		}
	});

	it("applies a change to the session's organization as the caller", async () => {
		mocks.changeOrganizationVehicles.mockResolvedValue({ ok: false, reason: "vehicle_not_found" });

		const result = await changeVehicles({ kind: "archive", vehicleId });

		expect(result).toEqual({ success: true, data: { ok: false, reason: "vehicle_not_found" } });
		expect(mocks.changeOrganizationVehicles).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			actorUserId: "user-1",
			change: { kind: "archive", vehicleId },
		});
	});

	it("lists photos of a vehicle in the session's organization", async () => {
		mocks.listPhotos.mockResolvedValue([]);

		await expect(listVehiclePhotos({ vehicleId })).resolves.toEqual({ success: true, data: [] });
		expect(mocks.listPhotos).toHaveBeenCalledWith(
			expect.anything(),
			{ organizationId: "org-1", userId: "user-1" },
			vehicleId,
		);
	});

	it("refuses an invalid photo removal before touching storage", async () => {
		await expect(removeVehiclePhoto({ vehicleId, photoId: "nope" })).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Choose a valid vehicle photo",
		});
		expect(mocks.removePhoto).not.toHaveBeenCalled();
	});

	it("refuses a photo batch with duplicate upload identities", async () => {
		await expect(
			initiateVehiclePhotoBatchUpload({ vehicleId, uploadIds: [photoId, photoId] }),
		).resolves.toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.initiatePhotoBatchUpload).not.toHaveBeenCalled();
	});
});
