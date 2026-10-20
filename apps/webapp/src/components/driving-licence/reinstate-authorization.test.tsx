// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { DrivingLicenceEmployeeRecord } from "@/lib/organization/driving-licence/checks";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: "verifier" }, session: { activeOrganizationId: "org" } },
	}),
}));
const remote = vi.hoisted(() => ({ reinstate: vi.fn() }));
vi.mock("@/lib/organization/driving-licence/impediment-actions", () => ({
	getDrivingImpedimentStateAction: async () => ({
		success: true,
		data: { reports: [], suspension: null },
	}),
	reinstateDrivingAuthorizationAction: remote.reinstate,
}));
const { ReinstateDrivingAuthorization } = await import("./reinstate-authorization");

afterEach(() => {
	cleanup();
	remote.reinstate.mockReset();
});

const suspendedClass = (code: string) => ({
	code,
	status: "suspended",
	reason: "check_overdue",
	validThrough: "2026-02-10",
	deadlineTimezone: "Europe/Berlin",
	restrictions: "",
	supportingCheckId: "check",
});
const record = {
	enrolled: true,
	status: "suspended",
	authorizedClasses: [],
	timezone: "Europe/Berlin",
	uncertainEmailCount: 0,
	classes: [suspendedClass("B"), suspendedClass("C")],
	checks: [
		{
			id: "check",
			originalInspected: true,
			identityConfirmed: true,
			employeeDeclaration: true,
			verifierConfirmed: true,
			classes: ["B", "C"].map((code) => ({
				code,
				result: "successful",
				expiryDate: null,
				restrictions: "",
			})),
		},
	],
	events: [],
} as unknown as DrivingLicenceEmployeeRecord;

it("reinstates the chosen classes only after the verifier ticks the resolution confirmation (#1429)", async () => {
	remote.reinstate.mockResolvedValue({ success: true, data: {} });
	const user = userEvent.setup();
	const onCompleted = vi.fn(async () => undefined);
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			<ReinstateDrivingAuthorization
				employeeId="employee"
				record={record}
				onCompleted={onCompleted}
			/>
		</QueryClientProvider>,
	);
	const submit = await screen.findByRole("button", { name: "Reinstate selected classes" });
	await waitFor(() => expect(screen.getByRole("checkbox", { name: "B" })).toBeTruthy());
	const classB = screen.getByRole("checkbox", { name: "B" });
	const confirmation = screen.getByRole("checkbox", { name: /impediments are resolved/ });
	expect(classB.tagName).not.toBe("INPUT");
	expect(confirmation.tagName).not.toBe("INPUT");

	await user.click(classB);
	expect((submit as HTMLButtonElement).disabled).toBe(true);
	await user.click(confirmation);
	await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
	await user.click(submit);

	await waitFor(() =>
		expect(remote.reinstate).toHaveBeenCalledWith({
			employeeId: "employee",
			checkId: "check",
			classCodes: ["B"],
			impedimentResolved: true,
			expectedReportIds: [],
			expectedSuspension: null,
		}),
	);
	expect(await screen.findByText("The selected classes were explicitly reinstated.")).toBeTruthy();
	expect(onCompleted).toHaveBeenCalled();
});
