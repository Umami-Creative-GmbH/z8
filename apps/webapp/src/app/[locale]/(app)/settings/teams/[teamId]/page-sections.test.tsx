/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	AddMemberDialog,
	DeleteTeamDialog,
	RemoveMemberDialog,
	TeamInfoCard,
	TeamMembersCard,
} from "./page-sections";

vi.mock("@/navigation", () => ({
	Link: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string) => translations[key] ?? fallback,
	}),
}));

vi.mock("@/components/ui/action-panel", () => ({
	ActionPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ActionPanelBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ActionPanelContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ActionPanelDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	ActionPanelFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ActionPanelHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	ActionPanelTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
	AlertDialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	AlertDialogAction: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	AlertDialogCancel: ({ children }: { children: ReactNode }) => (
		<button type="button">{children}</button>
	),
	AlertDialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	AlertDialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
	AlertDialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	AlertDialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	AlertDialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/badge", () => ({
	Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
	Button: ({
		asChild,
		children,
		...props
	}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) => {
		if (asChild && isValidElement(children)) {
			return cloneElement(children as ReactElement, props);
		}

		return <button {...props}>{children}</button>;
	},
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

vi.mock("@/components/ui/label", () => ({
	Label: ({ children, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) => (
		<label {...props}>{children}</label>
	),
}));

vi.mock("@/components/ui/select", () => ({
	Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
	SelectTrigger: ({
		children,
		...props
	}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) => (
		<button type="button" {...props}>
			{children}
		</button>
	),
	SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

vi.mock("@/components/ui/separator", () => ({
	Separator: () => <hr />,
}));

vi.mock("@/components/ui/textarea", () => ({
	Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

vi.mock("@/components/user-avatar", () => ({
	UserAvatar: () => <div data-testid="user-avatar" />,
}));

const translations: Record<string, string> = {
	"settings.teams.detail.info.title": "Teaminformationen",
	"settings.teams.detail.info.teamName": "Teamname",
	"settings.teams.detail.info.description": "Beschreibung",
	"settings.teams.detail.info.members": "Mitglieder",
	"settings.teams.detail.actions.edit": "Bearbeiten",
	"settings.teams.detail.members.title": "Teammitglieder",
	"settings.teams.detail.members.description": "Mitarbeitende, die diesem Team zugewiesen sind",
	"settings.teams.detail.members.add": "Mitglied hinzufügen",
	"settings.teams.detail.members.empty": "Keine Mitglieder in diesem Team",
	"settings.teams.detail.addMember.title": "Teammitglied hinzufügen",
	"settings.teams.detail.addMember.description":
		"Wählen Sie eine Person aus, die diesem Team hinzugefügt werden soll",
	"settings.teams.detail.selectEmployee": "Mitarbeitende auswählen",
	"settings.teams.detail.addMember.selectEmployee": "Mitarbeitende auswählen",
	"settings.teams.detail.actions.cancel": "Abbrechen",
	"settings.teams.detail.removeMember.title": "Teammitglied entfernen",
	"settings.teams.detail.removeMember.description":
		"Möchten Sie diese Person wirklich aus dem Team entfernen? Sie behält weiterhin Zugriff auf die Organisation.",
	"settings.teams.detail.removeMember.confirm": "Entfernen",
	"settings.teams.detail.delete.title": "Team löschen",
	"settings.teams.detail.delete.description":
		"Möchten Sie dieses Team wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden. Teammitglieder werden nicht gelöscht.",
};

const team = {
	id: "team-1",
	name: "Operations",
	description: "Handles daily operations",
	employees: [],
};

const form = {
	Field: ({ children }: { children: (field: unknown) => ReactNode }) =>
		children({
			state: { value: "", meta: { errors: [] } },
			handleChange: vi.fn(),
			handleBlur: vi.fn(),
		}),
};

describe("team detail page sections", () => {
	it("associates editable team controls and member select with accessible labels", () => {
		render(
			<>
				<TeamInfoCard
					team={team}
					isEditing={true}
					canManageSettings={true}
					loading={false}
					form={form}
					onStartEdit={vi.fn()}
					onCancelEdit={vi.fn()}
					onSubmit={vi.fn()}
				/>
				<AddMemberDialog
					open={true}
					onOpenChange={vi.fn()}
					availableEmployees={[]}
					selectedEmployee=""
					onSelectedEmployeeChange={vi.fn()}
					onAddMember={vi.fn()}
					loading={false}
				/>
			</>,
		);

		expect(screen.getByLabelText("Teamname")).toBeInstanceOf(HTMLInputElement);
		expect(screen.getByLabelText("Beschreibung")).toBeInstanceOf(HTMLTextAreaElement);
		expect(screen.getByRole("button", { name: "Mitarbeitende auswählen" })).toBeTruthy();
	});

	it("renders translated German representative strings without English fallbacks", () => {
		render(
			<>
				<TeamInfoCard
					team={team}
					isEditing={false}
					canManageSettings={true}
					loading={false}
					form={form}
					onStartEdit={vi.fn()}
					onCancelEdit={vi.fn()}
					onSubmit={vi.fn()}
				/>
				<TeamMembersCard
					team={team}
					canManageMembers={true}
					onOpenAddMember={vi.fn()}
					onRemoveMember={vi.fn()}
				/>
				<AddMemberDialog
					open={true}
					onOpenChange={vi.fn()}
					availableEmployees={[]}
					selectedEmployee=""
					onSelectedEmployeeChange={vi.fn()}
					onAddMember={vi.fn()}
					loading={false}
				/>
				<RemoveMemberDialog
					open={true}
					onOpenChange={vi.fn()}
					onConfirm={vi.fn()}
					loading={false}
				/>
				<DeleteTeamDialog open={true} onOpenChange={vi.fn()} onConfirm={vi.fn()} loading={false} />
			</>,
		);

		expect(screen.getByRole("heading", { name: "Teaminformationen" })).toBeTruthy();
		expect(screen.getByText("Teamname")).toBeTruthy();
		expect(screen.getByText("Mitglieder")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Teammitglieder" })).toBeTruthy();
		expect(screen.getByText("Mitarbeitende, die diesem Team zugewiesen sind")).toBeTruthy();
		expect(screen.getByText("Keine Mitglieder in diesem Team")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Teammitglied hinzufügen" })).toBeTruthy();
		expect(screen.getAllByText("Mitarbeitende auswählen").length).toBeGreaterThan(0);
		expect(screen.getByRole("heading", { name: "Teammitglied entfernen" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Team löschen" })).toBeTruthy();

		expect(screen.queryByText("Team Information")).toBeNull();
		expect(screen.queryByText("Team Members")).toBeNull();
		expect(screen.queryByText("Employees assigned to this team")).toBeNull();
		expect(screen.queryByText("No members in this team")).toBeNull();
	});
});
