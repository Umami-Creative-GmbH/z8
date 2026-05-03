"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface LegalEntitySelectorEntity {
	id: string;
	name: string;
}

interface LegalEntitySelectorProps {
	entities: LegalEntitySelectorEntity[];
	selectedLegalEntityId: string;
}

export function LegalEntitySelector({ entities, selectedLegalEntityId }: LegalEntitySelectorProps) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	if (entities.length <= 1) {
		return null;
	}

	return (
		<div className="grid gap-2 sm:max-w-xs">
			<Label htmlFor="legal-entity-selector">Legal entity</Label>
			<Select
				value={selectedLegalEntityId}
				onValueChange={(value) => {
					const next = new URLSearchParams(searchParams.toString());
					next.set("legalEntityId", value);
					router.push(`${pathname}?${next.toString()}`);
				}}
			>
				<SelectTrigger id="legal-entity-selector">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{entities.map((entity) => (
						<SelectItem key={entity.id} value={entity.id}>
							{entity.name}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
