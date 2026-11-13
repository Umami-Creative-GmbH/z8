import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	loadAccess: vi.fn(),
	logError: vi.fn(),
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/logger", () => ({ logger: { error: state.logError } }));
vi.mock("@/lib/personnel-file/current-access", () => ({
	loadCurrentPersonnelFileAccess: state.loadAccess,
}));
vi.mock("@/lib/personnel-file/document-store", () => ({}));
vi.mock("@/lib/personnel-file/notifications", () => ({}));
vi.mock("@/lib/personnel-file/panel", () => ({}));
vi.mock("@/lib/personnel-file/storage", () => ({}));
vi.mock("@/lib/personnel-file/upload-ledger", () => ({}));
vi.mock("@/lib/personnel-file/document-request-notifications", () => ({}));
vi.mock("@/lib/personnel-file/document-request-store", () => ({}));

const { getMyDocumentsAction } = await import("./actions");
const { getMyDocumentRequestsAction } = await import("./document-request-actions");

/**
 * What `connection()` rejects with once a prerender is complete. Next.js
 * recognizes it by its digest.
 */
function prerenderCompleteRejection() {
	return Object.assign(
		new Error("During prerendering, `connection()` rejects when the prerender is complete."),
		{ digest: "HANGING_PROMISE_REJECTION" },
	);
}

describe.each([
	["getMyDocumentsAction", getMyDocumentsAction],
	["getMyDocumentRequestsAction", getMyDocumentRequestsAction],
])("%s", (_name, action) => {
	beforeEach(() => {
		state.loadAccess.mockReset();
		state.logError.mockReset();
	});

	it("hands the prerender rejection back to Next.js instead of logging a failure", async () => {
		const rejection = prerenderCompleteRejection();
		state.loadAccess.mockRejectedValue(rejection);

		await expect(action()).rejects.toBe(rejection);
		expect(state.logError).not.toHaveBeenCalled();
	});

	it("still logs and reports an ordinary error", async () => {
		state.loadAccess.mockRejectedValue(new Error("database down"));

		await expect(action()).resolves.toMatchObject({ success: false });
		expect(state.logError).toHaveBeenCalledOnce();
	});
});
