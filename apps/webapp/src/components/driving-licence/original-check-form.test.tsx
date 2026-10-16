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
vi.mock("@/lib/organization/driving-licence/history-actions", () => ({
	getDrivingLicenceHistoryAction: async () => ({ success: false }),
	supplementDrivingLicenceCheckAction: vi.fn(),
}));
const remote = vi.hoisted(() => ({ completed: false, submitted: vi.fn() }));
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
vi.mock("@/lib/organization/driving-licence/check-actions", () => ({
	getDrivingLicenceCheckWorklistAction: async () => ({
		success: true,
		data: [
			{
				employeeId: "employee",
				name: "Anna Driver",
				status: remote.completed ? "active" : "not_yet_checked",
				enrolled: true,
				authorizedClasses: remote.completed ? ["B"] : [],
				classes: [],
				timezone: "Europe/Berlin",
			},
		],
	}),
	getDrivingLicenceEmployeeRecordAction: async () => ({
		success: true,
		data: {
			enrolled: true,
			status: remote.completed ? "active" : "not_yet_checked",
			authorizedClasses: remote.completed ? ["B"] : [],
			timezone: "Europe/Berlin",
			classes: remote.completed
				? [
						{
							code: "B",
							status: "active",
							reason: null,
							validThrough: "2026-11-16",
							deadlineTimezone: "Europe/Berlin",
							restrictions: "",
						},
					]
				: [],
			checks: remote.completed
				? [
						{
							id: "check",
							employeeName: "Anna Driver",
							verifierName: "Vera Verifier",
							controlledAt: "2026-10-16T12:00:00.000Z",
							originalInspected: true,
							identityConfirmed: true,
							employeeDeclaration: true,
							verifierConfirmed: true,
							documentIssuedOn: "2020-01-01",
							documentExpiresOn: "2035-01-01",
							policyVersion: 1,
							deadlineTimezone: "Europe/Berlin",
							classes: [
								{
									code: "B",
									result: "successful",
									expiryDate: null,
									restrictions: "",
								},
							],
						},
					]
				: [],
			events: [],
		},
	}),
	completeDrivingLicenceCheckAction: async (input: unknown) => {
		remote.submitted(input);
		remote.completed = true;
		return { success: true, data: { checkId: "check" } };
	},
}));
const { DrivingLicenceVerifierWorklist } = await import("./check-worklist");
afterEach(() => {
	cleanup();
	remote.completed = false;
	remote.submitted.mockReset();
});
it("lets a scoped verifier record explicit original/employee attestations and then inspect the resulting class evidence", async () => {
	const user = userEvent.setup();
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<DrivingLicenceVerifierWorklist />
		</QueryClientProvider>,
	);
	await user.click(
		await screen.findByRole("button", { name: "Check Anna Driver" }),
	);
	fireEvent.change(screen.getByLabelText("Document issue date"), {
		target: { value: "2020-01-01" },
	});
	fireEvent.change(screen.getByLabelText("Document expiry date"), {
		target: { value: "2035-01-01" },
	});
	await user.click(screen.getByLabelText("B", { exact: true }));
	await user.click(
		screen.getByLabelText(/I personally inspected the original/),
	);
	await user.click(
		screen.getByLabelText(/I confirmed that the original document belongs/),
	);
	await user.click(
		screen.getByLabelText(/The employee personally made the declaration/),
	);
	await user.click(screen.getByLabelText(/I confirm that the recorded facts/));
	await user.click(
		screen.getByRole("button", { name: "Record original check" }),
	);
	await waitFor(() =>
		expect(remote.submitted).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "employee",
				originalInspected: true,
				identityConfirmed: true,
				employeeDeclaration: true,
				verifierConfirmed: true,
				classes: [
					{
						code: "B",
						result: "successful",
						expiryDate: null,
						restrictions: "",
					},
				],
			}),
		),
	);
	expect(
		await screen.findByText("Original check recorded by Vera Verifier"),
	).toBeTruthy();
	expect(
		screen.getByText("Valid through 2026-11-16 (Europe/Berlin)"),
	).toBeTruthy();
	expect(screen.queryByLabelText(/licence number/i)).toBeNull();
	expect(document.querySelector('input[type="file"]')).toBeNull();
	client.clear();
});
