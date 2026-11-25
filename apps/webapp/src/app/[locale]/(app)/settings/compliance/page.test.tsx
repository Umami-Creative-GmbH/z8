import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComplianceExceptionsRedirect } from "./compliance-exceptions-redirect";
import ComplianceSettingsPage from "./page";

class RedirectSignal extends Error {
	constructor(readonly href: string) {
		super(`redirect:${href}`);
	}
}

const redirectWithLocale = vi.hoisted(() => vi.fn());
vi.mock("@/lib/navigation/locale-redirect", () => ({ redirectWithLocale }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

beforeEach(() => {
	redirectWithLocale.mockReset();
	redirectWithLocale.mockImplementation(async (href: string) => {
		throw new RedirectSignal(href);
	});
});

async function redirectOf(run: () => Promise<never>): Promise<string> {
	const outcome = await run().catch((error: unknown) => error);
	if (!(outcome instanceof RedirectSignal)) {
		throw new Error("Expected /settings/compliance to redirect");
	}
	return outcome.href;
}

describe("/settings/compliance (#1977)", () => {
	it("redirects to the Approval inbox's compliance exceptions", async () => {
		expect(await redirectOf(ComplianceExceptionsRedirect)).toBe(
			"/approvals/inbox?types=compliance_exception",
		);
	});

	it("mounts the redirect from the page entry", async () => {
		const redirect = ComplianceSettingsPage().props.children as ReactElement<
			object,
			() => Promise<never>
		>;

		expect(await redirectOf(() => redirect.type(redirect.props))).toBe(
			"/approvals/inbox?types=compliance_exception",
		);
	});
});
