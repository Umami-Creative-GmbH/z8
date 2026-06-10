export function isNavItemActive(pathname: string | null | undefined, href: string) {
	const normalizedPathname = pathname?.replace(/^\/[a-z]{2}(\/|$)/, "/");

	if (href === "/") {
		return normalizedPathname === "/";
	}

	return normalizedPathname === href || normalizedPathname?.startsWith(`${href}/`) === true;
}
