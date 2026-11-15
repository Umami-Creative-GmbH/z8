// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";
import Page from "./page";

const boundary = vi.hoisted(() => ({ access: vi.fn() }));
vi.mock("@/lib/personnel-file/current-access", () => ({
	loadCurrentPersonnelFileAccess: boundary.access,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw Error("NOT_FOUND");
	},
}));
vi.mock("@/navigation", () => ({
	Link: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("@/components/personnel-file/due-for-deletion-list", () => ({
	DueForDeletionList: () => <div>Authorized retention review</div>,
}));
beforeEach(() => vi.clearAllMocks());

it("owns exactly one safe heading during the real route admission fallback", async () => {
	const fallback = Page().props.fallback;
	render(await fallback.type(fallback.props));
	expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
	expect(screen.getByRole("heading", { level: 1, name: "Due for deletion" })).toBeTruthy();
});
it("retains the explanation and personnel files destination before the review", async () => {
	boundary.access.mockResolvedValue({
		status: "resolved",
		access: {
			grants: [{ categories: new Set(["payslip"]), scope: { kind: "all" } }],
		},
	});
	const child = Page().props.children;
	render(await child.type(child.props));
	expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
	expect(screen.getByRole("link", { name: "Personnel Files" }).getAttribute("href")).toBe(
		"/personnel-files",
	);
	expect(screen.getByText(/They stay until you confirm/)).toBeTruthy();
});
it.each([
	{ status: "unavailable" },
	{ status: "unauthenticated" },
	{ status: "resolved", access: { grants: [] } },
])("preserves independent not-found admission for $status", async (access) => {
	boundary.access.mockResolvedValue(access);
	const child = Page().props.children;
	await expect(child.type(child.props)).rejects.toThrow("NOT_FOUND");
});
it("adopts only this route and preserves prior opt-ins and staged relatives", () => {
	expect(appPageOwnsHeading("/de/personnel-files/due-for-deletion")).toBe(true);
	expect(appPageOwnsHeading("/en/personnel-files/due-for-deletion/detail")).toBe(false);
	expect(appPageOwnsHeading("/en/personnel-files")).toBe(false);
	expect(appPageOwnsHeading("/en/personnel-files/requests")).toBe(false);
	expect(appPageOwnsHeading("/en/my-documents")).toBe(true);
});
