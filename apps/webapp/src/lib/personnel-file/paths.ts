import type { DocumentCategory } from "./document.types";

/** One employee's personnel file in the officer area, optionally filtered to a category. */
export function personnelFilePath(
	employeeId: string,
	options: { category?: DocumentCategory } = {},
): string {
	const path = `/personnel-files/${employeeId}`;
	return options.category ? `${path}?category=${options.category}` : path;
}
