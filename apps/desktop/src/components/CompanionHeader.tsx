import { IconSettings, IconWifiOff, IconClock } from "@tabler/icons-react";
import { OrganizationSelector } from "./OrganizationSelector";
import { ThemeToggle } from "./ThemeToggle";
import type { useOrganizations } from "../hooks/useOrganizations";
import type { useTheme } from "../hooks/useTheme";
import { useI18n } from "../lib/i18n";
export function CompanionHeader({
	organizations,
	theme,
	busy,
	offline,
	onOpenSettings,
}: {
	organizations: ReturnType<typeof useOrganizations>;
	theme: ReturnType<typeof useTheme>;
	busy: boolean;
	offline: boolean;
	onOpenSettings: () => void;
}) {
	const { t } = useI18n();
	return (
		<header className="app-header">
			<div className="app-header-left">
				<div className="app-header-brand">
					<div className="app-logo">
						<IconClock size={18} aria-hidden="true" />
					</div>
					<div>
						<h1 className="app-title">z8 Timer</h1>
						<div className="app-subtitle">{t("Time tracking")}</div>
					</div>
				</div>
				<OrganizationSelector
					organizations={organizations.organizations}
					activeOrganizationId={organizations.activeOrganizationId}
					onSwitch={organizations.switchOrganization}
					isSwitching={busy || organizations.isOffline}
				/>
			</div>
			<div className="app-header-actions">
				{offline && (
					<div className="offline-badge">
						<IconWifiOff size={14} aria-hidden="true" />
						<span>{t("Offline")}</span>
					</div>
				)}
				<ThemeToggle {...theme} />
				<button
					type="button"
					className="settings-button"
					onClick={onOpenSettings}
					disabled={busy}
					aria-label={t("Open settings")}
				>
					<IconSettings size={18} aria-hidden="true" />
				</button>
			</div>
		</header>
	);
}
