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

const { listPhotos, initiateUpload, changeVehicles, removePhoto } = vi.hoisted(
	() => ({
		listPhotos: vi.fn(),
		removePhoto: vi.fn(),
		initiateUpload: vi.fn(),
		changeVehicles: vi.fn(),
	}),
);
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
	removeVehiclePhoto: removePhoto,
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

describe("vehicle photo removal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		listPhotos.mockResolvedValue({
			success: true,
			data: { photos: [photo("first"), photo("second", 2)], archived: false },
		});
		removePhoto.mockResolvedValue({
			success: true,
			data: { ok: true, removed: true },
		});
	});
	afterEach(cleanup);
	it("requires confirmation, preserves cancelled photos, and saves confirmed removal immediately", async () => {
		render(<VehicleSettings initialData={data()} />);
		await openPhotos();
		await userEvent.click(
			await screen.findByRole("button", { name: "View photo 1 of Van" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));
		const confirmation = screen.getByRole("alertdialog", {
			name: "Permanently remove this photo?",
		});
		await userEvent.click(
			within(confirmation).getByRole("button", { name: "Cancel" }),
		);
		expect(removePhoto).not.toHaveBeenCalled();
		expect(screen.getByRole("dialog", { name: "Photo 1 of 2" })).toBeTruthy();
		await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));
		await userEvent.click(
			within(screen.getByRole("alertdialog")).getByRole("button", {
				name: "Permanently remove photo",
			}),
		);
		expect(removePhoto).toHaveBeenCalledWith("van", "first");
		const viewer = await screen.findByRole("dialog", { name: "Photo 1 of 1" });
		expect(within(viewer).getByRole("img").getAttribute("src")).toBe(
			"/api/organization/vehicles/van/photos/second",
		);
		await userEvent.keyboard("{Escape}");
		const surviving = screen.getByRole("button", {
			name: "View photo 1 of Van",
		});
		await waitFor(() => expect(document.activeElement).toBe(surviving));
		expect(changeVehicles).not.toHaveBeenCalled();
	});
	it("removes the last photo into the empty gallery and restores keyboard focus", async () => {
		listPhotos.mockResolvedValue({
			success: true,
			data: { photos: [photo("only")], archived: false },
		});
		render(<VehicleSettings initialData={data()} />);
		await openPhotos();
		await userEvent.click(
			await screen.findByRole("button", { name: "View photo 1 of Van" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));
		await userEvent.click(
			screen.getByRole("button", { name: "Permanently remove photo" }),
		);
		expect(await screen.findByText("No photos yet.")).toBeTruthy();
		expect(screen.queryByRole("dialog", { name: "Photo 1 of 1" })).toBeNull();
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("group", { name: "Vehicle photos" }),
			),
		);
	});
	it("retains a photo on removal failure and permits retry", async () => {
		removePhoto.mockResolvedValueOnce({
			success: false,
			error: "Temporary failure",
		});
		render(<VehicleSettings initialData={data()} />);
		await openPhotos();
		await userEvent.click(
			await screen.findByRole("button", { name: "View photo 1 of Van" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));
		await userEvent.click(
			screen.getByRole("button", { name: "Permanently remove photo" }),
		);
		expect((await screen.findByRole("alert")).textContent).toBe(
			"The photo could not be removed. Try again.",
		);
		expect(screen.getByRole("dialog", { name: "Photo 1 of 2" })).toBeTruthy();
		expect(screen.getByRole("img").getAttribute("src")).toBe(
			"/api/organization/vehicles/van/photos/first",
		);
		await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));
		await userEvent.click(
			screen.getByRole("button", { name: "Permanently remove photo" }),
		);
		expect(
			await screen.findByRole("dialog", { name: "Photo 1 of 1" }),
		).toBeTruthy();
	});
	it("keeps archived photos viewable without a removal control", async () => {
		listPhotos.mockResolvedValue({
			success: true,
			data: { photos: [photo("only")], archived: true },
		});
		render(<VehicleSettings initialData={data(true)} />);
		await openPhotos();
		await userEvent.click(
			await screen.findByRole("button", { name: "View photo 1 of Van" }),
		);
		expect(screen.getByRole("dialog", { name: "Photo 1 of 1" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull();
		expect(removePhoto).not.toHaveBeenCalled();
	});
	it("handles a stale archived refusal and preserves the photo", async () => {
		removePhoto.mockResolvedValue({
			success: true,
			data: { ok: false, reason: "vehicle_archived" },
		});
		render(<VehicleSettings initialData={data()} />);
		await openPhotos();
		await userEvent.click(
			await screen.findByRole("button", { name: "View photo 1 of Van" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));
		await userEvent.click(
			screen.getByRole("button", { name: "Permanently remove photo" }),
		);
		expect((await screen.findByRole("alert")).textContent).toContain(
			"This vehicle is archived.",
		);
		expect(screen.getByRole("dialog", { name: "Photo 1 of 2" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Remove photo" })).toBeNull();
	});
	it("keeps the confirmed photo fixed while keyboard arrows are pressed", async () => {
		render(<VehicleSettings initialData={data()} />);
		await openPhotos();
		await userEvent.click(
			await screen.findByRole("button", { name: "View photo 1 of Van" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));
		await userEvent.keyboard("{ArrowRight}");
		await userEvent.click(
			screen.getByRole("button", { name: "Permanently remove photo" }),
		);
		expect(removePhoto).toHaveBeenCalledWith("van", "first");
	});
	it("keeps removal after closing and reopening and releases full-gallery capacity", async () => {
		const photos = Array.from({ length: 20 }, (_, index) =>
			photo(`p${index}`, index),
		);
		listPhotos
			.mockResolvedValueOnce({
				success: true,
				data: { photos, archived: false },
			})
			.mockResolvedValueOnce({
				success: true,
				data: { photos: photos.slice(1), archived: false },
			});
		render(<VehicleSettings initialData={data()} />);
		await openPhotos();
		await userEvent.click(
			await screen.findByRole("button", { name: "View photo 1 of Van" }),
		);
		await userEvent.click(screen.getByRole("button", { name: "Remove photo" }));
		await userEvent.click(
			screen.getByRole("button", { name: "Permanently remove photo" }),
		);
		await screen.findByRole("dialog", { name: "Photo 1 of 19" });
		await userEvent.keyboard("{Escape}");
		expect(screen.getByLabelText("Add photo")).toHaveProperty(
			"disabled",
			false,
		);
		await userEvent.click(
			within(screen.getByRole("dialog", { name: "Photos of Van" })).getByRole(
				"button",
				{ name: "Close" },
			),
		);
		await openPhotos();
		const thumbnail = await screen.findByRole("button", {
			name: "View photo 1 of Van",
		});
		expect(within(thumbnail).getByRole("img").getAttribute("src")).toBe(
			"/api/organization/vehicles/van/photos/p1",
		);
	});
});
