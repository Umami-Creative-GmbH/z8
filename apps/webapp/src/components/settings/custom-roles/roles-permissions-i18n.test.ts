import { describe, expect, it, vi } from "vitest";
import { loadCatalogSlice } from "@/tolgee/load-translations";
import { getNamespacesForRoute, TolgeeBase } from "@/tolgee/shared";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

const REQUIRED_KEYS: Array<{
	key: string;
	en: string;
	de: string;
	params?: Record<string, string | number>;
}> = [
	{
		key: "settings.roles.title",
		en: "Custom Roles",
		de: "Benutzerdefinierte Rollen",
	},
	{
		key: "settings.roles.introduction",
		en: "Create custom permission roles that can be assigned to employees. Custom roles add permissions on top of the base tier.",
		de: "Erstellen Sie benutzerdefinierte Berechtigungsrollen, die Mitarbeitern zugewiesen werden können. Benutzerdefinierte Rollen fügen Berechtigungen zur Basisebene hinzu.",
	},
	{
		key: "settings.roles.actions.create",
		en: "Create Role",
		de: "Rolle erstellen",
	},
	{
		key: "settings.roles.actions.refresh",
		en: "Refresh custom roles",
		de: "Benutzerdefinierte Rollen aktualisieren",
	},
	{
		key: "settings.permissions.title",
		en: "Team Permissions",
		de: "Teamberechtigungen",
	},
	{
		key: "settings.permissions.description",
		en: "Manage employee permissions for team operations",
		de: "Mitarbeiterberechtigungen für Teamvorgänge verwalten",
	},
	{
		key: "settings.permissions.employeePermissions.title",
		en: "Employee Permissions",
		de: "Mitarbeiterberechtigungen",
	},
	{
		key: "settings.permissions.employeePermissions.editHint",
		en: "Choose Edit next to an employee to change their team permissions.",
		de: "Wählen Sie neben einem Mitarbeiter „Bearbeiten“, um dessen Teamberechtigungen zu ändern.",
	},
	{
		key: "settings.permissions.refresh",
		en: "Refresh",
		de: "Aktualisieren",
	},
	{
		key: "settings.permissions.searchLabel",
		en: "Search employees",
		de: "Mitarbeiter suchen",
	},
	{
		key: "settings.permissions.searchPlaceholder",
		en: "Search by name, email, or position...",
		de: "Suche nach Name, E-Mail oder Position...",
	},
	{
		key: "settings.permissions.loading",
		en: "Loading employee permissions",
		de: "Mitarbeiterberechtigungen werden geladen",
	},
	{
		key: "settings.permissions.loadFailed",
		en: "Employee permissions could not be loaded.",
		de: "Mitarbeiterberechtigungen konnten nicht geladen werden.",
	},
	{
		key: "settings.permissions.emptyState",
		en: "No employees found",
		de: "Keine Mitarbeiter gefunden",
	},
	{
		key: "settings.permissions.table.employee",
		en: "Employee",
		de: "Mitarbeiter",
	},
	{
		key: "settings.permissions.table.position",
		en: "Position",
		de: "Position",
	},
	{
		key: "settings.permissions.table.role",
		en: "Role",
		de: "Rolle",
	},
	{
		key: "settings.permissions.table.permissions",
		en: "Permissions",
		de: "Berechtigungen",
	},
	{
		key: "settings.permissions.table.actions",
		en: "Actions",
		de: "Aktionen",
	},
	{
		key: "settings.permissions.roles.admin",
		en: "Admin",
		de: "Admin",
	},
	{
		key: "settings.permissions.roles.manager",
		en: "Manager",
		de: "Manager",
	},
	{
		key: "settings.permissions.roles.employee",
		en: "Employee",
		de: "Mitarbeiter",
	},
	{
		key: "settings.permissions.scope.team",
		en: "Team-specific",
		de: "Teamspezifisch",
	},
	{
		key: "settings.permissions.scope.organization",
		en: "Organization-wide",
		de: "Organisationsweit",
	},
	{
		key: "settings.permissions.badge.allPermissions",
		en: "All Permissions",
		de: "Alle Berechtigungen",
	},
	{
		key: "settings.permissions.badge.permissionCount",
		en: "2 permission(s)",
		de: "2 Berechtigung(en)",
		params: { count: 2 },
	},
	{
		key: "settings.permissions.noPermissions",
		en: "No permissions",
		de: "Keine Berechtigungen",
	},
	{
		key: "settings.permissions.actions.edit",
		en: "Edit",
		de: "Bearbeiten",
	},
	{
		key: "settings.permissions.actions.editNamed",
		en: "Edit permissions for Grace Hopper",
		de: "Berechtigungen für Grace Hopper bearbeiten",
		params: { name: "Grace Hopper" },
	},
	{
		key: "settings.permissions.editor.title",
		en: "Edit Permissions - Grace Hopper",
		de: "Berechtigungen bearbeiten - Grace Hopper",
		params: { name: "Grace Hopper" },
	},
	{
		key: "settings.permissions.editor.description",
		en: "Configure permissions for Grace Hopper. Admins automatically have all permissions.",
		de: "Berechtigungen für Grace Hopper konfigurieren. Administratoren haben automatisch alle Berechtigungen.",
		params: { employeeName: "Grace Hopper" },
	},
	{
		key: "settings.permissions.createTeams",
		en: "Create Teams",
		de: "Teams erstellen",
	},
	{
		key: "settings.permissions.createTeamsDescription",
		en: "Allow creating new teams within the organization",
		de: "Erstellen neuer Teams in der Organisation erlauben",
	},
	{
		key: "settings.permissions.manageTeamMembers",
		en: "Manage Team Members",
		de: "Teammitglieder verwalten",
	},
	{
		key: "settings.permissions.manageTeamMembersDescription",
		en: "Allow adding and removing team members",
		de: "Hinzufügen und Entfernen von Teammitgliedern erlauben",
	},
	{
		key: "settings.permissions.manageTeamSettings",
		en: "Manage Team Settings",
		de: "Teameinstellungen verwalten",
	},
	{
		key: "settings.permissions.manageTeamSettingsDescription",
		en: "Allow editing team information and settings",
		de: "Bearbeiten von Teaminformationen und -einstellungen erlauben",
	},
	{
		key: "settings.permissions.approveTeamRequests",
		en: "Approve Team Requests",
		de: "Teamanfragen genehmigen",
	},
	{
		key: "settings.permissions.approveTeamRequestsDescription",
		en: "Allow approving vacation and time-off requests",
		de: "Genehmigen von Urlaubs- und Abwesenheitsanträgen erlauben",
	},
	{
		key: "settings.permissions.scope",
		en: "Permission Scope",
		de: "Berechtigungsumfang",
	},
	{
		key: "settings.permissions.allTeams",
		en: "All Teams (Organization-wide)",
		de: "Alle Teams (organisationsweit)",
	},
	{
		key: "settings.permissions.allTeamsHelp",
		en: "Permissions apply to all teams in the organization",
		de: "Berechtigungen gelten für alle Teams in der Organisation",
	},
	{
		key: "settings.permissions.selectedTeamHelp",
		en: "Permissions apply only to the selected team",
		de: "Berechtigungen gelten nur für das ausgewählte Team",
	},
	{
		key: "settings.permissions.permissions",
		en: "Permissions",
		de: "Berechtigungen",
	},
	{
		key: "settings.permissions.revokeAll",
		en: "Revoke All",
		de: "Alle widerrufen",
	},
	{
		key: "settings.permissions.save",
		en: "Save Permissions",
		de: "Berechtigungen speichern",
	},
	{
		key: "settings.permissions.toast.loadEmployeesFailed",
		en: "Failed to load employees",
		de: "Laden der Mitarbeiter fehlgeschlagen",
	},
	{
		key: "settings.permissions.updateSuccess",
		en: "Permissions updated successfully",
		de: "Berechtigungen erfolgreich aktualisiert",
	},
	{
		key: "settings.permissions.updateError",
		en: "Failed to update permissions",
		de: "Aktualisierung der Berechtigungen fehlgeschlagen",
	},
	{
		key: "settings.permissions.revokeSuccess",
		en: "Permissions revoked successfully",
		de: "Berechtigungen erfolgreich widerrufen",
	},
	{
		key: "settings.permissions.revokeError",
		en: "Failed to revoke permissions",
		de: "Widerruf der Berechtigungen fehlgeschlagen",
	},
];

describe("Custom Roles and Team Permissions EN/DE route catalogs", () => {
	it.each(["en", "de"] as const)(
		"resolves every Custom Roles and Team Permissions translation on /settings/roles in %s",
		async (locale) => {
			const namespaces = getNamespacesForRoute("/settings/roles");
			const slice = await loadCatalogSlice(locale, namespaces);
			const tolgee = TolgeeBase({ loadAllLanguageCatalogs: false }).init({
				language: locale,
				staticData: slice.records,
			});
			await tolgee.run();

			try {
				for (const entry of REQUIRED_KEYS) {
					const actual = entry.params
						? tolgee.t(entry.key, "__MISSING__", entry.params)
						: tolgee.t(entry.key, "__MISSING__");
					expect(actual, `${locale}: ${entry.key}`).toBe(entry[locale]);
				}
			} finally {
				tolgee.stop();
			}
		},
	);
});
