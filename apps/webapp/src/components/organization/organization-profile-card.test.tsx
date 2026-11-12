/* @vitest-environment jsdom */
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY_ORGANIZATION_PROFILE } from "@/lib/organization/profile";

const { save, refresh, toastSuccess, toastError } = vi.hoisted(() => ({
	save: vi.fn(),
	refresh: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));
vi.mock("sonner", () => ({
	toast: { success: toastSuccess, error: toastError },
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/app/[locale]/(app)/settings/organization/profile-actions", () => ({
	saveOrganizationProfile: save,
}));

import { OrganizationProfileCard } from "./organization-profile-card";

afterEach(cleanup);
beforeEach(() => {
	vi.clearAllMocks();
});

it("warns before leaving with unsaved edits and adopts the successfully saved profile as its baseline", async () => {
	save.mockImplementation(async (profile) => ({
		success: true,
		data: { ok: true, profile },
	}));
	const { unmount } = render(
		<OrganizationProfileCard
			profile={EMPTY_ORGANIZATION_PROFILE}
		/>,
	);
	const leavingWouldWarn = () => {
		const event = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(event);
		return event.defaultPrevented;
	};
	expect(leavingWouldWarn()).toBe(false);
	const city = screen.getByLabelText("City");
	fireEvent.change(city, { target: { value: "Berlin" } });
	expect(leavingWouldWarn()).toBe(true);
	fireEvent.change(city, { target: { value: "" } });
	expect(leavingWouldWarn()).toBe(false);
	fireEvent.change(city, { target: { value: " Berlin " } });
	fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
	await waitFor(() => expect(toastSuccess).toHaveBeenCalledOnce());
	expect(city).toHaveProperty("value", "Berlin");
	expect(leavingWouldWarn()).toBe(false);
	fireEvent.change(city, { target: { value: "Hamburg" } });
	expect(leavingWouldWarn()).toBe(true);
	fireEvent.change(city, { target: { value: "Berlin" } });
	expect(leavingWouldWarn()).toBe(false);
	fireEvent.change(city, { target: { value: "Hamburg" } });
	unmount();
	expect(leavingWouldWarn()).toBe(false);
});

it("lets an admin edit the registered address and save a partial profile with visible feedback", async () => {
	save.mockImplementation(async (profile) => ({
		success: true,
		data: { ok: true, profile },
	}));
	render(
		<OrganizationProfileCard
			profile={EMPTY_ORGANIZATION_PROFILE}
		/>,
	);
	for (const label of [
		"Legal company name",
		"Address line 1",
		"Address line 2 (optional)",
		"Postal code",
		"City",
		"State or region (optional)",
		"Country",
		"VAT ID (optional)",
	]) {
		expect(screen.getByLabelText(label)).toBeTruthy();
	}
	fireEvent.change(screen.getByLabelText("Legal company name"), {
		target: { value: "Umami Creative GmbH" },
	});
	fireEvent.change(screen.getByLabelText("Address line 2 (optional)"), {
		target: { value: "Floor 2" },
	});
	fireEvent.change(screen.getByLabelText("Country"), {
		target: { value: "DE" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
	await waitFor(() =>
		expect(toastSuccess).toHaveBeenCalledWith("Organization profile saved"),
	);
	expect(screen.queryByRole("status")).toBeNull();
	expect(save).toHaveBeenCalledWith({
		...EMPTY_ORGANIZATION_PROFILE,
		legalCompanyName: "Umami Creative GmbH",
		addressLine2: "Floor 2",
		country: "DE",
	});
	expect(refresh).toHaveBeenCalledOnce();
});

it("shows accessible field errors, focuses the invalid field and allows correction", async () => {
	save.mockImplementation(async (profile) => ({
		success: true,
		data: { ok: true, profile },
	}));
	render(
		<OrganizationProfileCard
			profile={EMPTY_ORGANIZATION_PROFILE}
		/>,
	);
	const vat = screen.getByLabelText("VAT ID (optional)");
	fireEvent.change(vat, { target: { value: "bad" } });
	fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
	const error = await screen.findByRole("alert");
	expect(error.textContent).toContain("two-letter country prefix");
	expect(vat.getAttribute("aria-invalid")).toBe("true");
	expect(vat.getAttribute("aria-describedby")).toContain(error.id);
	expect(document.activeElement).toBe(vat);
	expect(save).not.toHaveBeenCalled();
	fireEvent.change(vat, { target: { value: "DE123456789" } });
	fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
	await waitFor(() => expect(toastSuccess).toHaveBeenCalledOnce());
	expect(screen.queryByRole("alert")).toBeNull();
});

it("presents field errors returned by the server and keeps the entered values", async () => {
	save.mockResolvedValue({
		success: true,
		data: { ok: false, fieldErrors: { vatId: "invalidVatId" } },
	});
	render(
		<OrganizationProfileCard
			profile={{ ...EMPTY_ORGANIZATION_PROFILE, vatId: "DE123456789" }}
		/>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
	expect((await screen.findByRole("alert")).textContent).toContain(
		"two-letter country prefix",
	);
	expect(screen.getByLabelText("VAT ID (optional)")).toHaveProperty(
		"value",
		"DE123456789",
	);
	expect(refresh).not.toHaveBeenCalled();
});

it.each(["denied", "network"])(
	"shows save failure feedback for a %s failure without losing edits",
	async (failure) => {
		if (failure === "network")
			save.mockRejectedValue(new Error("Request failed"));
		else
			save.mockResolvedValue({
				success: false,
				code: "AuthorizationError",
				error: "Permission revoked",
			});
		render(
			<OrganizationProfileCard
				profile={EMPTY_ORGANIZATION_PROFILE}
			/>,
		);
		fireEvent.change(screen.getByLabelText("City"), {
			target: { value: "Berlin" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
		await waitFor(() =>
			expect(toastError).toHaveBeenCalledWith(
				expect.stringContaining("Could not save"),
			),
		);
		expect(screen.getByLabelText("City")).toHaveProperty("value", "Berlin");
		expect(toastSuccess).not.toHaveBeenCalled();
		const leaving = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(leaving);
		expect(leaving.defaultPrevented).toBe(true);
	},
);

it("loads saved details, prevents duplicate submissions while saving and lets the user clear them", async () => {
	let finish!: (value: unknown) => void;
	save.mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	render(
		<OrganizationProfileCard
			profile={{
				...EMPTY_ORGANIZATION_PROFILE,
				legalCompanyName: "Legal entity",
				city: "Berlin",
			}}
		/>,
	);
	expect(screen.getByLabelText("Legal company name")).toHaveProperty(
		"value",
		"Legal entity",
	);
	fireEvent.change(screen.getByLabelText("Legal company name"), {
		target: { value: "" },
	});
	fireEvent.change(screen.getByLabelText("City"), { target: { value: "" } });
	fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
	await waitFor(() =>
		expect(screen.getByRole("button", { name: "Saving…" })).toHaveProperty(
			"disabled",
			true,
		),
	);
	expect(screen.getByLabelText("City").closest("fieldset")).toHaveProperty(
		"disabled",
		true,
	);
	await act(async () => {
		finish({
			success: true,
			data: { ok: true, profile: EMPTY_ORGANIZATION_PROFILE },
		});
	});
	await waitFor(() => expect(toastSuccess).toHaveBeenCalledOnce());
	expect(screen.getByLabelText("Legal company name")).toHaveProperty(
		"value",
		"",
	);
	expect(save).toHaveBeenCalledWith(EMPTY_ORGANIZATION_PROFILE);
});
