"use client";

import type { KioskEmployeeListing } from "@/lib/time-tracking/kiosk/protocol";

/** Case- and accent-insensitive, so "ozd" finds "Özdemir". */
export function searchableKioskName(value: string) {
	return value
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLocaleLowerCase();
}

/** The employees whose name contains the search text, as typed. */
export function kioskNamesMatching(employees: KioskEmployeeListing[], query: string) {
	const needle = searchableKioskName(query.trim());
	return employees.filter((employee) => searchableKioskName(employee.name).includes(needle));
}

function initials(name: string) {
	const words = name.trim().split(/\s+/).filter(Boolean);
	const letters = words.length > 1 ? [words[0], words[words.length - 1]] : words;
	return letters.map((word) => Array.from(word)[0]?.toLocaleUpperCase() ?? "").join("");
}

/**
 * The kiosk's employees as big name buttons (#862): the home screen's list and
 * (#1505) the name pick of a fob registration.
 */
export function KioskNameGrid({
	employees,
	onPick,
}: {
	employees: KioskEmployeeListing[];
	onPick: (employee: KioskEmployeeListing) => void;
}) {
	return (
		<ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
			{employees.map((employee) => (
				<li key={employee.id}>
					<button
						type="button"
						onClick={() => onPick(employee)}
						className="flex min-h-20 w-full items-center gap-4 rounded-xl border bg-card px-4 py-3 text-left text-xl font-medium shadow-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:bg-accent"
					>
						<span
							aria-hidden="true"
							className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary"
						>
							{initials(employee.name)}
						</span>
						<span className="min-w-0 break-words">{employee.name}</span>
					</button>
				</li>
			))}
		</ul>
	);
}
