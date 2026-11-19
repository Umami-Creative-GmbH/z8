import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	requireUser: vi.fn(),
	own: vi.fn(),
	accessLog: vi.fn(),
}));
vi.mock("@/lib/auth-helpers", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("./actions", () => ({
	getOwnPositionCaptureAction: mocks.own,
	getOwnPositionStampAccessLogAction: mocks.accessLog,
}));
vi.mock("@/components/settings/position-stamps/own-position-stamps-panel", () => ({
	OwnPositionStampsPanel: () => <p>Position stamps panel loaded</p>,
}));
vi.mock("@/components/settings/settings-load-error", () => ({
	SettingsLoadError: ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
		<div role="alert">
			{message}
			<button type="button" data-retry={onRetry ? "custom" : "route-refresh"}>
				Retry
			</button>
		</div>
	),
}));

import PositionStampsPage from "./page";

async function content(page: ReturnType<typeof PositionStampsPage>) {
	return page.props.children.type();
}

const PROFILE_MESSAGE =
	"Position stamps are available once you have an employee profile in this organization.";

beforeEach(() => {
	vi.clearAllMocks();
	mocks.requireUser.mockResolvedValue({ user: { id: "user-1" } });
	mocks.accessLog.mockResolvedValue({ success: true, data: [] });
});

describe("Position stamps page", () => {
	it("renders the panel when the employee's capture data loads", async () => {
		mocks.own.mockResolvedValue({ success: true, data: {} });
		const html = renderToStaticMarkup(await content(PositionStampsPage()));
		expect(html).toContain("Position stamps panel loaded");
		expect(html).not.toContain(PROFILE_MESSAGE);
	});

	it("explains the employee profile prerequisite only for that refusal", async () => {
		mocks.own.mockResolvedValue({
			success: false,
			error: "An employee profile in this organization is required.",
			code: "ValidationError",
			refusal: "employee_profile_required",
		});
		const html = renderToStaticMarkup(await content(PositionStampsPage()));
		expect(html).toContain(PROFILE_MESSAGE);
		expect(html).not.toContain('role="alert"');
	});

	it("shows any other failure as a load error with an in-place retry", async () => {
		mocks.own.mockResolvedValue({
			success: false,
			error: "Database unavailable",
			code: "DatabaseError",
		});
		const html = renderToStaticMarkup(await content(PositionStampsPage()));
		expect(html).toContain("Your position stamp settings could not be loaded.");
		expect(html).toContain('data-retry="route-refresh"');
		expect(html).not.toContain(PROFILE_MESSAGE);
	});
});
