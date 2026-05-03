"use client";

import { IconBuilding, IconCircleCheck, IconCircleOff, IconStar } from "@tabler/icons-react";
import type { legalEntity } from "@/db/schema";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface LegalEntitiesManagementProps {
	entities: (typeof legalEntity.$inferSelect)[];
}

export function LegalEntitiesManagement({ entities }: LegalEntitiesManagementProps) {
	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="flex max-w-3xl flex-col gap-2">
				<h1 className="text-2xl font-semibold tracking-tight text-balance">Legal Entities</h1>
				<p className="text-sm text-muted-foreground">
					Manage entity-specific payroll, policies, holidays, and admins.
				</p>
			</div>

			{entities.length === 0 ? (
				<Card className="border-dashed">
					<CardHeader>
						<CardTitle className="text-lg">No legal entities yet</CardTitle>
						<CardDescription>
							Create a company entity before assigning entity-specific settings.
						</CardDescription>
					</CardHeader>
				</Card>
			) : (
				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
					{entities.map((entity) => (
						<Card key={entity.id} className="overflow-hidden">
							<CardHeader className="gap-3">
								<div className="flex items-start justify-between gap-4">
									<div className="min-w-0 space-y-1">
										<CardTitle className="truncate text-lg">{entity.name}</CardTitle>
										<CardDescription className="truncate">
											{entity.legalName || entity.name}
										</CardDescription>
									</div>
									<div className="rounded-lg bg-primary/10 p-2 text-primary">
										<IconBuilding className="size-5" aria-hidden="true" />
									</div>
								</div>
								<div className="flex flex-wrap gap-2">
									{entity.isDefault ? (
										<Badge className="gap-1">
											<IconStar className="size-3" aria-hidden="true" />
											Default entity
										</Badge>
									) : (
										<Badge variant="outline">Entity</Badge>
									)}
									<Badge variant={entity.isActive ? "secondary" : "outline"} className="gap-1">
										{entity.isActive ? (
											<IconCircleCheck className="size-3" aria-hidden="true" />
										) : (
											<IconCircleOff className="size-3" aria-hidden="true" />
										)}
										{entity.isActive ? "Active" : "Inactive"}
									</Badge>
								</div>
							</CardHeader>
							<CardContent>
								<dl className="grid grid-cols-2 gap-3 text-sm">
									<div>
										<dt className="text-muted-foreground">Currency</dt>
										<dd className="font-medium">{entity.defaultCurrency}</dd>
									</div>
									<div>
										<dt className="text-muted-foreground">Timezone</dt>
										<dd className="truncate font-medium">{entity.timezone}</dd>
									</div>
								</dl>
							</CardContent>
						</Card>
					))}
				</div>
			)}
		</div>
	);
}
