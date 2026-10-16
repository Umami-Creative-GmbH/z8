// @vitest-environment jsdom

import {
	cleanup,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VehicleSettingsData } from "@/app/[locale]/(app)/settings/vehicles/actions";
import { VehicleSettings } from "./vehicle-settings";

const { listPhotos, initiateUpload, changeVehicles } = vi.hoisted(() => ({
	listPhotos: vi.fn(),
	initiateUpload: vi.fn(),
	changeVehicles: vi.fn(),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));
vi.mock("@/app/[locale]/(app)/settings/vehicles/actions", () => ({
	changeVehicles,
}));
vi.mock("@/app/[locale]/(app)/settings/vehicles/photo-actions", () => ({
	listVehiclePhotos: listPhotos,
	initiateVehiclePhotoUpload: initiateUpload,
}));
vi.mock("@/components/employee-select", () => ({
	EmployeeMultiSelect: ({ label }: { label: string }) => <p>{label}</p>,
}));

function data(archived = false): VehicleSettingsData {
	return {
		vehicles: [
			{
				id: "van",
				name: "Van",
				licencePlate: "M-AB 123",
				archived,
				drivers: { employees: [], teams: [] },
			},
		],
		employees: [],
		teams: [],
	};
}
function photo(id: string, order = 1) {
	return {
		id,
		vehicleId: "van",
		width: 1200,
		height: 800,
		order,
		createdAt: "2026-10-16T10:00:00Z",
		imageUrl: `/api/organization/vehicles/van/photos/${id}`,
	};
}

async function openPhotos() {
	await userEvent.click(screen.getByRole("button", { name: "Photos of Van" }));
	return screen.findByRole("dialog", { name: "Photos of Van" });
}

describe("vehicle photo settings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listPhotos.mockResolvedValue({
			success: true,
			data: { photos: [], archived: false },
		});
		initiateUpload.mockResolvedValue({
			success: true,
			data: { ok: true, uploadId: "upload-1" },
		});
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});

	it("opens an independent gallery, navigates photos by keyboard and restores focus", async () => {
		listPhotos.mockResolvedValue({
			success: true,
			data: { photos: [photo("first"), photo("second", 2)], archived: false },
		});
		render(<VehicleSettings initialData={data()} />);
		const dialog = await openPhotos();
		const first = await within(dialog).findByRole("button", {
			name: "View photo 1 of Van",
		});
		await userEvent.click(first);
		const viewer = screen.getByRole("dialog", { name: "Photo 1 of 2" });
		expect(within(viewer).getByRole("img").getAttribute("src")).toBe(
			"/api/organization/vehicles/van/photos/first",
		);
		await userEvent.keyboard("{ArrowRight}");
		expect(screen.getByRole("dialog", { name: "Photo 2 of 2" })).toBeTruthy();
		await userEvent.click(
			screen.getByRole("button", { name: "Previous photo" }),
		);
		expect(screen.getByRole("dialog", { name: "Photo 1 of 2" })).toBeTruthy();
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(document.activeElement).toBe(first));
		expect(changeVehicles).not.toHaveBeenCalled();
	});
	it("saves an upload immediately and reloads it when the dialog reopens", async () => {
		listPhotos
			.mockResolvedValueOnce({
				success: true,
				data: { photos: [], archived: false },
			})
			.mockResolvedValueOnce({
				success: true,
				data: { photos: [photo("saved")], archived: false },
			});
		let finishUpload!: (value: unknown) => void;
		const request = vi.fn().mockReturnValue(
			new Promise((resolve) => {
				finishUpload = resolve;
			}),
		);
		vi.stubGlobal("fetch", request);
		render(<VehicleSettings initialData={data()} />);
		const dialog = await openPhotos();
		await within(dialog).findByText("No photos yet.");
		const file = new File(["image"], "front.jpg", { type: "image/jpeg" });
		await userEvent.upload(screen.getByLabelText("Add photo"), file);
		expect(await screen.findByRole("status")).toHaveProperty(
			"textContent",
			"Uploading front.jpg…",
		);
		finishUpload({
			ok: true,
			json: async () => ({ ok: true, photo: photo("saved") }),
		});
		await screen.findByRole("button", { name: "View photo 1 of Van" });
		expect(request).toHaveBeenCalledWith(
			"/api/organization/vehicles/van/photos/upload-1",
			expect.objectContaining({
				method: "POST",
				body: file,
				headers: { "Content-Type": "image/jpeg" },
			}),
		);
		await userEvent.click(
			within(dialog).getByRole("button", { name: "Close" }),
		);
		await openPhotos();
		expect(
			await screen.findByRole("button", { name: "View photo 1 of Van" }),
		).toBeTruthy();
		expect(changeVehicles).not.toHaveBeenCalled();
	});
	it("keeps an archived vehicle's saved gallery viewable and read-only", async () => {
		listPhotos.mockResolvedValue({
			success: true,
			data: { photos: [photo("first")], archived: true },
		});
		render(<VehicleSettings initialData={data()} />);
		await openPhotos();
		await screen.findByRole("button", { name: "View photo 1 of Van" });
		expect(screen.queryByLabelText("Add photo")).toBeNull();
		expect(
			screen.getByText(
				"This vehicle is archived. Restore it to add or remove photos.",
			),
		).toBeTruthy();
		await userEvent.click(
			screen.getByRole("button", { name: "View photo 1 of Van" }),
		);
		expect(screen.getByRole("dialog", { name: "Photo 1 of 1" })).toBeTruthy();
		expect(initiateUpload).not.toHaveBeenCalled();
	});
	it("refuses unsupported and oversized files before upload initiation", async () => {
		const user = userEvent.setup({ applyAccept: false });
		render(<VehicleSettings initialData={data()} />);
		await openPhotos();
		await screen.findByText("No photos yet.");
		const input = screen.getByLabelText("Add photo");
		await user.upload(
			input,
			new File(["heic"], "phone.heic", { type: "image/heic" }),
		);
		expect(screen.getByRole("alert").textContent).toContain("HEIC");
		await user.upload(
			input,
			new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.jpg", {
				type: "image/jpeg",
			}),
		);
		expect(screen.getAllByRole("alert").at(-1)?.textContent).toContain("10 MB");
		expect(initiateUpload).not.toHaveBeenCalled();
	});
	it("prevents another upload once all 20 photo slots are used", async () => {
		listPhotos.mockResolvedValue({
			success: true,
			data: {
				photos: Array.from({ length: 20 }, (_, index) =>
					photo(`photo-${index}`, index),
				),
				archived: false,
			},
		});
		render(<VehicleSettings initialData={data()} />);
		await openPhotos();
		await screen.findByRole("button", { name: "View photo 20 of Van" });
		expect(screen.getByLabelText("Add photo")).toHaveProperty("disabled", true);
		expect(
			screen.getByText(
				"This vehicle has 20 photos. Remove a photo before adding another.",
			),
		).toBeTruthy();
		expect(initiateUpload).not.toHaveBeenCalled();
	});
	it("explains a server refusal, preserves saved photos and permits another single-file selection", async () => {
		listPhotos.mockResolvedValue({
			success: true,
			data: { photos: [photo("existing")], archived: false },
		});
		const request = vi
			.fn()
			.mockResolvedValueOnce({
				ok: false,
				json: async () => ({
					ok: false,
					reason: "invalid_image",
					error: "Cannot decode image",
				}),
			})
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ({ ok: true, photo: photo("new", 2) }),
			});
		vi.stubGlobal("fetch", request);
		render(<VehicleSettings initialData={data()} />);
		await openPhotos();
		await screen.findByRole("button", { name: "View photo 1 of Van" });
		const file = new File(["image"], "front.jpg", { type: "image/jpeg" });
		await userEvent.upload(screen.getByLabelText("Add photo"), file);
		expect((await screen.findByRole("alert")).textContent).toContain(
			"This image could not be read. Choose another JPEG, PNG or WebP photo.",
		);
		expect(
			screen.getByRole("button", { name: "View photo 1 of Van" }),
		).toBeTruthy();
		await userEvent.upload(screen.getByLabelText("Add photo"), file);
		expect(
			await screen.findByRole("button", { name: "View photo 2 of Van" }),
		).toBeTruthy();
		expect(screen.getByRole("alert").textContent).toContain(
			"This image could not be read.",
		);
	});
});
