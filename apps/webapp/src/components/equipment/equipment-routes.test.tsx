import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ overview: vi.fn(), personal: vi.fn() }));
vi.mock("@/lib/organization/equipment/actions", () => ({
	getEquipmentOverview: api.overview,
	getMyEquipment: api.personal,
}));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("not_found");
	},
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/navigation", () => ({
	Link: ({ children, ...props }: React.ComponentProps<"a">) => (
		<a {...props}>{children}</a>
	),
}));
vi.mock("./equipment-workspace", () => ({
	EquipmentOverview: ({ filters }: { filters: unknown }) => (
		<p>Equipment overview {JSON.stringify(filters)}</p>
	),
	PersonalEquipment: () => <p>Own retained equipment history</p>,
}));

import OverviewPage from "@/app/[locale]/(app)/equipment/page";
import PersonalPage from "@/app/[locale]/(app)/my-equipment/page";

beforeEach(() => vi.clearAllMocks());
it("opens the overview through the authorized read with organization-safe URL filters", async () => {
	api.overview.mockResolvedValue({ success: true, data: {} });
	const page = OverviewPage({
		searchParams: Promise.resolve({
			former: "true",
			overdue: "true",
			holderId: "15370000-0000-4000-8000-000000000001",
		}),
	});
	const element = page.props.children;
	const html = renderToStaticMarkup(await element.type(element.props));
	expect(api.overview).toHaveBeenCalledWith({
		former: true,
		overdue: true,
		holderId: "15370000-0000-4000-8000-000000000001",
	});
	expect(html).toContain("Equipment overview");
});
it("refuses the staff route when its public read denies access", async () => {
	api.overview.mockResolvedValue({
		success: false,
		code: "AuthorizationError",
	});
	const element = OverviewPage({ searchParams: Promise.resolve({}) }).props
		.children;
	await expect(element.type(element.props)).rejects.toThrow("not_found");
});
it("opens the personal route through self-history only and refuses departed access", async () => {
	api.personal.mockResolvedValue({ success: true, data: {} });
	const element = PersonalPage().props.children;
	expect(renderToStaticMarkup(await element.type())).toContain(
		"Own retained equipment history",
	);
	expect(api.overview).not.toHaveBeenCalled();
	api.personal.mockResolvedValue({
		success: false,
		code: "AuthorizationError",
	});
	await expect(element.type()).rejects.toThrow("not_found");
});
