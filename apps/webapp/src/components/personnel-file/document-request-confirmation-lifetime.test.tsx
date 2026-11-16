// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Activity } from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";
import { beforeEach, expect, it, vi } from "vitest";
import {
	cancelDocumentRequestAction,
	returnDocumentRequestAction,
} from "@/app/[locale]/(app)/personnel-files/document-request-actions";
import type { DocumentRequestView } from "@/lib/personnel-file/document-request.types";
import { render } from "@/test/render-with-translations";
import { DocumentRequestDecisionActions } from "./document-request-decision";
import { DocumentRequestOfficerActions } from "./document-request-officer-actions";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/[locale]/(app)/personnel-files/document-request-actions", () => ({
	cancelDocumentRequestAction: vi.fn(),
	returnDocumentRequestAction: vi.fn(),
	acceptDocumentRequestAction: vi.fn(),
	editDocumentRequestAction: vi.fn(),
}));

type Decision = "return" | "cancel";
const request: DocumentRequestView = {
	id: "request-a",
	employeeId: "employee-a",
	category: "certificate",
	title: "First aid",
	note: "",
	deadline: "2026-11-01",
	status: "submitted",
	overdue: false,
	version: 3,
	renewedDocument: null,
	createdByName: "Officer",
	createdAt: "2026-10-01T10:00:00Z",
	history: [],
	submissions: [],
	pendingDocuments: [],
};
const reason = "Please replace the evidence";
const actionFor = (kind: Decision) =>
	kind === "return" ? returnDocumentRequestAction : cancelDocumentRequestAction;
const actions = (kind: Decision, changed: () => void, selected = request) =>
	kind === "return" ? (
		<DocumentRequestDecisionActions request={selected} onDecided={changed} />
	) : (
		<DocumentRequestOfficerActions request={selected} today="2026-11-15" onChanged={changed} />
	);
function openConfirmation(kind: Decision) {
	fireEvent.click(
		screen.getByRole("button", {
			name: kind === "return" ? "Return First aid" : "Cancel First aid",
		}),
	);
	fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), { target: { value: reason } });
}
const submitName = (kind: Decision) =>
	kind === "return" ? "Return to employee" : "Cancel request";
beforeEach(() => vi.resetAllMocks());

it.each<{ kind: Decision; dismissal: "button" | "Escape" }>([
	{ kind: "return", dismissal: "button" },
	{ kind: "return", dismissal: "Escape" },
	{ kind: "cancel", dismissal: "button" },
	{ kind: "cancel", dismissal: "Escape" },
])(
	"keeps $kind pending through $dismissal and completes its current decision once",
	async ({ kind, dismissal }) => {
		const action = actionFor(kind);
		let finish!: (result: Awaited<ReturnType<typeof returnDocumentRequestAction>>) => void;
		vi.mocked(action).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const changed = vi.fn();
		render(actions(kind, changed));
		openConfirmation(kind);
		fireEvent.click(screen.getByRole("button", { name: submitName(kind) }));
		await waitFor(() => expect(action).toHaveBeenCalledOnce());
		if (dismissal === "Escape") {
			fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape", code: "Escape" });
		} else {
			fireEvent.click(
				screen.getByRole("button", { name: kind === "return" ? "Cancel" : "Keep request" }),
			);
		}
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		const form = screen.getByRole("button", { name: submitName(kind) }).closest("form");
		if (!form) throw new Error("Decision form missing");
		fireEvent.submit(form);
		expect(action).toHaveBeenCalledOnce();
		await act(async () => finish({ success: true, data: request }));
		await waitFor(() => expect(changed).toHaveBeenCalledOnce());
		expect(toast.success).toHaveBeenCalledOnce();
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(action).toHaveBeenCalledWith({ requestId: request.id, reason, expectedVersion: 3 });
	},
);

it.each<{ kind: Decision; retirement: "Activity" | "revision" }>([
	{ kind: "return", retirement: "Activity" },
	{ kind: "cancel", retirement: "Activity" },
	{ kind: "return", retirement: "revision" },
	{ kind: "cancel", retirement: "revision" },
])(
	"retires queued $kind validation on $retirement before a fresh confirmation",
	async ({ kind, retirement }) => {
		const action = actionFor(kind);
		vi.mocked(action).mockResolvedValue({ success: false, error: "Not found", code: "not_found" });
		const changed = vi.fn();
		let selected = request;
		const page = (mode: "visible" | "hidden") => (
			<Activity mode={mode}>{actions(kind, changed, selected)}</Activity>
		);
		const view = render(page("visible"));
		openConfirmation(kind);
		const form = screen.getByRole("button", { name: submitName(kind) }).closest("form");
		if (!form) throw new Error("Decision form missing");
		act(() => {
			const submission = new Event("submit", { bubbles: true, cancelable: true });
			fireEvent(form, submission);
			expect(submission.defaultPrevented).toBe(true);
			expect(action).not.toHaveBeenCalled();
			if (retirement === "Activity") {
				flushSync(() => view.rerender(page("hidden")));
				flushSync(() => view.rerender(page("visible")));
			} else {
				selected = { ...request, version: 4 };
				flushSync(() => view.rerender(page("visible")));
			}
		});
		await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
		expect(action).not.toHaveBeenCalled();
		expect(changed).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: submitName(kind) }));
		await waitFor(() => expect(action).toHaveBeenCalledOnce());
		expect(action).toHaveBeenCalledWith({
			requestId: request.id,
			reason,
			expectedVersion: selected.version,
		});
	},
);

it.each<Decision>(["return", "cancel"])(
	"suppresses a retired %s decision's late feedback",
	async (kind) => {
		const action = actionFor(kind);
		let finish!: (result: Awaited<ReturnType<typeof returnDocumentRequestAction>>) => void;
		vi.mocked(action).mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const changed = vi.fn();
		const view = render(actions(kind, changed));
		openConfirmation(kind);
		fireEvent.click(screen.getByRole("button", { name: submitName(kind) }));
		await waitFor(() => expect(action).toHaveBeenCalledOnce());
		view.unmount();
		await act(async () => finish({ success: true, data: request }));
		expect(changed).not.toHaveBeenCalled();
		expect(toast.success).not.toHaveBeenCalled();
	},
);

it.each<Decision>(["return", "cancel"])(
	"keeps the %s reason retryable after invalid input, transport failure and conflict",
	async (kind) => {
		const action = actionFor(kind);
		vi.mocked(action)
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce({ success: false, error: "Changed", code: "conflict" })
			.mockResolvedValue({ success: true, data: request });
		const changed = vi.fn();
		render(actions(kind, changed));
		openConfirmation(kind);
		const input = screen.getByRole("textbox", { name: /Reason/ });
		if (!(input instanceof HTMLTextAreaElement)) throw new Error("Reason field missing");
		const submit = () => screen.getByRole("button", { name: submitName(kind) });
		fireEvent.change(input, { target: { value: "   " } });
		fireEvent.click(submit());
		expect(await screen.findByText("Enter a reason.")).toBeTruthy();
		expect(action).not.toHaveBeenCalled();
		fireEvent.change(input, { target: { value: reason } });
		await waitFor(() => expect(submit().hasAttribute("disabled")).toBe(false));
		fireEvent.click(submit());
		expect((await screen.findByRole("alert")).textContent).toContain("Your reason is kept");
		expect(input.value).toBe(reason);
		expect(changed).not.toHaveBeenCalled();
		await waitFor(() => expect(submit().hasAttribute("disabled")).toBe(false));
		fireEvent.click(submit());
		await waitFor(() => expect(changed).toHaveBeenCalledOnce());
		expect(screen.getByRole("alert").textContent).toContain("Someone else changed this request");
		expect(input.value).toBe(reason);
		expect(toast.success).not.toHaveBeenCalled();
		await waitFor(() => expect(submit().hasAttribute("disabled")).toBe(false));
		fireEvent.click(submit());
		await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
		expect(action).toHaveBeenCalledTimes(3);
		expect(toast.success).toHaveBeenCalledOnce();
		expect(screen.queryByRole("alertdialog")).toBeNull();
	},
);
