/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { SelectableEmployee } from "../employees/actions";
import { PermissionsEmptyState, PermissionsTableCard } from "./page-sections";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string, params?: Record<string, string | number>) => {
			const value = translations[key] ?? fallback;

			return Object.entries(params ?? {}).reduce(
				(text, [paramKey, paramValue]) => text.replace(`{${paramKey}}`, String(paramValue)),
				value,
			);
		},
	}),
}));

vi.mock("@/components/errors/no-employee-error", () => ({
	NoEmployeeError: ({ feature }: { feature: string }) => <div>{feature}</div>,
}));

vi.mock("@/components/settings/permission-editor", () => ({
	PermissionEditor: () => <div>permission editor</div>,
}));

vi.mock("@/components/ui/action-panel", () => ({
	ActionPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ActionPanelBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ActionPanelContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ActionPanelHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ActionPanelTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
		<button {...props}>{children}</button>
	),
}));

vi.mock("@/components/ui/card", () => ({
	Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
	CardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	CardHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	CardTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/input", () => ({
	Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/ui/table", () => ({
	Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
	TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
	TableCell: ({ children }: { children: ReactNode }) => <td>{children}</td>,
	TableHead: ({ children }: { children: ReactNode }) => <th>{children}</th>,
	TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
	TableRow: ({ children }: { children: ReactNode }) => <tr>{children}</tr>,
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: () => <div data-testid="user-avatar" />,
}));

const translations: Record<string, string> = {
	"settings.permissions.adminRequired": "Adminzugriff erforderlich",
	"settings.permissions.employeePermissions.title": "Mitarbeitendenberechtigungen",
	"settings.permissions.employeePermissions.description":
		"Klicken Sie auf Mitarbeitende, um deren Berechtigungen zu bearbeiten",
	"settings.permissions.refresh": "Aktualisieren",
	"settings.permissions.searchPlaceholder": "Nach Name, E-Mail oder Position suchen...",
	"settings.permissions.table.employee": "Mitarbeitende",
	"settings.permissions.table.position": "Position",
	"settings.permissions.table.role": "Rolle",
	"settings.permissions.table.permissions": "Berechtigungen",
	"settings.permissions.table.actions": "Aktionen",
	"settings.permissions.badge.allPermissions": "Alle Berechtigungen",
	"settings.permissions.badge.permissionCount": "{count} Berechtigungen",
	"settings.permissions.noPermissions": "Keine Berechtigungen",
	"settings.permissions.actions.edit": "Bearbeiten",
};

const employees = [
	{
		id: "employee-1",
		role: "admin",
		position: "Operations Lead",
		user: { name: "Ada Lovelace", email: "ada@example.com", image: null },
	},
	{
		id: "employee-2",
		role: "employee",
		position: "Coordinator",
		user: { name: "Grace Hopper", email: "grace@example.com", image: null },
	},
] as SelectableEmployee[];

describe("permissions page sections", () => {
	it("renders translated German representative strings without English fallbacks", () => {
		render(
			<>
				<PermissionsEmptyState noEmployee={false} />
				<PermissionsTableCard
					loading={false}
					searchQuery=""
					onSearchChange={vi.fn()}
					onRefresh={vi.fn()}
					employees={employees}
					onEdit={vi.fn()}
					getSummary={(employeeId) =>
						employeeId === "employee-2" ? { count: 2, scope: "Team" } : null
					}
				/>
			</>,
		);

		expect(screen.getByText("Mitarbeitendenberechtigungen")).not.toBeNull();
		expect(screen.getByText("Adminzugriff erforderlich")).not.toBeNull();
		expect(screen.getByPlaceholderText("Nach Name, E-Mail oder Position suchen...")).not.toBeNull();
		expect(screen.getByText("Alle Berechtigungen")).not.toBeNull();
		expect(screen.getByText("2 Berechtigungen")).not.toBeNull();
		expect(screen.getByText("Bearbeiten")).not.toBeNull();
		expect(screen.queryByText("Employee Permissions")).toBeNull();
		expect(screen.queryByText("Admin access required")).toBeNull();
	});
});
