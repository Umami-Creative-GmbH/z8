import type { DesktopContext } from "../types";
export function attributionAvailability(context: DesktopContext | undefined) {
	return {
		project: !!context?.projects.length && context.projectsEnabled !== false,
		workCategory: !!context?.categories.length,
	};
}
