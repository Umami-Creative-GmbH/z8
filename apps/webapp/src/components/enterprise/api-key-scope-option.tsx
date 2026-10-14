"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/** One key scope checkbox of the create and edit forms, with the scope's warning when it has one. */
export function ApiKeyScopeOption({
	id,
	label,
	warning,
	checked,
	onCheckedChange,
}: {
	id: string;
	label: string;
	warning: string | undefined;
	checked: boolean;
	onCheckedChange: () => void;
}) {
	const warningId = `${id}-warning`;
	return (
		<div className="flex items-start gap-x-2">
			<Checkbox
				id={id}
				className="mt-0.5"
				checked={checked}
				onCheckedChange={onCheckedChange}
				aria-describedby={warning ? warningId : undefined}
			/>
			<div className="min-w-0 space-y-1">
				<Label htmlFor={id} className="text-sm font-normal cursor-pointer">
					{label}
				</Label>
				{warning ? (
					<p id={warningId} className="text-xs text-muted-foreground">
						{warning}
					</p>
				) : null}
			</div>
		</div>
	);
}
