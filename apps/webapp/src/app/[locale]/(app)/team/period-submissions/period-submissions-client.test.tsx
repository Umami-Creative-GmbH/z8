// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Activity, type ComponentProps } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { PeriodSubmissionsClient } from "./period-submissions-client";

const seam = vi.hoisted(() => ({
	read: vi.fn(),
	push: vi.fn(),
	session: {
		data: { user: { id: "reader" }, session: { activeOrganizationId: "org-a" } },
		isPending: false,
	},
}));
vi.mock("./actions", () => ({ readPeriodSubmissionOverview: seam.read }));
vi.mock("@/lib/auth-client", () => ({ useSession: () => seam.session }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ push: seam.push }),
	Link: ({ href, children, ...props }: ComponentProps<"a"> & { href: string }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));
const access = { userId: "reader", organizationId: "org-a", scope: "all" as const };
const period = { startDate: "2026-03-02", endDate: "2026-03-08", cadence: "weekly" as const };
const result = {
	status: "ok",
	scope: "all",
	overview: {
		kind: "ok",
		timezone: "Europe/Berlin",
		periods: [period],
		selected: period,
		running: false,
		rows: [
			{
				employeeId: "anna",
				name: "Anna",
				...period,
				status: "submitted",
				highlighted: false,
				submittedAt: null,
				opensOn: "2026-03-08",
			},
		],
		counts: {
			awaiting_submission: 0,
			submitted: 1,
			approved: 0,
			rejected: 0,
			sent_back_after_change: 0,
		},
	},
};
beforeEach(() => {
	seam.read.mockReset();
	seam.session.isPending = false;
	seam.session.data.user.id = "reader";
	seam.session.data.session.activeOrganizationId = "org-a";
});
it("retains a same-period record after rejected refresh and retries its real read", async () => {
	seam.read.mockResolvedValueOnce(result);
	render(<PeriodSubmissionsClient access={access} requestedPeriod={null} />);
	await screen.findByRole("link", { name: "Open the calendar of Anna" });
	seam.read.mockRejectedValueOnce(new Error("private database error"));
	fireEvent.click(screen.getByRole("button", { name: "Refresh submissions" }));
	await screen.findByRole("alert");
	expect(screen.queryByText("private database error")).toBeNull();
	expect(screen.getByRole("link", { name: "Open the calendar of Anna" })).toBeTruthy();
	seam.read.mockResolvedValueOnce(result);
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
	expect(seam.read).toHaveBeenCalledTimes(3);
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
it("blocks retained pending session data and drops late A reads across A to B to A", async () => {
	const old = deferred<typeof result>();
	const fresh = deferred<typeof result>();
	seam.read.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
	const view = render(<PeriodSubmissionsClient access={access} requestedPeriod={null} />);
	await waitFor(() => expect(seam.read).toHaveBeenCalledTimes(1));
	seam.session.data.session.activeOrganizationId = "org-b";
	view.rerender(<PeriodSubmissionsClient access={access} requestedPeriod={null} />);
	seam.session.data.session.activeOrganizationId = "org-a";
	seam.session.isPending = true;
	view.rerender(<PeriodSubmissionsClient access={access} requestedPeriod={null} />);
	await act(async () => old.resolve(result));
	expect(screen.queryByText("Anna")).toBeNull();
	expect(seam.read).toHaveBeenCalledTimes(1);
	seam.session.isPending = false;
	view.rerender(<PeriodSubmissionsClient access={access} requestedPeriod={null} />);
	await waitFor(() => expect(seam.read).toHaveBeenCalledTimes(2));
	expect(screen.queryByText("Anna")).toBeNull();
	await act(async () => fresh.resolve(result));
	await screen.findByText("Anna");
});
it("refuses an old actor snapshot and clears records on an authoritative read refusal", async () => {
	seam.read.mockResolvedValueOnce(result);
	const view = render(<PeriodSubmissionsClient access={access} requestedPeriod={null} />);
	await screen.findByText("Anna");
	seam.session.data.user.id = "other";
	view.rerender(<PeriodSubmissionsClient access={access} requestedPeriod={null} />);
	expect(screen.queryByText("Anna")).toBeNull();
	seam.session.data.user.id = "reader";
	seam.read.mockResolvedValueOnce(result);
	view.rerender(<PeriodSubmissionsClient access={access} requestedPeriod={null} />);
	await screen.findByText("Anna");
	seam.read.mockResolvedValueOnce({ status: "forbidden" });
	fireEvent.click(screen.getByRole("button", { name: "Refresh submissions" }));
	await screen.findByText(/Period submissions are unavailable/);
	expect(screen.queryByText("Anna")).toBeNull();
	expect(screen.queryByRole("link", { name: "Open the approval inbox" })).toBeNull();
});
it("invalidates Activity reads, refuses hidden queued refreshes, and reads freshly on reactivation", async () => {
	const old = deferred<typeof result>();
	seam.read.mockResolvedValueOnce(result).mockReturnValueOnce(old.promise);
	const view = render(
		<Activity mode="visible">
			<PeriodSubmissionsClient access={access} requestedPeriod={null} />
		</Activity>,
	);
	await screen.findByText("Anna");
	const refresh = screen.getByRole("button", { name: "Refresh submissions" });
	fireEvent.click(refresh);
	await waitFor(() => expect(seam.read).toHaveBeenCalledTimes(2));
	view.rerender(
		<Activity mode="hidden">
			<PeriodSubmissionsClient access={access} requestedPeriod={null} />
		</Activity>,
	);
	fireEvent.click(refresh);
	expect(seam.read).toHaveBeenCalledTimes(2);
	await act(async () => old.resolve(result));
	const fresh = deferred<typeof result>();
	seam.read.mockReturnValueOnce(fresh.promise);
	view.rerender(
		<Activity mode="visible">
			<PeriodSubmissionsClient access={access} requestedPeriod={null} />
		</Activity>,
	);
	expect(screen.queryByText("Anna")).toBeNull();
	await act(async () => fresh.resolve(result));
	await screen.findByText("Anna");
});
it("does not duplicate a pending retry and retains rows across the server refresh of its access envelope", async () => {
	seam.read.mockResolvedValueOnce(result);
	const view = render(<PeriodSubmissionsClient access={access} requestedPeriod={null} />);
	await screen.findByText("Anna");
	const next = deferred<typeof result>();
	seam.read.mockReturnValueOnce(next.promise);
	const refresh = screen.getByRole("button", { name: "Refresh submissions" });
	fireEvent.click(refresh);
	fireEvent.click(refresh);
	view.rerender(<PeriodSubmissionsClient access={{ ...access }} requestedPeriod={null} />);
	expect(screen.getByText("Anna")).toBeTruthy();
	expect(seam.read).toHaveBeenCalledTimes(2);
	await act(async () => next.resolve(result));
});
it("keeps cadence-disabled guidance distinct and shows settings only to all-employee scope", async () => {
	seam.read.mockResolvedValueOnce({ status: "ok", scope: "managed", overview: { kind: "off" } });
	render(
		<PeriodSubmissionsClient access={{ ...access, scope: "managed" }} requestedPeriod={null} />,
	);
	await screen.findByText("Your organization does not collect period submissions.");
	expect(screen.queryByRole("link", { name: /Choose a submission cadence/ })).toBeNull();
});
it("does not turn an unavailable first read into zero counts and recovers locally", async () => {
	seam.read.mockResolvedValueOnce({ status: "unavailable" });
	render(<PeriodSubmissionsClient access={access} requestedPeriod={null} />);
	await screen.findByRole("alert");
	expect(screen.queryByRole("table")).toBeNull();
	expect(screen.queryByRole("list", { name: "Statuses" })).toBeNull();
	seam.read.mockResolvedValueOnce(result);
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await screen.findByText("Anna");
});
it("drops the previous wider snapshot when the server narrows the admitted scope", async () => {
	seam.read.mockResolvedValueOnce(result);
	const view = render(<PeriodSubmissionsClient access={access} requestedPeriod={null} />);
	await screen.findByText("Anna");
	const narrowed = deferred<typeof result>();
	seam.read.mockReturnValueOnce(narrowed.promise);
	view.rerender(
		<PeriodSubmissionsClient access={{ ...access, scope: "managed" }} requestedPeriod={null} />,
	);
	expect(screen.queryByText("Anna")).toBeNull();
	expect(seam.read).toHaveBeenCalledTimes(2);
	await act(async () => narrowed.resolve(result));
});
