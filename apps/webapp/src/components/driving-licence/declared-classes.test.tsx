// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const remote = vi.hoisted(() => ({
	save: vi.fn(async (_input: unknown) => ({ success: true, data: { declared: 1 } })),
	withdraw: vi.fn(async () => ({ success: true, data: { declared: 0 } })),
	refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: remote.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values: Record<string, unknown> = {}) =>
			fallback.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? key)),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
vi.mock("@/lib/organization/driving-licence/declared-classes-actions", () => ({
	saveDeclaredLicenceClassesAction: remote.save,
	withdrawDeclaredLicenceClassesAction: remote.withdraw,
}));
const { DeclaredLicenceClasses } = await import("./declared-classes");

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function renderCard(props: Partial<Parameters<typeof DeclaredLicenceClasses>[0]> = {}) {
	const client = new QueryClient();
	return render(
		<QueryClientProvider client={client}>
			<DeclaredLicenceClasses
				declared={null}
				declaredUnchecked={[]}
				authorizedClasses={[]}
				{...props}
			/>
		</QueryClientProvider>,
	);
}

describe("declared licence classes (#2003)", () => {
	it("invites a not yet checked driver to declare classes, with C's own expiry date", async () => {
		const user = userEvent.setup();
		renderCard();
		expect(screen.getByRole("heading", { name: "What can you drive?" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Add licence classes" }));
		const dialog = await screen.findByRole("dialog", {
			name: "Which classes are on your licence?",
		});
		expect(within(dialog).getByRole("group", { name: "Trucks" })).toBeTruthy();
		const save = within(dialog).getByRole("button", { name: /^Save/ });
		expect(save.hasAttribute("disabled")).toBe(true);

		await user.click(within(dialog).getByRole("checkbox", { name: "C Truck" }));
		await user.click(within(dialog).getByRole("checkbox", { name: "B Car" }));
		fireEvent.change(within(dialog).getByLabelText("C (Truck) expires on"), {
			target: { value: "2030-01-31" },
		});
		expect(within(dialog).queryByLabelText("B (Car) expires on")).toBeNull();
		await user.click(save);

		await waitFor(() =>
			expect(remote.save).toHaveBeenCalledWith({
				classes: [
					{ code: "B", expiryDate: null },
					{ code: "C", expiryDate: "2030-01-31" },
				],
				documentExpiresOn: null,
			}),
		);
		expect(remote.refresh).toHaveBeenCalled();
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("shows authorized classes locked, never as something to declare again", async () => {
		const user = userEvent.setup();
		renderCard({ authorizedClasses: ["B"] });
		expect(screen.getByRole("heading", { name: "Got another licence class?" })).toBeTruthy();
		await user.click(screen.getByRole("button", { name: "Add licence classes" }));
		const dialog = await screen.findByRole("dialog");
		const locked = within(dialog).getByRole("checkbox", { name: "B Car Authorized" });
		expect(locked.getAttribute("aria-checked")).toBe("true");
		expect(locked.hasAttribute("disabled") || locked.getAttribute("aria-disabled") === "true").toBe(
			true,
		);
		// Only an unchecked new class counts towards the save.
		expect(within(dialog).getByRole("button", { name: /^Save/ }).hasAttribute("disabled")).toBe(
			true,
		);
	});

	it("lists declared classes as not checked yet, and edits or removes them", async () => {
		const user = userEvent.setup();
		renderCard({
			declared: {
				classes: [{ code: "CE", expiryDate: "2029-03-31" }],
				documentExpiresOn: "2033-06-30",
				updatedAt: "2026-11-20T10:00:00.000Z",
			},
			declaredUnchecked: ["CE"],
		});
		const region = screen.getByRole("region", { name: "Your declared licence classes" });
		expect(within(region).getByText(/not checked yet/)).toBeTruthy();
		expect(within(region).getByText("Truck with trailer")).toBeTruthy();

		await user.click(within(region).getByRole("button", { name: "Edit" }));
		const dialog = await screen.findByRole("dialog");
		expect(
			within(dialog)
				.getByRole("checkbox", { name: "CE Truck with trailer" })
				.getAttribute("aria-checked"),
		).toBe("true");
		expect(
			(within(dialog).getByLabelText("Licence card expires on") as HTMLInputElement).value,
		).toBe("2033-06-30");
		expect(
			(within(dialog).getByLabelText("CE (Truck with trailer) expires on") as HTMLInputElement)
				.value,
		).toBe("2029-03-31");

		await user.click(within(dialog).getByRole("button", { name: "Remove my classes" }));
		await waitFor(() => expect(remote.withdraw).toHaveBeenCalled());
	});
});
