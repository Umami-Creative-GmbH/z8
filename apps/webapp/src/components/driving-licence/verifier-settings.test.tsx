// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import { afterEach, expect, it, vi } from "vitest";

const remote = vi.hoisted(() => ({
	save: vi.fn(),
	revoke: vi.fn(),
	revoked: false,
	until: null as string | null,
	expired: false,
	saveError: null as string | null,
	responsibility: null as unknown,
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
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		value,
		onChange,
		min,
		id,
		disabled,
	}: {
		value?: string | null;
		onChange: (value: string) => void;
		min?: string;
		id?: string;
		disabled?: boolean;
	}) => (
		<input
			id={id}
			data-testid="until-picker"
			data-min={min}
			disabled={disabled}
			value={value ?? ""}
			onChange={(event) => onChange(event.target.value)}
		/>
	),
}));
vi.mock("@/lib/organization/driving-licence/verifier-actions", () => ({
	getDrivingLicenceVerifierAdminDataAction: async () => ({
		success: true,
		data: {
			timezone: "Europe/Berlin",
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
							until: remote.until,
							expired: remote.expired,
						},
					],
		},
	}),
	getDrivingLicenceVerifierResponsibilityAction: async () => ({
		success: true,
		data: remote.responsibility,
	}),
	saveDrivingLicenceVerifierGrantAction: async (input: unknown) => {
		remote.save(input);
		return remote.saveError
			? { success: false, error: remote.saveError }
			: { success: true, data: { grantId: "grant" } };
	},
	revokeDrivingLicenceVerifierGrantAction: async (input: unknown) => {
		remote.revoke(input);
		remote.revoked = true;
		return { success: true, data: { grantId: "grant" } };
	},
}));
const { VerifierResponsibility, VerifierSettings } = await import(
	"./verifier-settings"
);
afterEach(() => {
	cleanup();
	remote.revoked = false;
	remote.until = null;
	remote.expired = false;
	remote.saveError = null;
	remote.responsibility = null;
	vi.clearAllMocks();
	vi.restoreAllMocks();
});
function renderWithClient(children: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>{children}</QueryClientProvider>,
	);
	return client;
}
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

it("lets an administrator change and clear a grant's until date, never before today in the calendar timezone", async () => {
	// 00:30 on 21 October in Europe/Berlin while it is still 20 October in UTC.
	vi.spyOn(Temporal.Now, "instant").mockReturnValue(
		Temporal.Instant.from("2026-10-20T22:30:00Z"),
	);
	remote.until = "2026-11-30";
	const user = userEvent.setup();
	const client = renderWithClient(<VerifierSettings />);
	expect(
		await screen.findByText(
			"Until Nov 30, 2026 (end of day, Europe/Berlin)",
		),
	).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Edit" }));
	const picker = screen.getByLabelText("Until (optional)");
	expect(picker.getAttribute("value")).toBe("2026-11-30");
	expect(picker.getAttribute("data-min")).toBe("2026-10-21");
	fireEvent.change(picker, { target: { value: "2026-12-15" } });
	await user.click(screen.getByRole("button", { name: "Save", exact: true }));
	await waitFor(() => expect(remote.save).toHaveBeenCalledTimes(1));
	expect(remote.save.mock.calls[0][0]).toEqual({
		verifierEmployeeId: "verifier",
		scope: "specific",
		teamIds: ["team"],
		employeeIds: [],
		until: "2026-12-15",
	});
	await user.click(screen.getByRole("button", { name: "Edit" }));
	fireEvent.change(screen.getByLabelText("Until (optional)"), {
		target: { value: "" },
	});
	await user.click(screen.getByRole("button", { name: "Save", exact: true }));
	await waitFor(() => expect(remote.save).toHaveBeenCalledTimes(2));
	expect(remote.save.mock.calls[1][0]).toMatchObject({ until: null });
	client.clear();
});

it("explains a refused past until date and shows an ended grant without prefilling its old date", async () => {
	remote.until = "2026-10-01";
	remote.expired = true;
	remote.saveError = "until_in_past";
	const user = userEvent.setup();
	const client = renderWithClient(<VerifierSettings />);
	expect(
		await screen.findByText(
			"Ended after Oct 1, 2026 (Europe/Berlin). Edit it to extend or revoke it.",
		),
	).toBeTruthy();
	await user.click(screen.getByRole("button", { name: "Edit" }));
	expect(
		screen.getByLabelText("Until (optional)").getAttribute("value"),
	).toBe("");
	fireEvent.change(screen.getByLabelText("Until (optional)"), {
		target: { value: "2026-10-01" },
	});
	await user.click(screen.getByRole("button", { name: "Save", exact: true }));
	await waitFor(() =>
		expect(toast.error).toHaveBeenCalledWith(
			"The until date can't be in the past.",
		),
	);
	client.clear();
});

it("tells a verifier when their responsibility ends", async () => {
	remote.responsibility = {
		id: "grant",
		verifierEmployeeId: "verifier",
		employmentPeriodId: null,
		scope: "all",
		teamIds: [],
		employeeIds: [],
		grantedBy: "admin",
		grantedAt: "2026-10-16T12:00:00Z",
		revokedAt: null,
		revokedBy: null,
		expiresAt: "2026-11-30T23:00:00.000Z",
		until: "2026-11-30",
		expired: false,
		timezone: "Europe/Berlin",
		teams: [],
		employees: [],
	};
	const client = renderWithClient(<VerifierResponsibility />);
	expect(
		await screen.findByText(
			"Your responsibility ends after Nov 30, 2026 (Europe/Berlin).",
		),
	).toBeTruthy();
	client.clear();
});
