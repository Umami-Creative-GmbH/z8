"use client";

import { AppErrorState } from "@/components/errors/app-error-state";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";
import { usePathname } from "@/navigation";

export default function WorkspaceNotFound() {
	const pathname = usePathname();
	return (
		<AppErrorState
			variant="not-found"
			recovery="workspace"
			headingLevel={appPageOwnsHeading(pathname) ? 1 : 2}
			titleKey="errors.notFound.title"
			titleDefault="Page not found"
			descriptionKey="errors.notFound.description"
			descriptionDefault="The page may have moved, the link may be outdated, or the address may be incorrect."
		/>
	);
}
