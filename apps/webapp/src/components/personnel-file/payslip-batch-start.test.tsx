// @vitest-environment jsdom
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { Activity } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { PayslipBatchStart } from "./payslip-batch-start";
import { PayslipBatchesScope } from "./payslip-batches-scope";

const boundary = vi.hoisted(() => ({
	start: vi.fn(),
	push: vi.fn(),
	toastError: vi.fn(),
	scope: {
		userId: "actor",
		activeOrganizationId: "org-a",
		isLoading: false,
		error: null as string | null,
	},
}));
vi.mock("sonner", () => ({ toast: { error: boundary.toastError } }));
vi.mock("@/components/providers/organization-context-provider", () => ({
	useOrganization: () => boundary.scope,
}));
vi.mock("@/app/[locale]/(app)/personnel-files/payslip-batches/actions", () => ({
	startPayslipBatchAction: boundary.start,
}));
vi.mock("@/navigation", () => ({ useRouter: () => ({ push: boundary.push }) }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
const scope = { userId: "actor", organizationId: "org-a" };
const props = {
	defaultPayPeriod: { year: 2026, month: 11 },
	expectedScope: scope,
};

it("keeps one start pending through Activity until its result settles", async () => {
	let finish!: (value: unknown) => void;
	boundary.start
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		)
		.mockResolvedValueOnce({ success: true, data: { id: "fresh" } });
	const tree = (mode: "visible" | "hidden") => (
		<Activity mode={mode}>
			<PayslipBatchStart {...props} />
		</Activity>
	);
	const view = render(tree("visible"));
	fireEvent.change(screen.getByRole("textbox", { name: /Pay period year/ }), {
		target: { value: "2025" },
	});
	const form = screen.getByRole("button", { name: "Start batch" }).closest("form");
	if (!form) throw new Error("The start button must belong to its form");
	const submit = new Event("submit", { bubbles: true, cancelable: true });
	fireEvent(form, submit);
	expect(submit.defaultPrevented).toBe(true);
	await waitFor(() => expect(boundary.start).toHaveBeenCalledTimes(1));
	view.rerender(tree("hidden"));
	view.rerender(tree("visible"));
	const start = screen.getByRole("button", { name: "Start batch" });
	expect(start.hasAttribute("disabled")).toBe(true);
	fireEvent.click(start);
	expect(boundary.start).toHaveBeenCalledTimes(1);
	await act(async () => finish({ success: true, data: { id: "retired" } }));
	await waitFor(() => expect(start.hasAttribute("disabled")).toBe(false));
	expect(boundary.push).not.toHaveBeenCalled();
	expect(boundary.toastError).not.toHaveBeenCalled();
	expect(screen.queryByRole("alert")).toBeNull();
	expect(screen.getByDisplayValue("2025")).toBeTruthy();
	fireEvent.click(start);
	await waitFor(() => expect(boundary.start).toHaveBeenCalledTimes(2));
	await waitFor(() =>
		expect(boundary.push).toHaveBeenCalledWith("/personnel-files/payslip-batches/fresh"),
	);
});

it.each(["account", "organization"])(
	"drops validation-queued work across an %s switch and return",
	async (change) => {
		boundary.start.mockResolvedValue({ success: true, data: { id: "stale" } });
		const renderScope = () => (
			<PayslipBatchesScope {...scope}>
				<PayslipBatchStart {...props} />
			</PayslipBatchesScope>
		);
		const view = render(renderScope());
		fireEvent.click(screen.getByRole("button", { name: "Start batch" }));
		boundary.scope = {
			...boundary.scope,
			...(change === "account"
				? { userId: "other" }
				: { activeOrganizationId: "org-b" }),
		};
		view.rerender(renderScope());
		boundary.scope = {
			userId: "actor",
			activeOrganizationId: "org-a",
			isLoading: false,
			error: null,
		};
		view.rerender(renderScope());
		await act(async () => {
			await new Promise((done) => setTimeout(done, 20));
		});
		expect(boundary.start).not.toHaveBeenCalled();
		expect(boundary.push).not.toHaveBeenCalled();
	},
);
beforeEach(() => {
	vi.clearAllMocks();
	boundary.scope = {
		userId: "actor",
		activeOrganizationId: "org-a",
		isLoading: false,
		error: null,
	};
});

it.each(["organization", "account", "loading", "error"])(
	"hides stale arrivals and ignores a pending result across %s scope changes and return",
	async (change) => {
		let finish!: (value: unknown) => void;
		boundary.start.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const children = (
			<PayslipBatchesScope {...scope}>
				<PayslipBatchStart {...props} />
				<a href="/batch-a">History A</a>
			</PayslipBatchesScope>
		);
		const view = render(children);
		fireEvent.click(screen.getByRole("button", { name: "Start batch" }));
		await waitFor(() => expect(boundary.start).toHaveBeenCalledTimes(1));
		boundary.scope = {
			...boundary.scope,
			...(change === "organization"
				? { activeOrganizationId: "org-b" }
				: change === "account"
					? { userId: "another" }
					: change === "loading"
						? { isLoading: true }
						: { error: "unavailable" }),
		};
		view.rerender(
			<PayslipBatchesScope {...scope}>
				<PayslipBatchStart {...props} />
				<a href="/batch-a">History A</a>
			</PayslipBatchesScope>,
		);
		expect(screen.queryByRole("link", { name: "History A" })).toBeNull();
		boundary.scope = {
			userId: "actor",
			activeOrganizationId: "org-a",
			isLoading: false,
			error: null,
		};
		view.rerender(
			<PayslipBatchesScope {...scope}>
				<PayslipBatchStart {...props} />
				<a href="/batch-a">History A</a>
			</PayslipBatchesScope>,
		);
		await act(async () => finish({ success: true, data: { id: "late" } }));
		expect(boundary.push).not.toHaveBeenCalled();
		expect(screen.getByRole("link", { name: "History A" })).toBeTruthy();
	},
);

it("keeps invalid input, focuses its error, and never submits it", async () => {
	render(<PayslipBatchStart {...props} />);
	const year = screen.getByRole("textbox", { name: /Pay period year/ });
	fireEvent.change(year, { target: { value: "20" } });
	fireEvent.click(screen.getByRole("button", { name: "Start batch" }));
	await waitFor(() => expect(year.getAttribute("aria-invalid")).toBe("true"));
	await waitFor(() => expect(document.activeElement).toBe(year));
	expect((year as HTMLInputElement).value).toBe("20");
	expect(boundary.start).not.toHaveBeenCalled();
});

it("keeps the draft through a same-scope refresh of calendar defaults", () => {
	const view = render(<PayslipBatchStart {...props} />);
	fireEvent.change(screen.getByRole("textbox", { name: /Pay period year/ }), {
		target: { value: "2025" },
	});
	view.rerender(
		<PayslipBatchStart
			{...props}
			defaultPayPeriod={{ year: 2027, month: 1 }}
		/>,
	);
	expect(
		(
			screen.getByRole("textbox", {
				name: /Pay period year/,
			}) as HTMLInputElement
		).value,
	).toBe("2025");
});

it("does not start a queued submission after Activity hides it during validation", async () => {
	boundary.start.mockResolvedValue({ success: true, data: { id: "stale" } });
	const view = render(
		<Activity mode="visible">
			<PayslipBatchStart {...props} />
		</Activity>,
	);
	fireEvent.click(screen.getByRole("button", { name: "Start batch" }));
	view.rerender(
		<Activity mode="hidden">
			<PayslipBatchStart {...props} />
		</Activity>,
	);
	await act(async () => {
		await new Promise((done) => setTimeout(done, 20));
	});
	view.rerender(
		<Activity mode="visible">
			<PayslipBatchStart {...props} />
		</Activity>,
	);
	expect(boundary.start).not.toHaveBeenCalled();
	expect(boundary.push).not.toHaveBeenCalled();
});

it.each(["success", "failure"])(
	"ignores late %s effects after an Activity hide/show lifetime",
	async (outcome) => {
		let finish!: (value: unknown) => void;
		boundary.start.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const view = render(
			<Activity mode="visible">
				<PayslipBatchStart {...props} />
			</Activity>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Start batch" }));
		await waitFor(() => expect(boundary.start).toHaveBeenCalledTimes(1));
		fireEvent.click(screen.getByRole("button", { name: "Start batch" }));
		expect(boundary.start).toHaveBeenCalledTimes(1);
		view.rerender(
			<Activity mode="hidden">
				<PayslipBatchStart {...props} />
			</Activity>,
		);
		view.rerender(
			<Activity mode="visible">
				<PayslipBatchStart {...props} />
			</Activity>,
		);
		await act(async () =>
			finish(
				outcome === "success"
					? { success: true, data: { id: "stale" } }
					: { success: false, error: "Old failure" },
			),
		);
		expect(boundary.push).not.toHaveBeenCalled();
		expect(screen.queryByRole("alert")).toBeNull();
		expect(boundary.toastError).not.toHaveBeenCalled();
	},
);

it("retains the pay period after a transport failure and allows an explicit retry", async () => {
	boundary.start.mockRejectedValueOnce(new Error("offline"));
	boundary.start.mockResolvedValueOnce({
		success: true,
		data: { id: "batch" },
	});
	render(<PayslipBatchStart {...props} />);
	fireEvent.change(screen.getByRole("textbox", { name: /Pay period year/ }), {
		target: { value: "2025" },
	});
	fireEvent.click(screen.getByRole("button", { name: "Start batch" }));
	expect(await screen.findByRole("alert")).toBeTruthy();
	expect(
		(
			screen.getByRole("textbox", {
				name: /Pay period year/,
			}) as HTMLInputElement
		).value,
	).toBe("2025");
	fireEvent.click(screen.getByRole("button", { name: "Start batch" }));
	await waitFor(() =>
		expect(boundary.push).toHaveBeenCalledWith(
			"/personnel-files/payslip-batches/batch",
		),
	);
	expect(boundary.start).toHaveBeenLastCalledWith({
		payPeriod: { year: 2025, month: 11 },
		visibility: "shared",
		expectedScope: scope,
	});
});
