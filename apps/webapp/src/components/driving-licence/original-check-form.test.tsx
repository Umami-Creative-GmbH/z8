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
	useTolgee: () => ({ getLanguage: () => "en" }),
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
				canVerify: true,
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
vi.mock("@/lib/organization/driving-licence/impediment-actions", () => ({
	getDrivingImpedimentStateAction: vi.fn(),
	reinstateDrivingAuthorizationAction: vi.fn(),
}));
const { DrivingLicenceCheckPanel } = await import("./check-panel");
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
			<DrivingLicenceCheckPanel employeeId="employee" name="Anna Driver" canVerify />
		</QueryClientProvider>,
	);
	await screen.findByRole("heading", { name: "Inspect Anna Driver's original licence" });
	fireEvent.change(screen.getByLabelText("Document issue date"), {
		target: { value: "2020-01-01" },
	});
	fireEvent.change(screen.getByLabelText("Document expiry date"), {
		target: { value: "2035-01-01" },
	});
	// Inspected classes, the declaration and the confirmations are design-system
	// checkboxes (#1429), not native inputs.
	const classB = screen.getByRole("checkbox", { name: "B" });
	expect(classB.tagName).not.toBe("INPUT");
	await user.click(classB);
	await user.click(screen.getByRole("combobox", { name: "Result" }));
	await user.click(await screen.findByRole("option", { name: "Inconclusive" }));
	await user.click(
		screen.getByRole("combobox", {
			name: "Scope of an unsuccessful or inconclusive check",
		}),
	);
	await user.click(
		await screen.findByRole("option", {
			name: "Every authorization based on the document",
		}),
	);
	for (const statement of [
		/I personally inspected the original/,
		/I confirmed that the original document belongs/,
		/The employee personally made the declaration/,
		/I confirm that the recorded facts/,
	]) {
		const confirmation = screen.getByRole("checkbox", { name: statement });
		expect(confirmation.tagName).not.toBe("INPUT");
		expect(confirmation.getAttribute("aria-checked")).toBe("false");
		await user.click(confirmation);
		expect(confirmation.getAttribute("aria-checked")).toBe("true");
	}
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
				failureScope: "document",
				classes: [
					{
						code: "B",
						result: "inconclusive",
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
	const status = screen.getByRole("region", { name: "Driving authorization active" });
	expect(within(status).getByText("Nov 16, 2026 (Europe/Berlin)")).toBeTruthy();
	expect(screen.queryByLabelText(/licence number/i)).toBeNull();
	expect(document.querySelector('input[type="file"]')).toBeNull();
	client.clear();
});
