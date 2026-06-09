export function isSettingsNavItemActive(pathname: string | null | undefined, href: string) {
	const normalizedPathname = pathname?.replace(/^\/[a-z]{2}(\/|$)/, "/");

	return normalizedPathname === href || normalizedPathname?.startsWith(`${href}/`) === true;
}
