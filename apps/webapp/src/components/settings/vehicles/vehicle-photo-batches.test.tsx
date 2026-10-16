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
import { VehiclePhotosDialog } from "./vehicle-photos-dialog";

const { listPhotos, initiateUpload, reconcile } = vi.hoisted(() => ({
	listPhotos: vi.fn(),
	initiateUpload: vi.fn(),
	reconcile: vi.fn(),
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
vi.mock("@/app/[locale]/(app)/settings/vehicles/photo-actions", () => ({
	listVehiclePhotos: listPhotos,
	initiateVehiclePhotoUpload: initiateUpload,
	reconcileVehiclePhotoUpload: reconcile,
}));
const vehicle = {
	id: "van",
	name: "Van",
	licencePlate: "M-AB 123",
	archived: false,
	drivers: { employees: [], teams: [] },
};
const photo = (id: string, order: number) => ({
	id,
	vehicleId: "van",
	order,
	width: 80,
	height: 40,
	createdAt: "2026-10-16T10:00:00Z",
	imageUrl: `/photos/${id}`,
});
const file = (name: string) => new File(["image"], name, { type: "image/png" });
async function open() {
	await userEvent.click(screen.getByRole("button", { name: "Photos of Van" }));
	await screen.findByText("No photos yet.");
}
function success(id: string, order: number) {
	return {
		ok: true,
		json: async () => ({ ok: true, photo: photo(id, order) }),
	};
}

describe("vehicle photo batch uploads", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		listPhotos.mockResolvedValue({
			success: true,
			data: { photos: [], archived: false },
		});
		let next = 0;
		initiateUpload.mockImplementation(async () => ({
			success: true,
			data: { ok: true, uploadId: `upload-${++next}` },
		}));
	});
	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
	});
	it("accepts a batch and displays saved photos in selection order when the second finishes first", async () => {
		let first!: (value: unknown) => void;
		const request = vi
			.fn()
			.mockReturnValueOnce(
				new Promise((resolve) => {
					first = resolve;
				}),
			)
			.mockResolvedValueOnce(success("second", 2));
		vi.stubGlobal("fetch", request);
		render(<VehiclePhotosDialog vehicle={vehicle} />);
		await open();
		await userEvent.upload(screen.getByLabelText("Add photo"), [
			file("first.png"),
			file("second.png"),
		]);
		await screen.findByRole("button", { name: "View photo 1 of Van" });
		expect(screen.getByText("Uploading first.png…")).toBeTruthy();
		expect(screen.getByText("Saved second.png.")).toBeTruthy();
		first(success("first", 1));
		await screen.findByRole("button", { name: "View photo 2 of Van" });
		expect(
			screen.getAllByRole("img").map((img) => img.getAttribute("src")),
		).toEqual(["/photos/first", "/photos/second"]);
	});
	it("refuses the whole selection before transfer and includes pending files in the remaining capacity", async () => {
		listPhotos.mockResolvedValue({
			success: true,
			data: {
				photos: Array.from({ length: 18 }, (_, index) =>
					photo(`existing-${index}`, index),
				),
				archived: false,
			},
		});
		const request = vi.fn().mockReturnValue(new Promise(() => {}));
		vi.stubGlobal("fetch", request);
		render(<VehiclePhotosDialog vehicle={vehicle} />);
		await userEvent.click(
			screen.getByRole("button", { name: "Photos of Van" }),
		);
		await screen.findByRole("button", { name: "View photo 18 of Van" });
		const input = screen.getByLabelText("Add photo");
		await userEvent.upload(input, [
			file("a.png"),
			file("b.png"),
			file("c.png"),
		]);
		expect(screen.getByRole("alert").textContent).toContain(
			"2 photo slots remain",
		);
		expect(initiateUpload).not.toHaveBeenCalled();
		expect(request).not.toHaveBeenCalled();
		await userEvent.upload(input, [file("a.png"), file("b.png")]);
		await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
		await userEvent.upload(input, file("c.png"));
		expect(screen.getByRole("alert").textContent).toContain(
			"0 photo slots remain",
		);
		expect(request).toHaveBeenCalledTimes(2);
	});
	it("retains partial success and retries only the failed file with its stable upload identity", async () => {
		const request = vi
			.fn()
			.mockResolvedValueOnce(success("first", 1))
			.mockRejectedValueOnce(new Error("connection lost"))
			.mockResolvedValueOnce(success("second", 2));
		vi.stubGlobal("fetch", request);
		reconcile.mockResolvedValue({
			success: true,
			data: { ok: true, photo: null },
		});
		render(<VehiclePhotosDialog vehicle={vehicle} />);
		await open();
		await userEvent
			.setup({ applyAccept: false })
			.upload(screen.getByLabelText("Add photo"), [
				file("first.png"),
				file("second.png"),
				new File(["heic"], "unsupported.heic", { type: "image/heic" }),
			]);
		await screen.findByText("Saved first.png.");
		expect(screen.getByText(/unsupported.heic:.*HEIC/)).toBeTruthy();
		await userEvent.click(
			await screen.findByRole("button", { name: "Retry second.png" }),
		);
		await screen.findByText("Saved second.png.");
		expect(
			screen.getAllByRole("img").map((img) => img.getAttribute("src")),
		).toEqual(["/photos/first", "/photos/second"]);
		expect(request.mock.calls.map(([url]) => url)).toEqual([
			"/api/organization/vehicles/van/photos/upload-1",
			"/api/organization/vehicles/van/photos/upload-2",
			"/api/organization/vehicles/van/photos/upload-2",
		]);
		expect(initiateUpload).toHaveBeenCalledTimes(2);
	});
	it("reconciles a completed upload after a lost response without transferring its body again", async () => {
		const request = vi.fn().mockRejectedValueOnce(new Error("response lost"));
		vi.stubGlobal("fetch", request);
		reconcile.mockResolvedValue({
			success: true,
			data: { ok: true, photo: photo("saved", 1) },
		});
		render(<VehiclePhotosDialog vehicle={vehicle} />);
		await open();
		await userEvent.upload(
			screen.getByLabelText("Add photo"),
			file("front.png"),
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Retry front.png" }),
		);
		await screen.findByText("Saved front.png.");
		expect(request).toHaveBeenCalledTimes(1);
		expect(initiateUpload).toHaveBeenCalledTimes(1);
	});
	it("shows completed changes after reopening while another file finishes in the background", async () => {
		let finish!: (value: unknown) => void;
		listPhotos
			.mockResolvedValueOnce({
				success: true,
				data: { photos: [], archived: false },
			})
			.mockResolvedValueOnce({
				success: true,
				data: { photos: [photo("first", 1)], archived: false },
			});
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(success("first", 1))
				.mockReturnValueOnce(
					new Promise((resolve) => {
						finish = resolve;
					}),
				),
		);
		render(<VehiclePhotosDialog vehicle={vehicle} />);
		await open();
		await userEvent.upload(screen.getByLabelText("Add photo"), [
			file("first.png"),
			file("second.png"),
		]);
		await screen.findByText("Saved first.png.");
		await userEvent.click(
			within(screen.getByRole("dialog", { name: "Photos of Van" })).getByRole(
				"button",
				{ name: "Close" },
			),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Photos of Van" }),
		);
		await screen.findByRole("button", { name: "View photo 1 of Van" });
		finish(success("second", 2));
		await screen.findByRole("button", { name: "View photo 2 of Van" });
	});
	it("keeps a background completion when a stale reopen response arrives afterward", async () => {
		let finish!: (value: unknown) => void;
		let list!: (value: unknown) => void;
		listPhotos
			.mockResolvedValueOnce({
				success: true,
				data: { photos: [], archived: false },
			})
			.mockReturnValueOnce(
				new Promise((resolve) => {
					list = resolve;
				}),
			);
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(success("first", 1))
				.mockReturnValueOnce(
					new Promise((resolve) => {
						finish = resolve;
					}),
				),
		);
		render(<VehiclePhotosDialog vehicle={vehicle} />);
		await open();
		await userEvent.upload(screen.getByLabelText("Add photo"), [
			file("first.png"),
			file("second.png"),
		]);
		await screen.findByText("Saved first.png.");
		await userEvent.click(
			within(screen.getByRole("dialog", { name: "Photos of Van" })).getByRole(
				"button",
				{ name: "Close" },
			),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Photos of Van" }),
		);
		await screen.findByText("Loading photos…");
		finish(success("second", 2));
		await screen.findByRole("button", { name: "View photo 2 of Van" });
		list({
			success: true,
			data: { photos: [photo("first", 1)], archived: false },
		});
		await waitFor(() =>
			expect(screen.queryByText("Loading photos…")).toBeNull(),
		);
		expect(
			screen.getByRole("button", { name: "View photo 2 of Van" }),
		).toBeTruthy();
	});
});
