/* @vitest-environment jsdom */

import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@/test/render-with-translations";
import { LocationDialog } from "./location-dialog";

const { createLocation, updateLocation } = vi.hoisted(() => ({
	createLocation: vi.fn(),
	updateLocation: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/locations/actions", () => ({
	createLocation,
	updateLocation,
}));

describe("location editing contract", () => {
	beforeEach(() => {
		createLocation
			.mockReset()
			.mockResolvedValue({ success: false, error: "Unavailable" });
		updateLocation.mockReset();
	});
	it("associates validation with the required name and focuses it without submitting", async () => {
		const user = userEvent.setup();
		render(
			<LocationDialog
				location={null}
				open
				onOpenChange={vi.fn()}
				onSuccess={vi.fn()}
			/>,
		);
		await user.click(screen.getByRole("button", { name: "Create Location" }));
		const field = screen.getByRole("textbox", { name: /Name/ });
		await waitFor(() =>
			expect(field.getAttribute("aria-invalid")).toBe("true"),
		);
		expect(document.activeElement).toBe(field);
		expect(
			document.getElementById(
				field.getAttribute("aria-describedby")?.split(" ").at(-1) ?? "",
			)?.textContent,
		).toBe("Name is required");
		expect(createLocation).not.toHaveBeenCalled();
	});

	it("retains typed create values on dismissal and transport failure, and submits once while pending", async () => {
		let fail!: (reason: Error) => void;
		createLocation.mockReturnValueOnce(
			new Promise((_resolve, reject) => {
				fail = reject;
			}),
		);
		const user = userEvent.setup();
		const onOpenChange = vi.fn();
		render(
			<LocationDialog
				location={null}
				open
				onOpenChange={onOpenChange}
				onSuccess={vi.fn()}
			/>,
		);
		await user.type(screen.getByRole("textbox", { name: /Name/ }), "Workshop");
		await user.type(
			screen.getByRole("textbox", { name: "Country Code" }),
			"de",
		);
		await user.click(screen.getByRole("button", { name: "Create Location" }));
		const pendingForm = screen
			.getByRole("button", { name: "Create Location" })
			.closest("form");
		if (!pendingForm) throw new Error("Create action must submit its form");
		fireEvent.submit(pendingForm);
		await user.keyboard("{Escape}");
		expect(onOpenChange).not.toHaveBeenCalled();
		await user.click(screen.getByRole("button", { name: "Create Location" }));
		expect(createLocation).toHaveBeenCalledOnce();
		fail(new Error("Connection lost"));
		await screen.findByRole("alert");
		expect(
			(screen.getByRole("textbox", { name: /Name/ }) as HTMLInputElement).value,
		).toBe("Workshop");
		expect(
			(
				screen.getByRole("textbox", {
					name: "Country Code",
				}) as HTMLInputElement
			).value,
		).toBe("DE");
		await user.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onOpenChange).toHaveBeenCalledWith(false);
	});

	it("preserves edit defaults including false and sends the existing update payload", async () => {
		updateLocation.mockResolvedValue({ success: true, data: {} });
		const user = userEvent.setup();
		const onSuccess = vi.fn();
		render(
			<LocationDialog
				location={{
					id: "site-1",
					name: "Workshop",
					city: "Berlin",
					country: "DE",
					isActive: false,
					employeeCount: 0,
					subareaCount: 0,
				}}
				open
				onOpenChange={vi.fn()}
				onSuccess={onSuccess}
			/>,
		);
		expect(
			(screen.getByRole("textbox", { name: /Name/ }) as HTMLInputElement).value,
		).toBe("Workshop");
		expect(
			screen
				.getByRole("switch", { name: "Active" })
				.getAttribute("aria-checked"),
		).toBe("false");
		await user.click(screen.getByRole("button", { name: "Save Changes" }));
		await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
		expect(updateLocation).toHaveBeenCalledWith({
			locationId: "site-1",
			data: {
				name: "Workshop",
				street: undefined,
				city: "Berlin",
				postalCode: undefined,
				country: "DE",
				isActive: false,
			},
		});
	});
});
