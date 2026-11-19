// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Activity, type ReactNode } from "react";
import { Temporal } from "temporal-polyfill";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AbsenceSickNotesPanel } from "@/components/absences/sick-notes/absence-sick-notes-panel";
import { useOwnAbsenceSickNotes } from "@/components/absences/sick-notes/use-own-absence-sick-notes";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import {
	parseSickLeaveOverviewParams,
	type SickLeaveOverviewRow,
} from "@/lib/personnel-file/sick-leave-overview";
import { PersonnelFilePanel } from "./personnel-file-panel";
import { SickLeaveOverview } from "./sick-leave-overview";
import { useEmployeeSickLeave } from "./sick-note-links";

const actions = vi.hoisted(() => ({
	list: vi.fn(),
	unlink: vi.fn(),
	documents: vi.fn(),
	own: vi.fn(),
	leave: vi.fn(),
}));
const auth = vi.hoisted(() => ({ userId: "actor-a", organizationId: "org-a", pending: false }));
const feedback = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({
	useSession: () => ({
		data: { user: { id: auth.userId }, session: { activeOrganizationId: auth.organizationId } },
		isPending: auth.pending,
	}),
}));
vi.mock("sonner", () => ({ toast: feedback }));
vi.mock("@/app/[locale]/(app)/personnel-files/actions", () => ({
	getPersonnelFileAction: actions.documents,
	updateEmployeeDocumentAction: vi.fn(),
	deleteEmployeeDocumentAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/personnel-files/skill-certificate-actions", () => ({
	listCertificateSkillOptionsAction: vi.fn(),
	setCertificateSkillAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/absences/sick-note-actions", () => ({
	listAbsenceSickNotesAction: actions.list,
	getOwnAbsenceSickNotesAction: actions.own,
}));
vi.mock("@/app/[locale]/(app)/personnel-files/sick-note-actions", () => ({
	unlinkSickNoteAction: actions.unlink,
	linkSickNoteAction: vi.fn(),
	listSickLeaveForLinkingAction: actions.leave,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (_, key) => String(values?.[key] ?? `{${key}}`)),
	}),
}));
vi.mock("@/components/providers/app-locale-provider", () => ({ useAppLocale: () => "en-GB" }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
	useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
const note = {
	id: "note-1",
	employeeId: "employee-1",
	category: "sick_note",
	title: "Synthetic current note",
	documentDate: "2026-11-01",
	visibility: "hr_only",
	fileName: "synthetic.pdf",
	mimeType: "application/pdf",
	sizeBytes: 12,
	createdAt: "2026-11-01T00:00:00Z",
	absence: null,
};
const row: SickLeaveOverviewRow = {
	absenceId: "absence-1",
	employeeId: "employee-1",
	employeeName: "Synthetic employee",
	employeeNumber: "0001",
	isFormer: false,
	startDate: "2026-11-01",
	startPeriod: "full_day",
	endDate: "2026-11-02",
	endPeriod: "full_day",
	status: "approved",
	sickDetail: "with_certificate",
	absenceDays: 1,
	sickNoteCount: 1,
	sickNotes: [{ id: note.id, title: "Synthetic row note" }],
};
const defaults = parseSickLeaveOverviewParams({}, Temporal.PlainDate.from("2026-11-16"));
const clients: QueryClient[] = [];
beforeEach(() => {
	auth.userId = "actor-a";
	auth.organizationId = "org-a";
	auth.pending = false;
	vi.clearAllMocks();
	actions.list.mockReset().mockResolvedValue({ success: true, data: [note] });
	actions.unlink.mockReset();
	actions.documents.mockReset();
	actions.own.mockReset();
	actions.leave.mockReset();
});

function DownstreamCounts() {
	const own = useOwnAbsenceSickNotes([{ id: row.absenceId, category: { type: "sick" } }]);
	const leave = useEmployeeSickLeave(row.employeeId);
	return (
		<>
			<output aria-label="Self note count">{own.markers[row.absenceId]?.count ?? 0}</output>
			<output aria-label="Employee note count">
				{leave.data?.find((item) => item.id === row.absenceId)?.sickNoteCount ?? "loading"}
			</output>
		</>
	);
}

it.each(["shared", "personnel-file"] as const)(
	"refreshes real marker, employee-count and document observers after an accepted %s unlink retires",
	async (origin) => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		clients.push(client);
		const capability = {
			employeeId: row.employeeId,
			categories: ["sick_note" as const],
			today: "2026-11-16",
			timezone: "Europe/Berlin",
		};
		const target = {
			id: row.absenceId,
			employeeId: row.employeeId,
			startDate: row.startDate,
			endDate: row.endDate,
		};
		let linked = true;
		const document = () => ({
			...note,
			payPeriod: null,
			expiryDate: null,
			skill: null,
			absence: linked ? target : null,
		});
		actions.list.mockImplementation(async () => ({
			success: true,
			data: linked ? [document()] : [],
		}));
		actions.own.mockImplementation(async () => ({
			success: true,
			data: {
				canAttach: true,
				markers: linked ? { [row.absenceId]: { count: 1, viewable: true } } : {},
			},
		}));
		actions.leave.mockImplementation(async () => ({
			success: true,
			data: [
				{
					id: row.absenceId,
					startDate: row.startDate,
					endDate: row.endDate,
					status: "approved",
					sickDetail: "with_certificate",
					sickNoteCount: linked ? 1 : 0,
				},
			],
		}));
		actions.documents.mockImplementation(async () => ({
			success: true,
			data: { capability, documents: [document()] },
		}));
		let finish: (value: unknown) => void = () => {
			throw new Error("Unlink not started");
		};
		actions.unlink.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const onChanged = vi.fn();
		const content = (mode: "visible" | "hidden" = "visible") => (
			<QueryClientProvider client={client}>
				<OrganizationContextProvider
					initialContext={{
						userId: "actor-a",
						organizationId: "org-a",
						employee: null,
						organizationSettings: null,
						updatedAt: Date.now(),
					}}
				>
					<DownstreamCounts />
					<section aria-label="Observed personnel file">
						<PersonnelFilePanel capability={capability} />
					</section>
					<Activity mode={mode}>
						{origin === "shared" ? (
							<AbsenceSickNotesPanel
								absence={target}
								open
								onOpenChange={vi.fn()}
								canAttach={false}
								manage
								onChanged={onChanged}
							/>
						) : (
							<section aria-label="Original personnel file">
								<PersonnelFilePanel capability={capability} />
							</section>
						)}
					</Activity>
				</OrganizationContextProvider>
			</QueryClientProvider>
		);
		const view = render(content());
		await waitFor(() => {
			expect(screen.getByLabelText("Self note count").textContent).toBe("1");
			expect(screen.getByLabelText("Employee note count").textContent).toBe("1");
		});
		const button =
			origin === "shared"
				? await screen.findByRole("button", { name: "Unlink Synthetic current note" })
				: await within(screen.getByLabelText("Original personnel file")).findByRole("button", {
						name: "Unlink Synthetic current note from its sick leave",
					});
		fireEvent.click(button);
		expect(actions.unlink).toHaveBeenCalledTimes(1);
		view.rerender(content("hidden"));
		await act(async () => {
			linked = false;
			finish({ success: true, data: document() });
		});
		await waitFor(() => {
			expect(screen.getByLabelText("Self note count").textContent).toBe("0");
			expect(screen.getByLabelText("Employee note count").textContent).toBe("0");
			expect(
				within(screen.getByLabelText("Observed personnel file")).getByRole("button", {
					name: "Link Synthetic current note to sick leave",
					hidden: true,
				}),
			).toBeTruthy();
		});
		expect(actions.own).toHaveBeenCalledTimes(2);
		expect(actions.leave).toHaveBeenCalledTimes(2);
		expect(actions.documents).toHaveBeenCalledTimes(2);
		expect(onChanged).not.toHaveBeenCalled();
		expect(feedback.success).not.toHaveBeenCalled();
	},
);

it("shares the pending document unlink when navigating from the overview to its personnel file", async () => {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	clients.push(client);
	const capability = {
		employeeId: row.employeeId,
		categories: ["sick_note" as const],
		today: "2026-11-16",
		timezone: "Europe/Berlin",
	};
	actions.documents.mockResolvedValue({
		success: true,
		data: {
			capability,
			documents: [
				{
					...note,
					payPeriod: null,
					expiryDate: null,
					skill: null,
					absence: { id: row.absenceId, startDate: row.startDate, endDate: row.endDate },
				},
			],
		},
	});
	const finishes: Array<(value: unknown) => void> = [];
	actions.unlink.mockImplementation(() => new Promise((finish) => finishes.push(finish)));
	const content = (selected = false) => (
		<QueryClientProvider client={client}>
			<OrganizationContextProvider
				initialContext={{
					userId: "actor-a",
					organizationId: "org-a",
					employee: null,
					organizationSettings: null,
					updatedAt: Date.now(),
				}}
			>
				{selected ? (
					<PersonnelFilePanel capability={capability} />
				) : (
					<SickLeaveOverview
						userId="actor-a"
						organizationId="org-a"
						filters={defaults}
						defaultRange={defaults}
						rows={[row]}
						total={1}
						page={1}
						pageCount={1}
						employees={[]}
						teams={[]}
					/>
				)}
			</OrganizationContextProvider>
		</QueryClientProvider>
	);
	const view = render(content());
	fireEvent.click(screen.getByRole("button", { name: /Attach or link sick notes for/ }));
	fireEvent.click(await screen.findByRole("button", { name: "Unlink Synthetic current note" }));
	expect(actions.unlink).toHaveBeenCalledTimes(1);
	view.rerender(content(true));
	fireEvent.click(
		await screen.findByRole("button", {
			name: "Unlink Synthetic current note from its sick leave",
		}),
	);
	const count = actions.unlink.mock.calls.length;
	await act(async () => {
		for (const finish of finishes) finish({ success: false, error: "Synthetic refusal" });
	});
	expect(count).toBe(1);
});
afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) client.clear();
});

it.each(["refusal", "rejection"] as const)(
	"reserves an unlink across organization A-B-A and releases it after %s",
	async (outcome) => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		clients.push(client);
		const resolves: Array<(value: unknown) => void> = [];
		const rejects: Array<(error: Error) => void> = [];
		let settled = 0;
		actions.unlink.mockImplementation(() => {
			return new Promise((resolve, reject) => {
				resolves.push((result) => {
					settled += 1;
					resolve(result);
				});
				rejects.push((error) => {
					settled += 1;
					reject(error);
				});
			});
		});
		const content = () => (
			<QueryClientProvider client={client}>
				<OrganizationContextProvider
					initialContext={{
						userId: "actor-a",
						organizationId: auth.organizationId,
						employee: null,
						organizationSettings: null,
						updatedAt: Date.now(),
					}}
				>
					<SickLeaveOverview
						userId="actor-a"
						organizationId="org-a"
						filters={defaults}
						defaultRange={defaults}
						rows={[row]}
						total={1}
						page={1}
						pageCount={1}
						employees={[]}
						teams={[]}
					/>
				</OrganizationContextProvider>
			</QueryClientProvider>
		);
		const view = render(content());
		fireEvent.click(screen.getByRole("button", { name: /Attach or link sick notes for/ }));
		fireEvent.click(await screen.findByRole("button", { name: "Unlink Synthetic current note" }));
		expect(actions.unlink).toHaveBeenCalledTimes(1);
		auth.organizationId = "org-b";
		view.rerender(content());
		expect(screen.queryByRole("dialog")).toBeNull();
		auth.organizationId = "org-a";
		view.rerender(content());
		fireEvent.click(screen.getByRole("button", { name: /Attach or link sick notes for/ }));
		expect(actions.unlink).toHaveBeenCalledTimes(1);
		const button = await screen.findByRole("button", { name: "Unlink Synthetic current note" });
		expect(button.hasAttribute("disabled")).toBe(true);
		expect(button.getAttribute("aria-busy")).toBe("true");
		fireEvent.click(button);
		const count = actions.unlink.mock.calls.length;
		expect(settled).toBe(0);
		await act(async () => {
			if (outcome === "rejection")
				for (const reject of rejects) reject(new Error("Synthetic transport rejection"));
			else for (const finish of resolves) finish({ success: false, error: "Synthetic refusal" });
		});
		expect(count).toBe(1);
		expect(feedback.error).not.toHaveBeenCalled();
		expect(feedback.success).not.toHaveBeenCalled();
		await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
		actions.unlink.mockResolvedValueOnce({ success: false, error: "Current refusal" });
		fireEvent.click(button);
		await waitFor(() => expect(actions.unlink).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(feedback.error).toHaveBeenCalledWith("Current refusal"));
	},
);

it.each(["actor", "organization", "document"] as const)(
	"keeps an unrelated %s unlink independent",
	async (change) => {
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		clients.push(client);
		let displayedRow = row;
		let displayedNote = note;
		const finishes: Array<(value: unknown) => void> = [];
		actions.unlink.mockImplementation(() => new Promise((finish) => finishes.push(finish)));
		const content = () => (
			<QueryClientProvider client={client}>
				<OrganizationContextProvider
					initialContext={{
						userId: auth.userId,
						organizationId: auth.organizationId,
						employee: null,
						organizationSettings: null,
						updatedAt: Date.now(),
					}}
				>
					<SickLeaveOverview
						key={displayedRow.absenceId}
						userId={auth.userId}
						organizationId={auth.organizationId}
						filters={defaults}
						defaultRange={defaults}
						rows={[displayedRow]}
						total={1}
						page={1}
						pageCount={1}
						employees={[]}
						teams={[]}
					/>
				</OrganizationContextProvider>
			</QueryClientProvider>
		);
		const view = render(content());
		fireEvent.click(screen.getByRole("button", { name: /Attach or link sick notes for/ }));
		fireEvent.click(await screen.findByRole("button", { name: "Unlink Synthetic current note" }));
		if (change === "actor") auth.userId = "actor-b";
		if (change === "organization") auth.organizationId = "org-b";
		if (change === "document") {
			displayedNote = { ...note, id: "note-2", title: "Synthetic second note" };
			displayedRow = {
				...row,
				absenceId: "absence-2",
				sickNotes: [{ id: displayedNote.id, title: displayedNote.title }],
			};
		}
		actions.list.mockResolvedValue({ success: true, data: [displayedNote] });
		view.rerender(content());
		fireEvent.click(screen.getByRole("button", { name: /Attach or link sick notes for/ }));
		const button = await screen.findByRole("button", { name: `Unlink ${displayedNote.title}` });
		expect(button.hasAttribute("disabled")).toBe(false);
		fireEvent.click(button);
		expect(actions.unlink).toHaveBeenCalledTimes(2);
		await act(async () => {
			for (const finish of finishes) finish({ success: false, error: "Synthetic refusal" });
		});
		expect(feedback.error).toHaveBeenCalledTimes(1);
	},
);
