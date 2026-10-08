import { IconBuilding, IconCheck, IconChevronDown } from "@tabler/icons-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { Organization } from "../hooks/useOrganizations";
import { useI18n } from "../lib/i18n";
interface OrganizationSelectorProps {
	organizations: Organization[];
	activeOrganizationId: string | null;
	onSwitch: (id: string) => Promise<void>;
	isSwitching: boolean;
}
export function OrganizationSelector({
	organizations,
	activeOrganizationId,
	onSwitch,
	isSwitching,
}: OrganizationSelectorProps) {
	const { t } = useI18n();
	const [open, setOpen] = useState(false),
		[error, setError] = useState<string | null>(null);
	const trigger = useRef<HTMLButtonElement>(null),
		menu = useRef<HTMLDivElement>(null);
	const menuId = useId();
	const active = organizations.find((org) => org.id === activeOrganizationId);
	const select = async (id: string) => {
		setError(null);
		try {
			if (id !== activeOrganizationId) await onSwitch(id);
			setOpen(false);
			trigger.current?.focus();
		} catch (error) {
			setError(String(error));
		}
	};
	const navigate = (event: KeyboardEvent) => {
		if (event.key === "Escape") {
			setOpen(false);
			trigger.current?.focus();
			event.preventDefault();
			return;
		}
		if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const items = Array.from(
			menu.current?.querySelectorAll<HTMLButtonElement>(
				"button:not(:disabled)",
			) ?? [],
		);
		const index = items.indexOf(document.activeElement as HTMLButtonElement);
		const next =
			event.key === "Home"
				? 0
				: event.key === "End"
					? items.length - 1
					: (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) %
						items.length;
		items[next]?.focus();
	};
	return (
		<div className="org-selector-wrapper">
			<button
				ref={trigger}
				type="button"
				className="org-selector"
				disabled={isSwitching}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={menuId}
				onClick={() => setOpen(!open)}
				onKeyDown={(event) => {
					if (event.key === "ArrowDown") {
						event.preventDefault();
						setOpen(true);
						setTimeout(
							() =>
								menu.current
									?.querySelector<HTMLButtonElement>("button:not(:disabled)")
									?.focus(),
							0,
						);
					}
				}}
			>
				<IconBuilding size={14} aria-hidden="true" />
				<span className="org-name">
					{active?.name ?? t("Select organization")}
				</span>
				<IconChevronDown size={14} aria-hidden="true" />
			</button>
			{open && (
				<>
					<button
						type="button"
						className="org-dropdown-backdrop"
						tabIndex={-1}
						aria-hidden="true"
						onClick={() => setOpen(false)}
						style={{
							background: "transparent",
							border: 0,
							outline: "none",
							padding: 0,
						}}
					/>
					<div
						ref={menu}
						id={menuId}
						role="menu"
						aria-label={t("Switch organization")}
						className="org-dropdown"
						onKeyDown={navigate}
					>
						{organizations.map((org) => (
							<button
								type="button"
								role="menuitemradio"
								aria-checked={org.id === activeOrganizationId}
								key={org.id}
								className="org-dropdown-item"
								disabled={
									isSwitching || org.ssoRequired || !org.hasEmployeeRecord
								}
								onClick={() => select(org.id)}
							>
								<span className="org-dropdown-item-content">
									<span>{org.name}</span>
									{(org.ssoRequired || !org.hasEmployeeRecord) && (
										<span className="org-role">
											{t(
												org.ssoRequired
													? "SSO sign-in required"
													: "No employee access",
											)}
										</span>
									)}
								</span>
								{org.id === activeOrganizationId && (
									<IconCheck size={14} aria-hidden="true" />
								)}
							</button>
						))}
					</div>
				</>
			)}
			{error && (
				<p role="alert" className="login-error">
					{error}
				</p>
			)}
		</div>
	);
}
