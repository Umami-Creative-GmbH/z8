/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";
import type { EmployeeDetail } from "@/lib/query/use-employee";
import { EmployeeEditFormCard, EmployeeOverviewCard } from "./page-sections";

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
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
	["settings.employees.detailView.firstName", "Vorname"],
	["settings.employees.detailView.lastName", "Nachname"],
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
		name: "Johannes Glier",
		email: "johannes@umami-creative.de",
		image: null,
	},
} as EmployeeDetail;

const formValues = {
	firstName: "Johannes",
	lastName: "Glier",
	gender: "male",
	pronouns: "he/him",
	position: "",
	employeeNumber: "EMP-001",
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
		expect(screen.getByText("Johannes Glier (he/him)")).toBeTruthy();
		expect(screen.getByText("Aktiv")).toBeTruthy();
		expect(screen.getByText("Arbeitszeitmodell")).toBeTruthy();
		expect(screen.queryByText("Employee Information")).toBeNull();
		expect(screen.queryByText("Work Schedule")).toBeNull();
	});

	it("preserves the user display name when pronouns are absent", () => {
		render(
			<EmployeeOverviewCard
				employee={{
					...employee,
					firstName: "Johannes",
					lastName: "Glier",
					pronouns: null,
					user: { ...employee.user, name: "Jo Glier" },
				}}
				schedule={null}
				t={t}
			/>,
		);

		expect(screen.getByText("Jo Glier")).toBeTruthy();
		expect(screen.queryByText("Johannes Glier")).toBeNull();
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
		expect(screen.getByText("Vorname")).toBeTruthy();
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
});
