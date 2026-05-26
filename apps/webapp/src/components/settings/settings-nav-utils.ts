export function isSettingsNavItemActive(pathname: string | null | undefined, href: string) {
	return pathname === href || pathname?.startsWith(`${href}/`) === true;
}
