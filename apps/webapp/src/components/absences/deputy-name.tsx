"use client";

import type { DeputyDisplay } from "@/lib/absences/deputy-visibility";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";

/**
 * An absence's deputy by name (#1012): a link to their profile when the viewer
 * may open it, plain text otherwise.
 */
export function DeputyName({
	deputy,
	className,
}: {
	deputy: Pick<DeputyDisplay, "id" | "name"> & { canOpenProfile?: boolean };
	className?: string;
}) {
	if (!deputy.canOpenProfile) {
		return <span className={className}>{deputy.name}</span>;
	}
	return (
		<Link
			href={`/settings/employees/${deputy.id}`}
			className={cn("underline-offset-4 hover:underline", className)}
		>
			{deputy.name}
		</Link>
	);
}
