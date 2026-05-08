/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { EmployeeDetail } from "@/lib/query/use-employee";
import { EmployeeDetailHeader, EmployeeEditFormCard, EmployeeOverviewCard } from "./page-sections";

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({
		asChild,
		children,
		className,
		...props
	}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => {
		if (asChild && isValidElement(children)) {
			const child = children as ReactElement<{ className?: string }>;
			return cloneElement(child, {
				...props,
				className: [child.props.className, className].filter(Boolean).join(" ") || undefined,
			});
		}

		return (
			<button className={className} {...props}>
				{children}
			</button>
		);
	},
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
	CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/input", () => ({
	Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({ children }: { children: ReactNode }) => (
		<button type="button">{children}</button>
	),
	SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

vi.mock("@/components/ui/separator", () => ({
	Separator: () => <hr />,
}));

vi.mock("@/components/ui/switch", () => ({
	Switch: (props: React.ButtonHTMLAttributes<HTMLButtonElement> & { checked?: boolean }) => (
		<button
			type="button"
			role="switch"
			aria-checked={props.checked}
			aria-label={props["aria-label"]}
		/>
	),
}));

vi.mock("@/components/ui/tanstack-form", () => ({
	fieldHasError: () => false,
	TFormControl: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	TFormDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	TFormItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	TFormLabel: ({ children }: { children: ReactNode }) => <label>{children}</label>,
	TFormMessage: () => null,
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: () => <div data-testid="user-avatar" />,
}));

const translations: Record<string, string> = {
	"settings.employees.details.backToList": "Zurück zur Mitarbeitendenliste",
	"settings.employees.details.title": "Mitarbeitendendetails",
	"settings.employees.details.description": "Mitarbeitendeninformationen ansehen und bearbeiten",
	"settings.employees.details.overview.title": "Mitarbeitendeninformationen",
	"settings.employees.details.overview.team": "Team",
	"settings.employees.details.overview.status": "Status",
	"settings.employees.details.overview.status.active": "Aktiv",
	"settings.employees.details.overview.employeeNumber": "Mitarbeitendennummer",
	"settings.employees.details.overview.managers": "Führungskräfte",
	"settings.employees.details.overview.primaryManager": "Primär",
	"settings.employees.details.overview.workSchedule": "Arbeitsplan",
	"settings.employees.details.overview.assignedVia": "Zugewiesen über",
	"settings.employees.details.form.title": "Mitarbeitende bearbeiten",
	"settings.employees.details.form.description.edit":
		"Freigegebene Mitarbeitendendetails aktualisieren",
	"settings.employees.details.form.firstName": "Vorname",
	"settings.employees.details.form.firstNamePlaceholder": "Vorname eingeben",
	"settings.employees.details.form.lastName": "Nachname",
	"settings.employees.details.form.lastNamePlaceholder": "Nachname eingeben",
	"settings.employees.details.form.gender": "Geschlecht",
	"settings.employees.details.form.genderPlaceholder": "Geschlecht auswählen",
	"settings.employees.details.form.gender.male": "Männlich",
	"settings.employees.details.form.gender.female": "Weiblich",
	"settings.employees.details.form.gender.other": "Divers",
	"settings.employees.details.form.position": "Position",
	"settings.employees.details.form.positionPlaceholder": "Position eingeben",
	"settings.employees.details.form.positionDescription": "Stellenbezeichnung oder Rolle",
	"settings.employees.details.form.employeeNumber": "Mitarbeitendennummer",
	"settings.employees.details.form.employeeNumberPlaceholder": "z. B. EMP-001",
	"settings.employees.details.form.employeeNumberDescription": "Externe ID im Lohnsystem",
	"settings.employees.details.form.role": "Systemrolle",
	"settings.employees.details.form.roleDescription": "Legt die Zugriffsebene im System fest",
	"settings.employees.details.form.role.admin": "Admin",
	"settings.employees.details.form.role.adminDescription": "Voller Systemzugriff",
	"settings.employees.details.form.role.manager": "Manager",
	"settings.employees.details.form.role.managerDescription": "Teamübersicht",
	"settings.employees.details.form.role.employee": "Mitarbeitende",
	"settings.employees.details.form.role.employeeDescription": "Standardzugriff",
	"settings.employees.details.form.contractType": "Vertragsart",
	"settings.employees.details.form.contractTypeDescription":
		"Legt fest, wie Vergütung berechnet wird",
	"settings.employees.details.form.contractType.fixed": "Fest",
	"settings.employees.details.form.contractType.fixedDescription": "Gehaltsbasierte Vergütung",
	"settings.employees.details.form.contractType.hourly": "Stündlich",
	"settings.employees.details.form.contractType.hourlyDescription":
		"Nach geleisteten Stunden bezahlt",
	"settings.employees.details.form.appAccess.title": "App-Zugriffsberechtigungen",
	"settings.employees.details.form.appAccess.description":
		"Steuert, auf welche Anwendungen diese Person zugreifen kann",
	"settings.employees.details.form.appAccess.web": "Webanwendung",
	"settings.employees.details.form.appAccess.webDescription":
		"Zugriff auf die browserbasierte Anwendung",
	"settings.employees.details.form.appAccess.webAriaLabel": "Webanwendungszugriff umschalten",
	"settings.employees.details.form.cancel": "Abbrechen",
	"settings.employees.details.form.save": "Änderungen speichern",
};

const t = (key: string, defaultValue: string) => translations[key] ?? defaultValue;

const employee = {
	id: "employee-1",
	organizationId: "org-1",
	user: {
		id: "user-1",
		name: "Ada Lovelace",
		email: "ada@example.com",
		image: null,
	},
	team: { name: "Operations" },
	isActive: true,
	employeeNumber: "EMP-001",
	managers: [
		{
			id: "manager-link-1",
			isPrimary: true,
			manager: { user: { name: "Grace Hopper" } },
		},
	],
} as EmployeeDetail;

function createForm() {
	const values: Record<string, unknown> = {
		firstName: "Ada",
		lastName: "Lovelace",
		gender: "female",
		position: "Engineer",
		employeeNumber: "EMP-001",
		role: "employee",
		contractType: "fixed",
		canUseWebapp: true,
		canUseDesktop: true,
		canUseMobile: true,
	};

	return {
		handleSubmit: vi.fn(),
		Field: ({ name, children }: { name: string; children: (field: unknown) => ReactNode }) =>
			children({
				state: { value: values[name] },
				handleChange: vi.fn(),
				handleBlur: vi.fn(),
			}),
		Subscribe: ({
			selector,
			children,
		}: {
			selector: (state: unknown) => unknown;
			children: (value: unknown) => ReactNode;
		}) => children(selector({ values, isDirty: true, isSubmitting: false })),
	};
}

describe("employee detail page sections", () => {
	it("renders translated German representative strings without relying on message JSON", () => {
		render(
			<>
				<EmployeeDetailHeader t={t} />
				<EmployeeOverviewCard
					t={t}
					employee={employee}
					schedule={{ policyName: "Standard", assignedVia: "team", scheduleType: "simple" }}
				/>
				<EmployeeEditFormCard
					t={t}
					form={createForm()}
					canEditManagerFields={true}
					canEditOrgAdminFields={true}
					isUpdating={false}
					onCancel={vi.fn()}
				/>
			</>,
		);

		expect(screen.getByRole("heading", { name: "Mitarbeitendendetails", level: 1 })).toBeTruthy();
		expect(screen.getByRole("link", { name: "Zurück zur Mitarbeitendenliste" })).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Mitarbeitendeninformationen", level: 2 }),
		).toBeTruthy();
		expect(screen.getByText("Aktiv")).toBeTruthy();
		expect(screen.getByText("Zugewiesen über: team")).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Mitarbeitende bearbeiten", level: 2 }),
		).toBeTruthy();
		expect(screen.getByText("Vorname")).toBeTruthy();
		expect(screen.getByPlaceholderText("Vorname eingeben")).toBeTruthy();
		expect(screen.getByText("Voller Systemzugriff")).toBeTruthy();
		expect(screen.getByText("Gehaltsbasierte Vergütung")).toBeTruthy();
		expect(screen.getByText("App-Zugriffsberechtigungen")).toBeTruthy();
		expect(screen.getByRole("switch", { name: "Webanwendungszugriff umschalten" })).toBeTruthy();

		expect(screen.queryByText("Employee Details")).toBeNull();
		expect(screen.queryByText("Employee Information")).toBeNull();
		expect(screen.queryByText("Full system access")).toBeNull();
		expect(screen.queryByText("Salary-based compensation")).toBeNull();
		expect(screen.queryByText("App Access Permissions")).toBeNull();
	});
});
