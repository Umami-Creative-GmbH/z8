import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalsRedirect } from "./approvals-redirect";
import ApprovalsPage from "./page";

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

async function redirectedHref(
	searchParams: Record<string, string | string[] | undefined>,
): Promise<string> {
	const outcome = await ApprovalsRedirect({
		searchParams: Promise.resolve(searchParams),
	}).catch((error: unknown) => error);
	if (!(outcome instanceof RedirectSignal)) {
		throw new Error("Expected /approvals to redirect");
	}
	return outcome.href;
}

describe("/approvals", () => {
	it("redirects to the Approval inbox", async () => {
		expect(await redirectedHref({})).toBe("/approvals/inbox");
	});

	it("keeps every incoming query parameter, including repeated ones", async () => {
		const href = await redirectedHref({
			types: "absence_entry,time_entry",
			tag: ["first", "second"],
			empty: undefined,
		});

		const [path, query] = href.split("?");
		expect(path).toBe("/approvals/inbox");
		const params = new URLSearchParams(query);
		expect(params.get("types")).toBe("absence_entry,time_entry");
		expect(params.getAll("tag")).toEqual(["first", "second"]);
		expect(params.has("empty")).toBe(false);
	});

	it("mounts the redirect from the page entry, query included", async () => {
		const page = ApprovalsPage({ searchParams: Promise.resolve({ types: "time_entry" }) });
		const redirect = page.props.children as ReactElement<object, () => Promise<never>>;

		const outcome = await redirect.type(redirect.props).catch((error: unknown) => error);

		expect(outcome).toBeInstanceOf(RedirectSignal);
		expect((outcome as RedirectSignal).href).toBe("/approvals/inbox?types=time_entry");
	});

	it("shows nothing inbox-specific before the redirect", () => {
		const page = ApprovalsPage({ searchParams: new Promise(() => {}) });

		const fallback = renderToStaticMarkup(page.props.fallback as ReactElement);

		expect(fallback).toContain('aria-busy="true"');
		expect(fallback).not.toContain("Loading approval inbox");
		expect(fallback).not.toContain("approval-table-loading");
	});
});
