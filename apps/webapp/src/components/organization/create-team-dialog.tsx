"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { createTeam } from "@/app/[locale]/(app)/settings/teams/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { team } from "@/db/schema";

interface CreateTeamDialogProps {
	organizationId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: (createdTeam: typeof team.$inferSelect) => void;
}

export function CreateTeamDialog({
	organizationId,
	open,
	onOpenChange,
	onSuccess,
}: CreateTeamDialogProps) {
	const [formData, setFormData] = useState({
		name: "",
		description: "",
	});

	const createMutation = useMutation({
		mutationFn: (data: { organizationId: string; name: string; description?: string }) =>
			createTeam(data),
		onSuccess: (result) => {
			if (!result.success) {
				toast.error(result.error || "Failed to create team");
				return;
			}
			toast.success("Team created successfully");
			setFormData({ name: "", description: "" });
			onOpenChange(false);
			onSuccess?.(result.data);
		},
		onError: () => {
			toast.error("Failed to create team");
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		createMutation.mutate({
			organizationId,
			name: formData.name,
			description: formData.description || undefined,
		});
	};

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>Create Team</ActionPanelTitle>
					<ActionPanelDescription>
						Create a new team to organize your employees
					</ActionPanelDescription>
				</ActionPanelHeader>

				<form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
					<ActionPanelBody className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="name">Team Name</Label>
							<Input
								id="name"
								value={formData.name}
								onChange={(e) => setFormData({ ...formData, name: e.target.value })}
								placeholder="Engineering, Sales, Marketing..."
								required
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">Description (Optional)</Label>
							<Textarea
								id="description"
								value={formData.description}
								onChange={(e) => setFormData({ ...formData, description: e.target.value })}
								placeholder="A brief description of this team"
								rows={3}
							/>
						</div>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={createMutation.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={createMutation.isPending}>
							{createMutation.isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							Create Team
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
