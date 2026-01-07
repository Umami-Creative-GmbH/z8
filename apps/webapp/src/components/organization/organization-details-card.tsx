"use client";

import { IconBuilding, IconEdit, IconUsers } from "@tabler/icons-react";
import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type * as authSchema from "@/db/auth-schema";
import { EditOrganizationDialog } from "./edit-organization-dialog";

interface OrganizationDetailsCardProps {
	organization: typeof authSchema.organization.$inferSelect;
	memberCount: number;
	currentMemberRole: "owner" | "admin" | "member";
}

export function OrganizationDetailsCard({
	organization,
	memberCount,
	currentMemberRole,
}: OrganizationDetailsCardProps) {
	const [editDialogOpen, setEditDialogOpen] = useState(false);

	const canEdit = currentMemberRole === "owner";

	return (
		<>
			<Card>
				<CardHeader>
					<div className="flex items-start justify-between">
						<div className="flex items-start gap-4">
							<Avatar className="h-16 w-16">
								<AvatarImage src={organization.logo || undefined} alt={organization.name} />
								<AvatarFallback className="bg-primary/10">
									<IconBuilding className="h-8 w-8 text-primary" />
								</AvatarFallback>
							</Avatar>
							<div>
								<CardTitle className="text-2xl">{organization.name}</CardTitle>
								<CardDescription className="mt-1">
									{organization.slug && (
										<span className="text-xs font-mono bg-muted px-2 py-1 rounded">
											{organization.slug}
										</span>
									)}
								</CardDescription>
							</div>
						</div>
						{canEdit && (
							<Button variant="outline" size="sm" onClick={() => setEditDialogOpen(true)}>
								<IconEdit className="h-4 w-4 mr-2" />
								Edit
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<IconUsers className="h-4 w-4" />
						<span>
							{memberCount} {memberCount === 1 ? "member" : "members"}
						</span>
					</div>
					{organization.metadata && (
						<p className="mt-4 text-sm text-muted-foreground">
							{(() => {
								try {
									const metadata = JSON.parse(organization.metadata as string);
									return metadata.description || null;
								} catch {
									return null;
								}
							})()}
						</p>
					)}
				</CardContent>
			</Card>

			<EditOrganizationDialog
				organization={organization}
				open={editDialogOpen}
				onOpenChange={setEditDialogOpen}
			/>
		</>
	);
}
