// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

const remote = vi.hoisted(() => ({
	held: false,
	released: false,
	cleaned: false,
	place: vi.fn(),
	release: vi.fn(),
}));
vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({
		t: (_key: string, fallback: string, values: Record<string, unknown> = {}) =>
			fallback.replace(/\{(\w+)\}/g, (_match, key) =>
				String(values[key] ?? key),
			),
	}),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: "admin" }, session: { activeOrganizationId: "org" } },
	}),
}));
vi.mock("@/lib/organization/driving-licence/retention-actions", () => ({
	getDrivingLicenceRetentionAction: async () => ({
		success: true,
		data: {
			organizationId: "org",
			records: remote.cleaned
				? []
				: [
						{
							checkId: "check",
							employeeId: "employee",
							employeeName: "Anna Driver",
							controlledAt: "2026-01-31T11:00:00Z",
							retentionStartedAt: "2026-02-28T23:00:00Z",
							deleteAfter: "2026-03-31T22:00:00Z",
							protected: false,
							due: true,
							holds: remote.held
								? [
										{
											id: "hold",
											caseReference: "CASE-17",
											preservationReason: "Pending liability proceeding",
											placedBy: "admin",
											placedAt: "2026-03-30T12:00:00Z",
											releasedAt: remote.released
												? "2026-04-05T12:00:00Z"
												: null,
											releasedBy: remote.released ? "admin" : null,
											releaseReason: remote.released
												? "The proceeding is complete"
												: null,
										},
									]
								: [],
						},
					],
			runs: remote.cleaned
				? [
						{
							id: "run",
							completedAt: "2026-04-05T12:00:00Z",
							actorUserId: "admin",
							deletedCount: 1,
							heldCount: 0,
							protectedCount: 0,
						},
					]
				: [],
		},
	}),
	placeDrivingLicenceHoldAction: async (input: unknown) => {
		remote.place(input);
		remote.held = true;
		return { success: true, data: { holdId: "hold" } };
	},
	releaseDrivingLicenceHoldAction: async (input: unknown) => {
		remote.release(input);
		remote.released = true;
		return { success: true, data: { holdId: "hold" } };
	},
	cleanupDrivingLicenceEvidenceAction: async () => {
		remote.cleaned = true;
		return { success: true, data: { deletedCount: 1 } };
	},
}));
const { DrivingLicenceRetentionSettings } = await import(
	"./retention-settings"
);
afterEach(() => {
	cleanup();
	remote.held = false;
	remote.released = false;
	remote.cleaned = false;
	remote.place.mockReset();
	remote.release.mockReset();
});
it("lets an administrator document and release a legal-case hold, then inspect the cleanup result without inspection details", async () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const user = userEvent.setup();
	render(
		<QueryClientProvider client={client}>
			<DrivingLicenceRetentionSettings />
		</QueryClientProvider>,
	);
	await user.selectOptions(
		await screen.findByRole("combobox", { name: "Check record" }),
		"check",
	);
	await user.type(
		screen.getByRole("textbox", { name: "Specific legal-case reference" }),
		"CASE-17",
	);
	await user.type(
		screen.getByRole("textbox", {
			name: "Why this case requires preservation",
		}),
		"Pending liability proceeding",
	);
	await user.click(
		screen.getByRole("button", { name: "Place a specific-case hold" }),
	);
	await screen.findByText(/Case CASE-17:/);
	expect(remote.place).toHaveBeenCalledWith({
		checkId: "check",
		caseReference: "CASE-17",
		preservationReason: "Pending liability proceeding",
	});
	await user.type(
		screen.getByRole("textbox", {
			name: "Why preservation is no longer required",
		}),
		"The proceeding is complete",
	);
	await user.click(screen.getByRole("button", { name: "Release hold" }));
	await screen.findByText(/Released by admin/);
	await user.click(
		screen.getByRole("button", { name: "Run due evidence cleanup" }),
	);
	await user.click(screen.getByRole("button", { name: "Delete due evidence" }));
	await screen.findByText(/1 deleted, 0 held, 0 protected/);
	expect(
		screen.queryByText(/declaration|document expiry|Original inspected/i),
	).toBeNull();
	await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
	client.clear();
});
