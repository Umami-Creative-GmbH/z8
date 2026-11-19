// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { withdrawAbsenceChangeAction } from "@/app/[locale]/(app)/absences/change-actions";
import type { AbsenceChangeSummary } from "@/lib/absences/change-request-types";
import { OwnAbsenceActionsProvider } from "./own-absence-actions";
import { OwnAbsenceChangeRequests } from "./own-absence-change-requests";

const mocks = vi.hoisted(() => ({
	changes: {
		data: undefined as AbsenceChangeSummary[] | undefined,
		isError: false,
		refetch: vi.fn(),
	},
	refresh: vi.fn(),
	invalidateReadiness: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTolgee: () => ({ getLanguage: () => "en" }),
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/[locale]/(app)/absences/change-actions", () => ({
	withdrawAbsenceChangeAction: vi.fn(),
}));
vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/lib/query/period-submission-readiness", () => ({
	useInvalidatePeriodSubmissionReadiness: () => mocks.invalidateReadiness,
}));
vi.mock("./use-own-absence-changes", () => ({
	useOwnAbsenceChanges: () => mocks.changes,
}));
vi.mock("@/app/[locale]/(app)/absences/actions", () => ({
	cancelAbsenceRequest: vi.fn(),
}));
vi.mock("./sick-notes/use-own-absence-sick-notes", () => ({
	useOwnAbsenceSickNotes: () => ({
		canAttach: false,
		markers: {},
		refresh: async () => undefined,
	}),
}));
vi.mock("./absence-change-dialog", () => ({ AbsenceChangeDialog: () => null }));
vi.mock("./change-deputy-dialog", () => ({ ChangeDeputyDialog: () => null }));
vi.mock("./sick-notes/absence-sick-notes-panel", () => ({
	AbsenceSickNotesPanel: () => null,
}));
vi.mock("./sick-notes/attach-sick-note-dialog", () => ({
	AttachSickNoteDialog: () => null,
}));

function renderSection(onUpdate = vi.fn()) {
	return render(
		<OwnAbsenceActionsProvider absences={[]} onUpdate={onUpdate}>
			<OwnAbsenceChangeRequests />
		</OwnAbsenceActionsProvider>,
	);
}

const pending: AbsenceChangeSummary = {
	id: "request",
	absenceId: "absence",
	kind: "cancel",
	status: "pending",
	original: {
		startDate: "2026-10-05",
		endDate: "2026-10-09",
		startPeriod: "full_day",
		endPeriod: "full_day",
		categoryId: "category",
		canonicalRecordId: null,
		canonical: null,
		updatedAt: "2026-10-01T00:00:00Z",
	},
	proposed: null,
	reason: "Entered in error",
	decisionReason: null,
	createdAt: "2026-10-14T00:00:00Z",
	decidedAt: null,
	deciderName: null,
};

beforeEach(() => {
	mocks.changes = { data: undefined, isError: false, refetch: vi.fn() };
	mocks.refresh.mockReset();
	mocks.invalidateReadiness.mockReset();
	vi.mocked(withdrawAbsenceChangeAction).mockReset();
});

it("renders nothing when the employee has no change requests", () => {
	mocks.changes.data = [];
	const { container } = renderSection();
	expect(container.innerHTML).toBe("");
});

it("reports a failed load and retries it", () => {
	mocks.changes.isError = true;
	renderSection();
	expect(screen.getByRole("alert").textContent).toContain(
		"Could not load change requests.",
	);
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	expect(mocks.changes.refetch).toHaveBeenCalledOnce();
});

it("reloads the change list, the page and the absences after a withdrawal", async () => {
	mocks.changes.data = [pending];
	vi.mocked(withdrawAbsenceChangeAction).mockResolvedValue({
		success: true,
		data: { id: "request", workflowId: "workflow" },
	});
	const onUpdate = vi.fn();
	renderSection(onUpdate);
	fireEvent.click(screen.getByRole("button", { name: "Withdraw request" }));
	await waitFor(() => expect(onUpdate).toHaveBeenCalledOnce());
	expect(mocks.changes.refetch).toHaveBeenCalledOnce();
	expect(mocks.refresh).toHaveBeenCalledOnce();
	expect(mocks.invalidateReadiness).toHaveBeenCalledOnce();
});
