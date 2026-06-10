"use client";

import { IconArrowDown, IconArrowsSort, IconArrowUp } from "@tabler/icons-react";
import type { SortDirection } from "@tanstack/react-table";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";

function SortIcon({ sort }: { sort: false | SortDirection }) {
	if (sort === "asc") {
		return <IconArrowUp className="ml-2 size-4" aria-hidden="true" />;
	}

	if (sort === "desc") {
		return <IconArrowDown className="ml-2 size-4" aria-hidden="true" />;
	}

	return <IconArrowsSort className="ml-2 size-4" aria-hidden="true" />;
}

export function EmployeeHeader({ onClick, sort }: { onClick: () => void; sort: false | SortDirection }) {
	const { t } = useTranslate();

	return (
		<Button variant="ghost" onClick={onClick}>
			{t("settings.employees.directory.table.employee", "Employee")}
			<SortIcon sort={sort} />
		</Button>
	);
}
