// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const remote = vi.hoisted(() => ({
	canSupplement: true,
	corrected: false,
	submitted: vi.fn(),
	read: vi.fn(),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values: Record<string, unknown> = {}) =>
			fallback.replace(/\{(\w+)\}/g, (_match, key) =>
				String(values[key] ?? key),
			),
	}),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: {
			user: { id: "verifier" },
			session: { activeOrganizationId: "org" },
		},
	}),
}));
vi.mock("@/lib/organization/driving-licence/history-actions", () => ({
	getDrivingLicenceHistoryAction: async (input: unknown) => {
		remote.read(input);
		return {
			success: true,
			data: {
				employeeId: "employee",
				canSupplement: remote.canSupplement,
				period: { from: null, to: null },
				authorization: { status: "active" },
				checks: [
					{
						id: "check",
						employeeName: "Anna Driver",
						verifierName: "Vera Verifier",
						controlledAt: "2026-01-31T11:00:00.000Z",
						documentIssuedOn: "2020-05-01",
						documentExpiresOn: "2035-05-01",
						originalInspected: true,
						identityConfirmed: true,
						employeeDeclaration: true,
						verifierConfirmed: true,
						declarationText: "I confirm no known driving impediment.",
						policyVersion: 1,
						intervalMonths: 1,
						deadlineTimezone: "Europe/Berlin",
						inPeriod: true,
						classes: [
							{
								code: "B",
								result: "successful",
								expiryDate: null,
								restrictions: "",
							},
						],
					},
				],
				supplements: remote.corrected
					? [
							{
								id: "supplement",
								checkId: "check",
								authorName: "Vera Verifier",
								recordedAt: "2026-02-02T10:00:00.000Z",
								reason: "recording_error",
								correction: { field: "documentIssuedOn", value: "2020-05-02" },
								inPeriod: true,
							},
						]
					: [],
				events: [
					{
						id: "event",
						checkId: "check",
						classCode: "B",
						kind: "authorized",
						reason: null,
						effectiveAt: "2026-01-31T11:00:00.000Z",
						recordedAt: "2026-01-31T11:00:00.000Z",
						inPeriod: true,
					},
				],
			},
		};
	},
	supplementDrivingLicenceCheckAction: async (input: unknown) => {
		remote.submitted(input);
		remote.corrected = true;
		return { success: true, data: { supplementId: "supplement" } };
	},
}));
const { DrivingLicenceHistoryPanel } = await import("./history-panel");
afterEach(() => {
	cleanup();
	remote.canSupplement = true;
	remote.corrected = false;
	remote.submitted.mockReset();
	remote.read.mockReset();
});
function show() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<DrivingLicenceHistoryPanel employeeId="employee" />
		</QueryClientProvider>,
	);
	return client;
}
it("appends a correction beside unchanged original confirmation and authorization decisions", async () => {
	const client = show();
	const user = userEvent.setup();
	await user.click(
		await screen.findByRole("button", { name: /Supplement original check/ }),
	);
	await user.selectOptions(
		screen.getByLabelText("Corrected field"),
		"documentIssuedOn",
	);
	fireEvent.change(screen.getByLabelText("Corrected value"), {
		target: { value: "2020-05-02" },
	});
	await user.click(screen.getByRole("button", { name: "Save supplement" }));
	await waitFor(() =>
		expect(remote.submitted).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "employee",
				checkId: "check",
				correction: { field: "documentIssuedOn", value: "2020-05-02" },
			}),
		),
	);
	expect(await screen.findByText("2020-05-02")).toBeTruthy();
	expect(screen.getByText(/Document issued 2020-05-01/)).toBeTruthy();
	expect(screen.getByText("Original check and confirmation")).toBeTruthy();
	expect(screen.getByText("Authorization granted")).toBeTruthy();
	expect(screen.getByText(/Supplement by Vera Verifier/)).toBeTruthy();
	client.clear();
});
it("offers read-only history and explicit UTC period boundaries", async () => {
	remote.canSupplement = false;
	const client = show();
	expect(
		await screen.findByText("Original check and confirmation"),
	).toBeTruthy();
	expect(
		screen.queryByRole("button", { name: /Supplement original check/ }),
	).toBeNull();
	fireEvent.change(screen.getByLabelText("From date (UTC)"), {
		target: { value: "2026-02-01" },
	});
	fireEvent.change(screen.getByLabelText("Before date (UTC)"), {
		target: { value: "2026-03-01" },
	});
	await userEvent.click(screen.getByRole("button", { name: "Apply period" }));
	await waitFor(() =>
		expect(remote.read).toHaveBeenCalledWith({
			employeeId: "employee",
			from: "2026-02-01T00:00:00Z",
			to: "2026-03-01T00:00:00Z",
		}),
	);
	client.clear();
});
