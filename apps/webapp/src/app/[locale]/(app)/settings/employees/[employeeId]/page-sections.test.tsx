/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmployeeDetail } from "@/lib/query/use-employee";
import { EmployeeEditFormCard, EmployeeOverviewCard } from "./page-sections";

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

function createForm() {
	const values = {
		gender: "male",
		position: "",
		employeeNumber: "EMP-001",
		role: "employee",
		contractType: "fixed",
		hourlyRate: "",
		canUseWebapp: true,
		canUseDesktop: true,
		canUseMobile: true,
	};

	return {
		handleSubmit: vi.fn(),
		Field: ({
			name,
			children,
		}: {
			name: keyof typeof values;
			children: (field: unknown) => React.ReactNode;
		}) =>
			children({
				name,
				state: { value: values[name], meta: { errors: [] } },
				handleChange: vi.fn(),
				handleBlur: vi.fn(),
			}),
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

		expect(screen.getByText("Auth Source")).toBeTruthy();
		expect(screen.queryByText("Stale Employee")).toBeNull();
		expect(screen.queryByText("Fallback Person")).toBeNull();
		expect(userAvatarMock).toHaveBeenCalledWith(
			expect.objectContaining({ name: "Auth Source" }),
			undefined,
		);
		expect(screen.getByTestId("user-avatar").getAttribute("data-name")).toBe("Auth Source");
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
});
