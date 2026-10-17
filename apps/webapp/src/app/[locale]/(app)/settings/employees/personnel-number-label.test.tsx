/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ColumnDef } from "@tanstack/react-table";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EmployeeDetail } from "@/lib/query/use-employee";
import {
	EmployeeEditFormCard,
	EmployeeOverviewCard,
} from "./[employeeId]/page-sections";
import { createEmployeeColumns } from "./columns";
import type { EmployeeDirectoryRow } from "./employee-action-types";
import type { EmployeeTableFeatures } from "./employee-table-features";

type Locale = "en" | "de";
type Catalog = { [key: string]: string | Catalog };

const catalogs: Record<Locale, Catalog> = {
	en: readCatalog("en"),
	de: readCatalog("de"),
};

function readCatalog(locale: Locale): Catalog {
	return JSON.parse(
		readFileSync(
			join(process.cwd(), "messages/settings/people", `${locale}.json`),
			"utf8",
		),
	) as Catalog;
}

function lookup(catalog: Catalog, key: string): string | undefined {
	let node: string | Catalog | undefined = catalog;
	for (const part of key.split(".")) {
		if (node === undefined || typeof node === "string") return undefined;
		node = node[part];
	}
	return typeof node === "string" ? node : undefined;
}

function translatorFor(locale: Locale) {
	return (key: string, fallback?: string) =>
		lookup(catalogs[locale], key) ?? fallback ?? key;
}

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback?: string) => fallback ?? key,
	}),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: () => <span />,
}));

vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({ getStatus: () => "unknown" }),
}));

global.ResizeObserver = class ResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
};

const employee = {
	id: "employee-1",
	organizationId: "org-1",
	employeeNumber: "P-0042",
	pronouns: null,
	isActive: true,
	team: null,
	managers: [],
	user: {
		id: "user-1",
		firstName: "Ada",
		lastName: "Lovelace",
		name: "Ada Lovelace",
		email: "ada@example.com",
		image: null,
	},
} as EmployeeDetail;

const formValues = {
	gender: "",
	pronouns: "",
	position: "",
	employeeNumber: "P-0042",
	startDate: "2024-05-01",
	role: "employee",
	contractType: "fixed",
	hourlyRate: "",
};

function createForm() {
	return {
		handleSubmit: vi.fn(),
		Field: ({
			name,
			children,
		}: {
			name: keyof typeof formValues;
			children: (field: unknown) => React.ReactNode;
		}) =>
			children({
				name,
				state: { value: formValues[name], meta: { errors: [] } },
				handleChange: vi.fn(),
				handleBlur: vi.fn(),
			}),
		Subscribe: ({
			selector,
			children,
		}: {
			selector: (state: {
				values: typeof formValues;
				isDirty: boolean;
				isSubmitting: boolean;
			}) => unknown;
			children: (value: unknown) => React.ReactNode;
		}) =>
			children(
				selector({ values: formValues, isDirty: false, isSubmitting: false }),
			),
	};
}

const expected: Record<Locale, { label: string; description: string }> = {
	en: {
		label: "Personnel number",
		description:
			"Your organization's own number for this employee, used in payroll exports. It must be unique, including among former employees.",
	},
	de: {
		label: "Personalnummer",
		description:
			"Die organisationsinterne Nummer für diesen Mitarbeiter, die bei Lohnexporten verwendet wird. Sie muss eindeutig sein, auch gegenüber ehemaligen Mitarbeitern.",
	},
};

describe.each(["en", "de"] as const)("personnel number copy (%s)", (locale) => {
	afterEach(() => {
		cleanup();
	});

	it("labels the edit form field and explains the number", () => {
		render(
			<EmployeeEditFormCard
				form={createForm() as never}
				canEditManagerFields={true}
				canEditOrgAdminFields={true}
				contract={{ kind: "terms", contractTypeToday: "fixed" }}
				isUpdating={false}
				onCancel={vi.fn()}
				t={translatorFor(locale)}
			/>,
		);

		expect(screen.getByText(expected[locale].label)).toBeTruthy();
		expect(screen.getByText(expected[locale].description)).toBeTruthy();
	});

	it("shows an IdP-owned personnel number read-only with an explanation", () => {
		render(
			<EmployeeEditFormCard
				form={createForm() as never}
				canEditManagerFields
				canEditOrgAdminFields
				contract={{ kind: "terms", contractTypeToday: "fixed" }}
				isUpdating={false}
				onCancel={vi.fn()}
				personnelNumberManagedByScim
				t={translatorFor(locale)}
			/>,
		);
		expect(
			screen.getByDisplayValue("P-0042").getAttribute("readonly"),
		).not.toBeNull();
		expect(
			screen.getByText(
				locale === "en"
					? "Managed by your identity provider. Change the personnel number there."
					: "Wird von Ihrem Identitätsanbieter verwaltet. Ändern Sie die Personalnummer dort.",
			),
		).toBeTruthy();
	});
	it("labels the number on the overview card", () => {
		render(
			<EmployeeOverviewCard
				employee={employee}
				schedule={null}
				t={translatorFor(locale)}
			/>,
		);

		expect(screen.getByText(expected[locale].label)).toBeTruthy();
		expect(screen.getByText("P-0042")).toBeTruthy();
	});
});

describe("personnel number directory column", () => {
	it("reads the column header from the personnel number key", () => {
		const column = createEmployeeColumns({
			organizationId: "org-1",
			currentUserId: "user-1",
			currentMemberRole: "owner",
			onOptimisticStatusChange: vi.fn(),
			onRemoved: vi.fn(),
		}).find(
			(candidate) =>
				"accessorKey" in candidate &&
				candidate.accessorKey === "employeeNumber",
		) as ColumnDef<EmployeeTableFeatures, EmployeeDirectoryRow>;
		const header = column.header;
		if (typeof header !== "function")
			throw new Error("Header is not renderable");

		const element = header(
			{} as Parameters<typeof header>[0],
		) as React.ReactElement<{
			nameKey: string;
			fallback: string;
		}>;

		expect(element.props.fallback).toBe(expected.en.label);
		expect(lookup(catalogs.en, element.props.nameKey)).toBe(expected.en.label);
		expect(lookup(catalogs.de, element.props.nameKey)).toBe(expected.de.label);
	});
});
