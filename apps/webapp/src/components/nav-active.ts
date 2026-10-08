export function isNavItemActive(pathname: string | null | undefined, href: string) {
	const normalizedPathname = pathname?.replace(/^\/[a-z]{2}(\/|$)/, "/");

	if (href === "/") {
		return normalizedPathname === "/";
	}

	return normalizedPathname === href || normalizedPathname?.startsWith(`${href}/`) === true;
}

/** The most specific of `hrefs` the path is in, so a parent and its child are never both active. */
export function activeNavHref(
	pathname: string | null | undefined,
	hrefs: readonly string[],
): string | null {
	let active: string | null = null;
	for (const href of hrefs) {
		if (isNavItemActive(pathname, href) && href.length > (active?.length ?? -1)) active = href;
	}
	return active;
}
