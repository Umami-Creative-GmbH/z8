import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
	overview: vi.fn(),
	personal: vi.fn(),
	employee: vi.fn(),
	assignment: vi.fn(),
}));
vi.mock("@/lib/organization/equipment/actions", () => ({
	getEquipmentOverview: api.overview,
	getMyEquipment: api.personal,
	getEmployeeEquipment: api.employee,
	getEquipmentAssignment: api.assignment,
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
	EquipmentOverview: ({ query }: { query: unknown }) => (
		<p>Equipment overview {JSON.stringify(query)}</p>
	),
	PersonalEquipment: () => <p>Own retained equipment history</p>,
	EmployeeEquipment: ({ variant }: { variant: string }) => (
		<p>Scoped employee equipment {variant}</p>
	),
	EquipmentAssignmentDetail: ({ back }: { back: string }) => (
		<p>Assignment detail back={back}</p>
	),
}));

import AssignmentPage from "@/app/[locale]/(app)/equipment/assignments/[assignmentId]/page";
import EmployeePage from "@/app/[locale]/(app)/equipment/employees/[employeeId]/page";
import OverviewPage from "@/app/[locale]/(app)/equipment/page";
import PersonalPage from "@/app/[locale]/(app)/my-equipment/page";

/** The page's streamed content: the Suspense boundary's only child, rendered. */
async function content(page: { props: { children: React.ReactElement } }) {
	const element = page.props.children as React.ReactElement<object> & {
		type: (props: object) => Promise<React.ReactElement>;
	};
	return renderToStaticMarkup(await element.type(element.props));
}

const assignmentId = "15390000-0000-4000-8000-000000000030";
beforeEach(() => vi.clearAllMocks());

it("opens officer employee equipment through its independent read and refuses a revoked or out-of-scope direct route", async () => {
	api.employee.mockResolvedValue({ success: true, data: {} });
	const page = () =>
		EmployeePage({
			params: Promise.resolve({
				employeeId: "15390000-0000-4000-8000-000000000002",
			}),
		});
	expect(await content(page())).toContain("Scoped employee equipment page");
	expect(api.employee).toHaveBeenCalledWith(
		"15390000-0000-4000-8000-000000000002",
	);
	api.employee.mockResolvedValue({
		success: false,
		code: "AuthorizationError",
	});
	await expect(content(page())).rejects.toThrow("not_found");
});

it("reads the whole scope for the overview and hands the URL filters to the list", async () => {
	api.overview.mockResolvedValue({ success: true, data: {} });
	const html = await content(
		OverviewPage({
			searchParams: Promise.resolve({
				former: "true",
				overdue: "true",
				holderId: "15370000-0000-4000-8000-000000000001",
			}),
		}),
	);
	// The key figures cover the reader's whole scope; the filters narrow the list.
	expect(api.overview).toHaveBeenCalledWith({});
	expect(html).toContain("Equipment overview");
	expect(html).toContain(
		JSON.stringify({
			status: "overdue",
			holderId: "15370000-0000-4000-8000-000000000001",
			typeId: null,
			former: "only",
		}).replaceAll('"', "&quot;"),
	);
});

it("opens the overview on outstanding returns without parameters and refuses the staff route when its read denies access", async () => {
	api.overview.mockResolvedValue({ success: true, data: {} });
	expect(
		await content(OverviewPage({ searchParams: Promise.resolve({}) })),
	).toContain("&quot;status&quot;:&quot;outstanding&quot;");
	api.overview.mockResolvedValue({
		success: false,
		code: "AuthorizationError",
	});
	await expect(
		content(OverviewPage({ searchParams: Promise.resolve({}) })),
	).rejects.toThrow("not_found");
});

it("opens the personal route through self-history only and refuses departed access", async () => {
	api.personal.mockResolvedValue({ success: true, data: {} });
	const page = PersonalPage();
	const element = page.props.children as React.ReactElement & {
		type: () => Promise<React.ReactElement>;
	};
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

describe("assignment page", () => {
	const page = (back?: string) =>
		AssignmentPage({
			params: Promise.resolve({ assignmentId }),
			searchParams: Promise.resolve(back ? { back } : {}),
		});

	it("opens one assignment through its own read and keeps a safe way back", async () => {
		api.assignment.mockResolvedValue({ success: true, data: {} });
		expect(await content(page("/equipment?overdue=true"))).toContain(
			"Assignment detail back=/equipment?overdue=true",
		);
		expect(api.assignment).toHaveBeenCalledWith(assignmentId);
		expect(await content(page("https://evil.test/"))).toContain(
			"Assignment detail back=/equipment<",
		);
	});

	it.each([
		[
			"another organization's or an out-of-scope assignment",
			"AuthorizationError",
		],
		["equipment switched off", "AuthorizationError"],
		["an invalid reference", "ValidationError"],
	])("reads %s as not found", async (_case, code) => {
		api.assignment.mockResolvedValue({ success: false, code });
		await expect(content(page())).rejects.toThrow("not_found");
	});

	it("shows a load failure without pretending the assignment is missing", async () => {
		api.assignment.mockResolvedValue({ success: false, code: "DatabaseError" });
		expect(await content(page())).toContain("Equipment could not be loaded.");
	});
});
