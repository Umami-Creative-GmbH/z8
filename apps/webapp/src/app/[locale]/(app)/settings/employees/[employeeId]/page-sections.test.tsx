/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeDetail } from "@/lib/query/use-employee";
import { EmployeeEditFormCard, EmployeeOverviewCard } from "./page-sections";
import { focusFirstInvalidEmployeeDetailField } from "./page-utils";

const userAvatarMock = vi.hoisted(() =>
	vi.fn(({ name }: { name?: string | null }) => (
		<div data-testid="user-avatar" data-name={name ?? ""} />
	)),
);

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: userAvatarMock,
}));

vi.mock("@/lib/query", () => ({
	useEmployeeClockStatuses: () => ({ getStatus: () => "unknown" }),
}));

global.ResizeObserver = class ResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
};

const translations = new Map([
	["settings.employees.detailView.employeeInformation", "Mitarbeiterinformationen"],
	["settings.employees.detailView.team", "Team"],
	["settings.employees.detailView.status", "Status"],
	["settings.employees.detailView.statusActive", "Aktiv"],
	["settings.employees.detailView.workSchedule", "Arbeitszeitmodell"],
	["settings.employees.detailView.assignedVia", "Zugewiesen über: {source}"],
	["settings.employees.detailView.editTitle", "Mitarbeiter bearbeiten"],
	["settings.employees.detailView.editDescription", "Freigegebene Mitarbeiterdaten aktualisieren"],
	["settings.employees.detailView.gender", "Geschlecht"],
	["settings.employees.detailView.genderMale", "Männlich"],
	["settings.employees.detailView.pronouns", "Pronomen"],
	["settings.employees.detailView.pronounsPlaceholder", "Pronomen auswählen"],
	["settings.employees.detailView.pronounsCustom", "Eigene Pronomen"],
	["settings.employees.detailView.pronounsCustomPlaceholder", "Pronomen eingeben"],
	["settings.employees.detailView.position", "Position"],
	["settings.employees.detailView.positionPlaceholder", "Position eingeben"],
	["settings.employees.detailView.positionDescription", "Stellenbezeichnung oder Rolle"],
	["settings.employees.detailView.employeeNumber", "Personalnummer"],
	["settings.employees.detailView.employeeNumberPlaceholder", "z. B. EMP-001"],
	[
		"settings.employees.detailView.employeeNumberDescription",
		"Externe ID im Lohnabrechnungssystem",
	],
	["settings.employees.detailView.startDate", "Startdatum"],
	[
		"settings.employees.detailView.startDateDescription",
		"Arbeitszeitsaldo wird ab diesem Datum verfolgt",
	],
	["settings.employees.detailView.systemRole", "Systemrolle"],
	["settings.employees.detailView.systemRoleDescription", "Legt die Zugriffsebene im System fest"],
	["settings.employees.detailView.roleAdmin", "Admin"],
	["settings.employees.detailView.roleAdminDescription", "Voller Systemzugriff"],
	["settings.employees.detailView.roleManager", "Manager"],
	["settings.employees.detailView.roleManagerDescription", "Teamübersicht"],
	["settings.employees.detailView.roleEmployee", "Mitarbeiter"],
	["settings.employees.detailView.roleEmployeeDescription", "Standardzugriff"],
	["settings.employees.detailView.contractType", "Vertragsart"],
	[
		"settings.employees.detailView.contractTypeDescription",
		"Legt fest, wie die Vergütung berechnet wird",
	],
	["settings.employees.detailView.contractFixed", "Festgehalt"],
	["settings.employees.detailView.contractFixedDescription", "Vergütung auf Gehaltsbasis"],
	["settings.employees.detailView.contractHourly", "Stundenlohn"],
	["settings.employees.detailView.contractHourlyDescription", "Bezahlung nach geleisteten Stunden"],
	["settings.employees.detailView.appAccessPermissions", "App-Zugriffsberechtigungen"],
	[
		"settings.employees.detailView.appAccessDescription",
		"Steuern Sie, auf welche Anwendungen dieser Mitarbeiter zugreifen kann",
	],
	["settings.employees.detailView.webApplication", "Webanwendung"],
	[
		"settings.employees.detailView.webApplicationDescription",
		"Zugriff auf die browserbasierte Anwendung",
	],
	["settings.employees.detailView.desktopApplication", "Desktop-Anwendung"],
	[
		"settings.employees.detailView.desktopApplicationDescription",
		"Zugriff auf die Desktop-App zur Zeiterfassung",
	],
	["settings.employees.detailView.mobileApplication", "Mobile Anwendung"],
	[
		"settings.employees.detailView.mobileApplicationDescription",
		"Zugriff auf mobile Apps zur Zeiterfassung",
	],
	["settings.employees.detailView.cancel", "Abbrechen"],
	["settings.employees.detailView.saveChanges", "Änderungen speichern"],
]);

const t = (key: string, defaultValue: string, values?: Record<string, string | number>) => {
	let value = translations.get(key) ?? defaultValue;
	for (const [name, replacement] of Object.entries(values ?? {})) {
		value = value.replace(`{${name}}`, String(replacement));
	}
	return value;
};

const employee = {
	id: "employee-1",
	organizationId: "org-1",
	employeeNumber: "EMP-001",
	pronouns: "he/him",
	isActive: true,
	team: { id: "team-1", name: "Umami" },
	managers: [],
	user: {
		id: "user-1",
		firstName: "Johannes",
		lastName: "Glier",
		name: "Johannes Glier",
		email: "johannes@umami-creative.de",
		image: null,
	},
} as EmployeeDetail;

const formValues = {
	gender: "male",
	pronouns: "he/him",
	position: "",
	employeeNumber: "EMP-001",
	startDate: "2024-05-01",
	role: "employee",
	contractType: "fixed",
	hourlyRate: "",
	canUseWebapp: true,
	canUseDesktop: true,
	canUseMobile: true,
};

function createForm(overrides: Partial<typeof formValues> = {}) {
	const values = { ...formValues, ...overrides };

	return {
		handleSubmit: vi.fn(),
		Field: ({
			name,
			children,
			validators,
		}: {
			name: keyof typeof values;
			children: (field: unknown) => React.ReactNode;
			validators?: {
				onSubmit?: (props: { value: string }) => string | undefined;
			};
		}) => {
			const error = validators?.onSubmit?.({ value: String(values[name] ?? "") });

			return children({
				name,
				state: { value: values[name], meta: { errors: error ? [error] : [] } },
				handleChange: vi.fn(),
				handleBlur: vi.fn(),
			});
		},
		Subscribe: ({
			selector,
			children,
		}: {
			selector: (state: {
				values: typeof values;
				isDirty: boolean;
				isSubmitting: boolean;
			}) => unknown;
			children: (value: unknown) => React.ReactNode;
		}) => children(selector({ values, isDirty: false, isSubmitting: false })),
	};
}

describe("employee detail page sections", () => {
	beforeEach(() => {
		userAvatarMock.mockClear();
	});

	it("renders the detail view strings in German", () => {
		render(
			<EmployeeOverviewCard
				employee={employee}
				schedule={{
					policyName: "Vollzeit",
					hoursPerCycle: 40,
					scheduleCycle: "weekly",
					homeOfficeDaysPerCycle: 1,
					assignedVia: "Organisationsstandard",
				}}
				t={t}
			/>,
		);

		expect(screen.getByText("Mitarbeiterinformationen")).toBeTruthy();
		const displayName = screen.getByText("Johannes Glier (he/him)");
		expect(displayName).toBeTruthy();
		expect(displayName.className).toContain("truncate");
		expect(displayName.parentElement?.className).toContain("min-w-0");
		expect(screen.getByText("Aktiv")).toBeTruthy();
		expect(screen.getByText("Arbeitszeitmodell")).toBeTruthy();
		expect(screen.queryByText("Employee Information")).toBeNull();
		expect(screen.queryByText("Work Schedule")).toBeNull();
	});

	it("renders the overview name and avatar name from auth structured user fields", () => {
		const employeeWithStaleRootName = {
			...employee,
			firstName: "Stale",
			lastName: "Employee",
			user: {
				...employee.user,
				firstName: "Auth",
				lastName: "Source",
				name: "Fallback Person",
			},
		} as EmployeeDetail;

		render(<EmployeeOverviewCard employee={employeeWithStaleRootName} schedule={null} t={t} />);

		expect(screen.getByText("Auth Source (he/him)")).toBeTruthy();
		expect(screen.queryByText("Stale Employee")).toBeNull();
		expect(screen.queryByText("Fallback Person")).toBeNull();
		expect(userAvatarMock).toHaveBeenCalledWith(
			expect.objectContaining({ name: "Auth Source (he/him)" }),
			undefined,
		);
		expect(screen.getByTestId("user-avatar").getAttribute("data-name")).toBe(
			"Auth Source (he/him)",
		);
	});

	it("renders manager names from auth structured user fields", () => {
		const employeeWithManager = {
			...employee,
			managers: [
				{
					id: "manager-relation-1",
					isPrimary: true,
					manager: {
						id: "manager-1",
						userId: "manager-user-1",
						firstName: "Stale",
						lastName: "Manager",
						user: {
							id: "manager-user-1",
							firstName: "Auth",
							lastName: "Manager",
							name: "Fallback Manager",
							email: "manager@umami-creative.de",
							image: null,
						},
					},
				},
			],
		} as EmployeeDetail;

		render(<EmployeeOverviewCard employee={employeeWithManager} schedule={null} t={t} />);

		expect(screen.getByText("Auth Manager")).toBeTruthy();
		expect(screen.queryByText("Stale Manager")).toBeNull();
		expect(screen.queryByText("Fallback Manager")).toBeNull();
	});

	it("preserves the user display name when pronouns are absent", () => {
		render(
			<EmployeeOverviewCard
				employee={{
					...employee,
					firstName: "Stale",
					lastName: "Employee",
					pronouns: null,
					user: { ...employee.user, firstName: "Auth", lastName: "Source", name: "Jo Glier" },
				}}
				schedule={null}
				t={t}
			/>,
		);

		expect(screen.getByText("Auth Source")).toBeTruthy();
		expect(screen.queryByText("Stale Employee")).toBeNull();
	});

	it("labels draft overview records and shows invitation status", () => {
		render(
			<EmployeeOverviewCard
				employee={
					{
						kind: "invitationDraft",
						id: "draft-1",
						user: {
							id: "draft-1",
							name: "Ada Lovelace",
							email: "ada@example.com",
							image: null,
							firstName: "Ada",
							lastName: "Lovelace",
						},
						team: null,
						role: "manager",
						pronouns: null,
						isActive: false,
						invitationStatus: "pending",
						realEmployeeId: null,
					} as EmployeeDetail
				}
				schedule={null}
			/>,
		);
		expect(screen.getByText("Draft")).toBeTruthy();
		expect(screen.getByText("pending")).toBeTruthy();
	});

	it("links accepted drafts to the active employee record", () => {
		render(
			<EmployeeOverviewCard
				employee={
					{
						kind: "invitationDraft",
						id: "draft-1",
						user: {
							id: "draft-1",
							name: "Ada Lovelace",
							email: "ada@example.com",
							image: null,
							firstName: "Ada",
							lastName: "Lovelace",
						},
						team: null,
						role: "manager",
						pronouns: null,
						isActive: false,
						invitationStatus: "accepted",
						realEmployeeId: "employee-1",
					} as EmployeeDetail
				}
				schedule={null}
			/>,
		);
		expect(screen.getByRole("link", { name: "Edit active employee" }).getAttribute("href")).toBe(
			"/settings/employees/employee-1",
		);
	});

	it("guards real-employee-only sections behind the draft check", () => {
		const source = readFileSync(
			join(
				process.cwd(),
				"src/app/[locale]/(app)/settings/employees/[employeeId]/employee-detail-page-client.tsx",
			),
			"utf8",
		);
		expect(source).toContain("canShowRealEmployeeSections");
		expect(source).toContain("!isDraft");
		expect(source).toContain("canEditDraftDetails");
		expect(source).toContain("!employee.realEmployeeId");
	});

	it("renders the edit form strings in German", () => {
		render(
			<EmployeeEditFormCard
				form={createForm() as never}
				canEditManagerFields={true}
				canEditOrgAdminFields={true}
				isUpdating={false}
				onCancel={vi.fn()}
				t={t}
			/>,
		);

		expect(screen.getByText("Mitarbeiter bearbeiten")).toBeTruthy();
		expect(screen.getByText("Freigegebene Mitarbeiterdaten aktualisieren")).toBeTruthy();
		expect(screen.queryByText("Vorname")).toBeNull();
		expect(screen.queryByText("Nachname")).toBeNull();
		expect(screen.getByText("Pronomen")).toBeTruthy();
		expect(screen.getByDisplayValue("he/him")).toBeTruthy();
		expect(screen.getByText("Systemrolle")).toBeTruthy();
		expect(screen.getByText("Standardzugriff")).toBeTruthy();
		expect(screen.getByText("Vertragsart")).toBeTruthy();
		expect(screen.getByText("Festgehalt")).toBeTruthy();
		expect(screen.getByText("App-Zugriffsberechtigungen")).toBeTruthy();
		expect(screen.getByText("Änderungen speichern")).toBeTruthy();
		expect(screen.queryByText("Edit Employee")).toBeNull();
		expect(screen.queryByText("System Role")).toBeNull();
		expect(screen.queryByText("Contract Type")).toBeNull();
	});

	it("renders the start date field in the edit form", () => {
		render(
			<EmployeeEditFormCard
				form={createForm() as never}
				canEditManagerFields={true}
				canEditOrgAdminFields={true}
				isUpdating={false}
				onCancel={vi.fn()}
				t={t}
			/>,
		);

		const startDateInput = screen.getByLabelText("Startdatum");

		expect(startDateInput.getAttribute("type")).toBe("date");
		expect(startDateInput.getAttribute("name")).toBe("startDate");
		expect(startDateInput.getAttribute("autocomplete")).toBe("off");
		expect((startDateInput as HTMLInputElement).value).toBe("2024-05-01");
		expect(screen.getByText("Arbeitszeitsaldo wird ab diesem Datum verfolgt")).toBeTruthy();
	});

	it("shows an inline error when employee pronouns are longer than 50 characters", () => {
		render(
			<EmployeeEditFormCard
				form={createForm({ pronouns: "x".repeat(51) }) as never}
				canEditManagerFields={true}
				canEditOrgAdminFields={true}
				isUpdating={false}
				onCancel={vi.fn()}
				t={t}
			/>,
		);

		expect(screen.getByText("Pronouns must be 50 characters or less")).toBeTruthy();
	});

	it("uses an example-style custom pronouns placeholder by default", () => {
		render(
			<EmployeeEditFormCard
				form={createForm({ pronouns: "xe/xem" }) as never}
				canEditManagerFields={true}
				canEditOrgAdminFields={true}
				isUpdating={false}
				onCancel={vi.fn()}
			/>,
		);

		expect(screen.getByLabelText("Custom pronouns").getAttribute("placeholder")).toBe(
			"e.g., xe/xem…",
		);
		expect(screen.getByLabelText("Custom pronouns").getAttribute("name")).toBe("pronouns");
	});

	it("focuses custom pronouns when it is the first invalid employee detail field", () => {
		render(<input aria-label="Custom pronouns" name="pronouns" />);
		const pronounsInput = screen.getByLabelText("Custom pronouns");

		focusFirstInvalidEmployeeDetailField({
			getFieldMeta: (fieldName: string) => ({
				errors: fieldName === "pronouns" ? ["Pronouns must be 50 characters or less"] : [],
			}),
		} as never);

		expect(document.activeElement).toBe(pronounsInput);
	});
});
