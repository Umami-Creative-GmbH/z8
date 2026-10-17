// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

const remote = vi.hoisted(() => ({
	save: vi.fn(),
	revoke: vi.fn(),
	revoked: false,
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: "admin" }, session: { activeOrganizationId: "org" } },
	}),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values: Record<string, unknown> = {}) =>
			fallback.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? key)),
	}),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/organization/driving-licence/verifier-actions", () => ({
	getDrivingLicenceVerifierAdminDataAction: async () => ({
		success: true,
		data: {
			employees: [
				{ id: "verifier", name: "Anna Verifier", email: "anna@example.test" },
			],
			teams: [{ id: "team", name: "Berlin" }],
			grants: remote.revoked
				? []
				: [
						{
							id: "grant",
							verifierEmployeeId: "verifier",
							employmentPeriodId: null,
							scope: "specific",
							teamIds: ["team"],
							employeeIds: [],
							grantedBy: "admin",
							grantedAt: "2026-10-16T12:00:00Z",
							revokedAt: null,
							revokedBy: null,
							expiresAt: null,
						},
					],
		},
	}),
	getDrivingLicenceVerifierResponsibilityAction: async () => ({
		success: true,
		data: null,
	}),
	saveDrivingLicenceVerifierGrantAction: async (input: unknown) => {
		remote.save(input);
		return { success: true, data: { grantId: "grant" } };
	},
	revokeDrivingLicenceVerifierGrantAction: async (input: unknown) => {
		remote.revoke(input);
		remote.revoked = true;
		return { success: true, data: { grantId: "grant" } };
	},
}));
const { VerifierSettings } = await import("./verifier-settings");
afterEach(() => {
	cleanup();
	remote.revoked = false;
	vi.clearAllMocks();
});
it("lets an administrator edit verifier scope and confirm revocation", async () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const user = userEvent.setup();
	render(
		<QueryClientProvider client={client}>
			<VerifierSettings />
		</QueryClientProvider>,
	);
	expect(await screen.findByText("Anna Verifier")).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Edit" }));
	await user.click(
		screen.getByRole("radio", { name: "All employees in this organization" }),
	);
	expect(
		screen
			.getByRole("button", { name: "Save", exact: true })
			.hasAttribute("disabled"),
	).toBe(false);
	await user.click(screen.getByRole("button", { name: "Save", exact: true }));
	await waitFor(() =>
		expect(remote.save).toHaveBeenCalledWith(
			expect.objectContaining({
				verifierEmployeeId: "verifier",
				scope: "all",
				teamIds: [],
				employeeIds: [],
			}),
		),
	);
	await user.click(screen.getByRole("button", { name: "Revoke", exact: true }));
	expect(await screen.findByRole("alertdialog")).toBeTruthy();
	expect(remote.revoke).not.toHaveBeenCalled();
	await user.click(
		within(screen.getByRole("alertdialog")).getByRole("button", {
			name: "Revoke",
			exact: true,
		}),
	);
	await waitFor(() =>
		expect(remote.revoke).toHaveBeenCalledWith({ grantId: "grant" }),
	);
	expect(
		await screen.findByText("No verifier responsibilities assigned"),
	).toBeTruthy();
	client.clear();
});
