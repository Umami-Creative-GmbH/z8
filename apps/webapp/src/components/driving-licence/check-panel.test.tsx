// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DrivingLicenceEmployeeRecord } from "@/lib/organization/driving-licence/checks";
import { queryKeys } from "@/lib/query";

const remote = vi.hoisted(() => ({
	record: vi.fn(),
	refresh: vi.fn(),
	complete: vi.fn(),
}));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: remote.refresh }),
}));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: {
			user: { id: "verifier" },
			session: { activeOrganizationId: "org" },
		},
	}),
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values: Record<string, unknown> = {}) =>
			fallback.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? key)),
	}),
	useTolgee: () => ({ getLanguage: () => "en" }),
}));
vi.mock("@/lib/organization/driving-licence/check-actions", () => ({
	getDrivingLicenceEmployeeRecordAction: remote.record,
	completeDrivingLicenceCheckAction: remote.complete,
}));
vi.mock("@/lib/organization/driving-licence/history-actions", () => ({
	getDrivingLicenceHistoryAction: async () => ({
		success: true,
		data: {
			employeeId: "employee",
			canSupplement: false,
			period: { from: null, to: null },
			authorization: { status: "not_yet_checked" },
			checks: [],
			supplements: [],
			events: [],
		},
	}),
	supplementDrivingLicenceCheckAction: vi.fn(),
}));
vi.mock("@/lib/organization/driving-licence/impediment-actions", () => ({
	getDrivingImpedimentStateAction: vi.fn(),
	reinstateDrivingAuthorizationAction: vi.fn(),
}));
const { DrivingLicenceCheckPanel } = await import("./check-panel");
const record: DrivingLicenceEmployeeRecord = {
	enrolled: true,
	status: "not_yet_checked",
	authorizedClasses: [],
	declared: null,
	declaredUnchecked: [],
	timezone: "Europe/Berlin",
	uncertainEmailCount: 0,
	personWideReason: null,
	classes: [],
	checks: [],
	events: [],
};
let client: QueryClient;
beforeEach(() => {
	remote.record.mockReset().mockResolvedValue({ success: true, data: record });
	remote.refresh.mockReset();
	remote.complete.mockReset();
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
it("keeps the original-check draft and announces refusal at the task", async () => {
	remote.complete.mockResolvedValue({
		success: false,
		error: "Check your current responsibility.",
	});
	mount();
	const button = await screen.findByRole("button", {
		name: "Record original check",
	});
	fireEvent.change(screen.getByLabelText("Document issue date"), {
		target: { value: "2020-01-01" },
	});
	fireEvent.click(screen.getByRole("checkbox", { name: "B Car" }));
	fireEvent.change(screen.getByLabelText("Necessary driving restrictions"), {
		target: { value: "Corrective lenses" },
	});
	const form = button.closest("form");
	if (!form) throw new Error("Original check form is missing");
	fireEvent.submit(form);
	expect((await screen.findByRole("alert")).textContent).toBe(
		"Check your current responsibility.",
	);
	expect(
		(
			screen.getByLabelText(
				"Necessary driving restrictions",
			) as HTMLInputElement
		).value,
	).toBe("Corrective lenses");
});
it("withdraws stale evidence and actions after a failed read and retries with a fresh server guard", async () => {
	mount();
	await screen.findByRole("button", { name: "Record original check" });
	remote.record.mockRejectedValue(new Error("transport unavailable"));
	await client.invalidateQueries({
		queryKey: queryKeys.drivingLicence.record("org", "verifier", "employee"),
	});
	await screen.findByRole("alert");
	expect(
		screen.queryByRole("button", { name: "Record original check" }),
	).toBeNull();
	expect(
		screen.queryByRole("heading", { name: "Original check evidence" }),
	).toBeNull();
	remote.record.mockResolvedValue({ success: true, data: record });
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await screen.findByRole("button", { name: "Record original check" });
	expect(remote.refresh).toHaveBeenCalled();
});
afterEach(() => {
	cleanup();
	client.clear();
});
function mount(canVerify = true) {
	return render(
		<QueryClientProvider client={client}>
			<DrivingLicenceCheckPanel
				employeeId="employee"
				name="Anna Driver"
				canVerify={canVerify}
			/>
		</QueryClientProvider>,
	);
}
it("puts current authorization and the original check before supporting evidence and complete history", async () => {
	mount();
	await screen.findByRole("heading", {
		name: "Inspect Anna Driver's original licence",
	});
	expect(
		screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
	).toEqual([
		"Not yet checked — no driving authorization",
		"Inspect Anna Driver's original licence",
		"Original check evidence",
		"Check and authorization history",
	]);
});
it("retains the ended/former read-only path and the missing intended-driver path", async () => {
	remote.record.mockResolvedValue({
		success: true,
		data: { ...record, status: "ended" },
	});
	const view = mount(false);
	await screen.findByRole("heading", { name: "Driving authorization ended" });
	expect(
		screen.queryByRole("button", { name: "Record original check" }),
	).toBeNull();
	await screen.findByRole("link", { name: "Download evidence PDF" });
	view.unmount();
	client.clear();
	remote.record.mockResolvedValue({
		success: true,
		data: { ...record, enrolled: false, status: "not_enrolled" },
	});
	mount();
	await screen.findByText(
		"Anna Driver is not an intended driver. A check is needed only for intended drivers.",
	);
	expect(
		screen.queryByRole("button", { name: "Record original check" }),
	).toBeNull();
});
it("prevents duplicate pending original checks while retaining the current draft", async () => {
	let finish: (value: { success: false; error: string }) => void = () => {
		throw new Error("Submission not pending");
	};
	remote.complete.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	mount();
	const button = await screen.findByRole("button", {
		name: "Record original check",
	});
	fireEvent.click(screen.getByRole("checkbox", { name: "B Car" }));
	const form = button.closest("form");
	if (!form) throw new Error("Original check form missing");
	fireEvent.submit(form);
	await waitFor(() =>
		expect(
			(
				screen.getByRole("button", {
					name: "Recording check…",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true),
	);
	fireEvent.submit(form);
	expect(remote.complete).toHaveBeenCalledTimes(1);
	finish({ success: false, error: "Try again" });
	await screen.findByRole("alert");
	expect(
		screen.getByRole("checkbox", { name: "B Car" }).getAttribute("aria-checked"),
	).toBe("true");
});
