// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { Temporal } from "temporal-polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AbsenceSickNotesPanel } from "@/components/absences/sick-notes/absence-sick-notes-panel";
import {
	parseSickLeaveOverviewParams,
	type SickLeaveOverviewRow,
} from "@/lib/personnel-file/sick-leave-overview";
import { SickLeaveOverview } from "./sick-leave-overview";

const navigation = vi.hoisted(() => ({ push: vi.fn(), search: "" }));
const noteActions = vi.hoisted(() => ({ list: vi.fn(), unlink: vi.fn() }));
const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: feedback }));
vi.mock("@/app/[locale]/(app)/absences/sick-note-actions", () => ({
	listAbsenceSickNotesAction: noteActions.list,
}));
vi.mock("@/app/[locale]/(app)/personnel-files/sick-note-actions", () => ({
	unlinkSickNoteAction: noteActions.unlink,
	linkSickNoteAction: vi.fn(),
	listSickLeaveForLinkingAction: vi.fn(),
}));
const scope = vi.hoisted(() => ({
	userId: "officer",
	activeOrganizationId: "organization",
}));
vi.mock("@/components/providers/organization-context-provider", () => ({
	useOrganization: () => scope,
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("@/components/providers/app-locale-provider", () => ({
	useAppLocale: () => "en-GB",
}));
vi.mock("next/navigation", () => ({
	useSearchParams: () => new URLSearchParams(navigation.search),
}));
vi.mock("@/navigation", () => ({
	Link: ({
		href,
		children,
		className,
	}: {
		href: string;
		children: ReactNode;
		className?: string;
	}) => (
		<a href={href} className={className}>
			{children}
		</a>
	),
	useRouter: () => ({ push: navigation.push }),
}));

const today = Temporal.PlainDate.from("2026-10-10");
const defaults = parseSickLeaveOverviewParams({}, today);

function row(overrides: Partial<SickLeaveOverviewRow>): SickLeaveOverviewRow {
	return {
		absenceId: "a1",
		employeeId: "e9850000-0000-4000-8000-000000000004",
		employeeName: "Anna Example",
		employeeNumber: null,
		isFormer: false,
		startDate: "2026-09-01",
		startPeriod: "full_day",
		endDate: "2026-09-02",
		endPeriod: "full_day",
		status: "approved",
		sickDetail: "with_certificate",
		absenceDays: 2,
		sickNoteCount: 0,
		sickNotes: [],
		...overrides,
	};
}

function renderOverview(
	rows: SickLeaveOverviewRow[],
	page = { page: 1, pageCount: 1 },
) {
	return render(
		<QueryClientProvider
			client={
				new QueryClient({ defaultOptions: { queries: { retry: false } } })
			}
		>
			<SickLeaveOverview
				userId="officer"
				organizationId="organization"
				filters={{ ...defaults, page: page.page }}
				defaultRange={{ from: defaults.from, to: defaults.to }}
				rows={rows}
				total={rows.length}
				page={page.page}
				pageCount={page.pageCount}
				employees={[]}
				teams={[]}
			/>
		</QueryClientProvider>,
	);
}

describe("SickLeaveOverview", () => {
	it.each(["hidden", "target"] as const)(
		"retires an accepted unlink completion across %s and reads afresh",
		async (change) => {
			const client = new QueryClient({
				defaultOptions: { queries: { retry: false } },
			});
			const onChanged = vi.fn();
			let settle: (value: unknown) => void = () => undefined;
			noteActions.list
				.mockReset()
				.mockResolvedValueOnce({
					success: true,
					data: [
						{
							id: "note-a",
							employeeId: row({}).employeeId,
							category: "sick_note",
							title: "Current note",
							documentDate: "2026-09-01",
							visibility: "hr_only",
							fileName: "note.pdf",
							mimeType: "application/pdf",
							sizeBytes: 10,
							createdAt: "2026-09-01T00:00:00Z",
							absence: null,
						},
					],
				})
				.mockResolvedValue({ success: true, data: [] });
			noteActions.unlink.mockImplementation(
				() =>
					new Promise((resolve) => {
						settle = resolve;
					}),
			);
			const content = (mode: "visible" | "hidden", absenceId = "a1") => (
				<QueryClientProvider client={client}>
					<Activity mode={mode}>
						<AbsenceSickNotesPanel
							absence={{
								id: absenceId,
								employeeId: row({}).employeeId,
								startDate: "2026-09-01",
								endDate: "2026-09-02",
							}}
							open
							onOpenChange={vi.fn()}
							canAttach={false}
							manage
							onChanged={onChanged}
						/>
					</Activity>
				</QueryClientProvider>
			);
			const view = render(content("visible"));
			fireEvent.click(await screen.findByRole("button", { name: /^Unlink/ }));
			const nextTarget = change === "target" ? "a2" : "a1";
			view.rerender(
				content(change === "hidden" ? "hidden" : "visible", nextTarget),
			);
			await act(async () => settle({ success: true, data: undefined }));
			view.rerender(content("visible", nextTarget));
			expect(
				await screen.findByText("No sick notes you can open."),
			).toBeTruthy();
			expect(onChanged).not.toHaveBeenCalled();
			expect(feedback.success).not.toHaveBeenCalled();
		},
	);
	it("retires an in-flight note read across Activity hide and reveal", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		let settle: (value: unknown) => void = () => undefined;
		noteActions.list
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						settle = resolve;
					}),
			)
			.mockResolvedValueOnce({ success: false, error: "Fresh refusal" });
		const content = (mode: "visible" | "hidden") => (
			<QueryClientProvider client={client}>
				<Activity mode={mode}>
					<SickLeaveOverview
						userId="officer"
						organizationId="organization"
						filters={defaults}
						defaultRange={defaults}
						rows={[row({})]}
						total={1}
						page={1}
						pageCount={1}
						employees={[]}
						teams={[]}
					/>
				</Activity>
			</QueryClientProvider>
		);
		const view = render(content("visible"));
		fireEvent.click(
			screen.getByRole("button", { name: /Attach or link sick notes for/ }),
		);
		await waitFor(() => expect(noteActions.list).toHaveBeenCalled());
		view.rerender(content("hidden"));
		settle({
			success: true,
			data: [{ id: "retired", title: "Retired health note" }],
		});
		view.rerender(content("visible"));
		expect(await screen.findByRole("alert")).toHaveProperty(
			"textContent",
			"The sick notes could not be loaded.",
		);
		expect(screen.queryByText("Retired health note")).toBeNull();
	});
	it("prevents duplicate pending unlink and keeps the note after a fresh refusal", async () => {
		let settle: (value: unknown) => void = () => undefined;
		noteActions.list.mockResolvedValue({
			success: true,
			data: [
				{
					id: "note-a",
					employeeId: row({}).employeeId,
					category: "sick_note",
					title: "Current note",
					documentDate: "2026-09-01",
					visibility: "hr_only",
					fileName: "note.pdf",
					mimeType: "application/pdf",
					sizeBytes: 10,
					createdAt: "2026-09-01T00:00:00Z",
					absence: null,
				},
			],
		});
		noteActions.unlink.mockImplementation(
			() =>
				new Promise((resolve) => {
					settle = resolve;
				}),
		);
		renderOverview([row({})]);
		fireEvent.click(
			screen.getByRole("button", { name: /Attach or link sick notes for/ }),
		);
		const unlink = await screen.findByRole("button", { name: /^Unlink/ });
		fireEvent.click(unlink);
		fireEvent.click(unlink);
		expect(noteActions.unlink).toHaveBeenCalledTimes(1);
		expect(unlink).toHaveProperty("disabled", true);
		settle({ success: false, error: "Fresh refusal" });
		await waitFor(() => expect(unlink).toHaveProperty("disabled", false));
		expect(screen.getByText("Current note")).toBeTruthy();
	});
	it("requires a fresh note read when reopening after the displayed organization changed", async () => {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const content = () => (
			<QueryClientProvider client={client}>
				<SickLeaveOverview
					userId="officer"
					organizationId="organization"
					filters={defaults}
					defaultRange={defaults}
					rows={[row({})]}
					total={1}
					page={1}
					pageCount={1}
					employees={[]}
					teams={[]}
				/>
			</QueryClientProvider>
		);
		noteActions.list
			.mockResolvedValueOnce({
				success: true,
				data: [
					{
						id: "note-a",
						employeeId: row({}).employeeId,
						category: "sick_note",
						title: "Retired health note",
						documentDate: "2026-09-01",
						visibility: "hr_only",
						fileName: "note.pdf",
						mimeType: "application/pdf",
						sizeBytes: 10,
						createdAt: "2026-09-01T00:00:00Z",
						absence: null,
					},
				],
			})
			.mockImplementationOnce(() => new Promise(() => {}));
		const view = render(content());
		fireEvent.click(
			screen.getByRole("button", { name: /Attach or link sick notes for/ }),
		);
		await screen.findByText("Retired health note");
		scope.activeOrganizationId = "other";
		view.rerender(content());
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		scope.activeOrganizationId = "organization";
		view.rerender(content());
		fireEvent.click(
			screen.getByRole("button", { name: /Attach or link sick notes for/ }),
		);
		expect(screen.queryByText("Retired health note")).toBeNull();
	});
	it("keeps a failed panel read distinct from an absence with no note", async () => {
		noteActions.list
			.mockResolvedValueOnce({
				success: false,
				error: "Synthetic unavailable read",
			})
			.mockResolvedValueOnce({ success: true, data: [] });
		renderOverview([row({})]);
		fireEvent.click(
			screen.getByRole("button", { name: /Attach or link sick notes for/ }),
		);
		const dialog = await screen.findByRole("dialog");
		expect((await within(dialog).findByRole("alert")).textContent).toBe(
			"The sick notes could not be loaded.",
		);
		expect(
			within(dialog).queryByText("No sick notes you can open."),
		).toBeNull();
		fireEvent.click(within(dialog).getByRole("button", { name: "Retry" }));
		expect(
			await within(dialog).findByText("No sick notes you can open."),
		).toBeTruthy();
	});
	beforeEach(() => {
		noteActions.list.mockReset();
		noteActions.unlink.mockReset();
		navigation.search = "";
		scope.userId = "officer";
		scope.activeOrganizationId = "organization";
		vi.clearAllMocks();
	});
	it("provides a named keyboard comparison region with all fields and no reminder actions", () => {
		renderOverview([row({ status: "pending", employeeNumber: "0017" })]);
		const comparison = screen.getByRole("region", { name: "Sick leave" });
		expect(comparison.tabIndex).toBe(0);
		expect(within(comparison).getAllByRole("columnheader")).toHaveLength(6);
		expect(within(comparison).getByText("Pending")).toBeTruthy();
		expect(within(comparison).getByText("0017")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: /remind|request/i }),
		).toBeNull();
	});
	it("lists each absence with its employee's sick note file, its notes to open and former employees marked", () => {
		renderOverview([
			row({
				absenceId: "a1",
				sickNoteCount: 1,
				sickNotes: [{ id: "d1", title: "Certificate September" }],
			}),
			row({
				absenceId: "a2",
				employeeId: "e9850000-0000-4000-8000-000000000006",
				employeeName: "Lea Leaver",
				isFormer: true,
				sickDetail: "without_certificate",
			}),
		]);

		const [, anna, lea] = screen.getAllByRole("row");
		expect(
			within(anna)
				.getByRole("link", { name: "Anna Example" })
				.getAttribute("href"),
		).toBe(
			"/personnel-files/e9850000-0000-4000-8000-000000000004?category=sick_note",
		);
		expect(
			within(anna)
				.getByRole("link", { name: "Open {title}" })
				.getAttribute("href"),
		).toBe("/api/personnel-files/documents/d1");
		expect(within(anna).getByText("With certificate")).toBeTruthy();
		expect(within(lea).getByText("Former employee")).toBeTruthy();
		expect(within(lea).getByText("No note")).toBeTruthy();
		expect(within(lea).getByText("Without certificate")).toBeTruthy();
	});

	it("pages through the URL, keeping the filters", () => {
		navigation.search = "notes=missing";
		renderOverview([row({})], { page: 1, pageCount: 3 });

		fireEvent.click(screen.getByRole("button", { name: "Next page" }));

		expect(navigation.push).toHaveBeenCalledWith(
			"/personnel-files/sick-leave?notes=missing&page=2",
		);
	});

	it("withholds records and actions belonging to another displayed account or organization", () => {
		scope.activeOrganizationId = "other-organization";
		const view = renderOverview([row({})]);
		expect(screen.queryByRole("table")).toBeNull();
		expect(screen.queryByRole("button", { name: "Attach or link" })).toBeNull();
		scope.activeOrganizationId = "organization";
		scope.userId = "other-officer";
		view.rerender(
			<SickLeaveOverview
				userId="officer"
				organizationId="organization"
				filters={defaults}
				defaultRange={defaults}
				rows={[row({})]}
				total={1}
				page={1}
				pageCount={1}
				employees={[]}
				teams={[]}
			/>,
		);
		expect(screen.queryByRole("table")).toBeNull();
	});

	it("resets the entire URL filter scope, including paging and page size", () => {
		navigation.search = "notes=missing&page=3&pageSize=10";
		render(
			<SickLeaveOverview
				userId="officer"
				organizationId="organization"
				filters={{ ...defaults, notes: "missing", page: 3, pageSize: 10 }}
				defaultRange={defaults}
				rows={[]}
				total={0}
				page={1}
				pageCount={1}
				employees={[]}
				teams={[]}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
		expect(navigation.push).toHaveBeenCalledWith("/personnel-files/sick-leave");
		expect(screen.getByRole("status").textContent).toBe(
			"No sick leave in this period matches the filters.",
		);
	});
});
