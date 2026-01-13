"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { updateTeam } from "@/app/[locale]/(app)/settings/teams/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { team } from "@/db/schema";

interface EditTeamDialogProps {
	team: typeof team.$inferSelect | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: (updatedTeam: typeof team.$inferSelect) => void;
}

export function EditTeamDialog({ team, open, onOpenChange, onSuccess }: EditTeamDialogProps) {
	const [formData, setFormData] = useState({
		name: "",
		description: "",
	});

	// Update form data when team changes
	useEffect(() => {
		if (team) {
			setFormData({
				name: team.name,
				description: team.description || "",
			});
		}
	}, [team]);

	const updateMutation = useMutation({
		mutationFn: (data: { teamId: string; name?: string; description?: string }) =>
			updateTeam(data.teamId, { name: data.name, description: data.description }),
		onSuccess: (result) => {
			if (!result.success) {
				toast.error(result.error || "Failed to update team");
				return;
			}
			toast.success("Team updated successfully");
			onOpenChange(false);
			onSuccess?.(result.data);
		},
		onError: () => {
			toast.error("Failed to update team");
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!team) return;

		updateMutation.mutate({
			teamId: team.id,
			name: formData.name !== team.name ? formData.name : undefined,
			description: formData.description !== team.description ? formData.description : undefined,
		});
	};

	if (!team) return null;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>Edit Team</DialogTitle>
					<DialogDescription>Update team name and description</DialogDescription>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="space-y-4">
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

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={updateMutation.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={updateMutation.isPending}>
							{updateMutation.isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							Save Changes
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
