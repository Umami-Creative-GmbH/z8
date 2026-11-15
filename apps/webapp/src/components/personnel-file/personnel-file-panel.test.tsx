// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Activity } from "react";
import { toast } from "sonner";
import { expect, it, vi } from "vitest";
import { getPersonnelFileAction } from "@/app/[locale]/(app)/personnel-files/actions";
import { unlinkSickNoteAction } from "@/app/[locale]/(app)/personnel-files/sick-note-actions";
import { PersonnelFilePanel } from "./personnel-file-panel";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

it("keeps a sick-note link after rejected transport and offers its action again", async () => {
	vi.mocked(unlinkSickNoteAction).mockRejectedValueOnce(new Error("offline"));
	vi.mocked(getPersonnelFileAction).mockResolvedValue({
		success: true,
		data: {
			capability,
			documents: [
				{
					id: "note",
					employeeId: "employee",
					category: "sick_note",
					title: "Medical note",
					visibility: "hr_only",
					documentDate: "2026-01-15",
					payPeriod: null,
					expiryDate: null,
					fileName: "note.pdf",
					mimeType: "application/pdf",
					sizeBytes: 10,
					createdAt: "2026-01-15T12:00:00Z",
					skill: null,
					absence: {
						id: "absence",
						startDate: "2026-01-15",
						endDate: "2026-01-15",
					},
				},
			],
		},
	});
	setup();
	const button = await screen.findByRole("button", {
		name: "Unlink Medical note from its sick leave",
	});
	fireEvent.click(button);
	await screen.findByRole("button", {
		name: "Unlink Medical note from its sick leave",
	});
	await act(async () => {});
	expect(toast.error).toHaveBeenCalledWith(
		"The sick note could not be unlinked.",
	);
	expect((button as HTMLButtonElement).disabled).toBe(false);
});

vi.mock("@/app/[locale]/(app)/personnel-files/actions", () => ({
	getPersonnelFileAction: vi.fn(),
	updateEmployeeDocumentAction: vi.fn(),
	deleteEmployeeDocumentAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/personnel-files/sick-note-actions", () => ({
	unlinkSickNoteAction: vi.fn(),
	listSickLeaveForLinkingAction: vi.fn(),
	linkSickNoteAction: vi.fn(),
}));
vi.mock(
	"@/app/[locale]/(app)/personnel-files/skill-certificate-actions",
	() => ({
		listCertificateSkillOptionsAction: vi.fn(),
		setCertificateSkillAction: vi.fn(),
	}),
);
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, key: string) =>
				String(params?.[key] ?? match),
			),
	}),
}));
vi.mock("@/components/providers/app-locale-provider", () => ({
	useAppLocale: () => "en-GB",
}));
vi.mock("@/components/providers/organization-context-provider", () => ({
	useOrganization: () => ({ userId: "officer", activeOrganizationId: "org" }),
}));
const capability = {
	employeeId: "employee",
	categories: ["certificate" as const],
	today: "2026-11-15",
	timezone: "Europe/Berlin",
};

it("blocks concurrent unlink actions and ignores late completion across Activity suspension", async () => {
	let finish: (value: { success: true; data: { documentId: string } }) => void =
		() => {
			throw new Error("Action not started");
		};
	vi.mocked(toast.success).mockClear();
	vi.mocked(unlinkSickNoteAction)
		.mockReset()
		.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
	const note = {
		id: "note",
		employeeId: "employee",
		category: "sick_note" as const,
		title: "Medical note",
		visibility: "hr_only" as const,
		documentDate: "2026-01-15",
		payPeriod: null,
		expiryDate: null,
		fileName: "note.pdf",
		mimeType: "application/pdf",
		sizeBytes: 10,
		createdAt: "2026-01-15T12:00:00Z",
		skill: null,
		absence: { id: "absence", startDate: "2026-01-15", endDate: "2026-01-15" },
	};
	vi.mocked(getPersonnelFileAction).mockResolvedValue({
		success: true,
		data: {
			capability,
			documents: [note, { ...note, id: "note-2", title: "Second note" }],
		},
	});
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const content = (mode: "visible" | "hidden") => (
		<QueryClientProvider client={client}>
			<Activity mode={mode}>
				<PersonnelFilePanel capability={capability} />
			</Activity>
		</QueryClientProvider>
	);
	const view = render(content("visible"));
	fireEvent.click(
		await screen.findByRole("button", {
			name: "Unlink Medical note from its sick leave",
		}),
	);
	fireEvent.click(
		screen.getByRole("button", {
			name: "Unlink Second note from its sick leave",
		}),
	);
	expect(unlinkSickNoteAction).toHaveBeenCalledTimes(1);
	view.rerender(content("hidden"));
	view.rerender(content("visible"));
	await act(async () =>
		finish({ success: true, data: { documentId: "note" } }),
	);
	expect(toast.success).not.toHaveBeenCalled();
	expect(
		(
			screen.getByRole("button", {
				name: "Unlink Medical note from its sick leave",
			}) as HTMLButtonElement
		).disabled,
	).toBe(false);
});
function setup() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<PersonnelFilePanel
				capability={capability}
				initialCategory="certificate"
			/>
		</QueryClientProvider>,
	);
	return client;
}

it("retries a failed real reader boundary without presenting unavailable data as an empty file", async () => {
	vi.mocked(getPersonnelFileAction)
		.mockResolvedValueOnce({
			success: false,
			error: "Failed to load the personnel file",
		})
		.mockResolvedValue({ success: true, data: { capability, documents: [] } });
	setup();
	await screen.findByRole("alert");
	expect(screen.queryByText("No documents in this category yet.")).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await screen.findByText("No documents in this category yet.");
	expect(getPersonnelFileAction).toHaveBeenLastCalledWith({
		employeeId: "employee",
		category: "certificate",
	});
});

it("keeps the last successful records through a transient refetch failure and hides them after authority refusal", async () => {
	const document = {
		id: "doc",
		employeeId: "employee",
		title: "Safety qualification",
		category: "certificate" as const,
		visibility: "shared" as const,
		documentDate: "2026-01-15",
		payPeriod: null,
		expiryDate: null,
		fileName: "safety.pdf",
		mimeType: "application/pdf",
		sizeBytes: 10,
		createdAt: "2026-01-15T12:00:00Z",
		absence: null,
		skill: null,
	};
	vi.mocked(getPersonnelFileAction).mockResolvedValue({
		success: true,
		data: { capability, documents: [document] },
	});
	const client = setup();
	await screen.findByText("Safety qualification");
	vi.mocked(getPersonnelFileAction).mockRejectedValue(new Error("network"));
	await act(async () => {
		await client.invalidateQueries();
	});
	await screen.findByRole("alert");
	expect(screen.getByText("Safety qualification")).toBeTruthy();
	vi.mocked(getPersonnelFileAction).mockResolvedValue({
		success: false,
		error: "Personnel file not found",
	});
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await screen.findByText(
		"This personnel file is no longer available. Refresh the page to check your access.",
	);
	expect(screen.queryByText("Safety qualification")).toBeNull();
	expect(
		screen.queryByRole("button", { name: "Edit Safety qualification" }),
	).toBeNull();
});
