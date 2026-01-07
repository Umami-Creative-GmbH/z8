"use client";

import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { assignManagers } from "@/app/[locale]/(app)/settings/employees/actions";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Manager {
	id: string;
	userId: string;
	firstName: string | null;
	lastName: string | null;
	user: {
		name: string;
		email: string;
		image: string | null;
	};
}

interface CurrentManager {
	id: string;
	isPrimary: boolean;
	manager: Manager;
}

interface ManagerAssignmentProps {
	employeeId: string;
	currentManagers: CurrentManager[];
	availableManagers: Manager[];
	onSuccess?: () => void;
	onCancel?: () => void;
}

export function ManagerAssignment({
	employeeId,
	currentManagers,
	availableManagers,
	onSuccess,
	onCancel,
}: ManagerAssignmentProps) {
	const [selectedManagers, setSelectedManagers] = useState<Set<string>>(new Set());
	const [primaryManager, setPrimaryManager] = useState<string>("");
	const [loading, setLoading] = useState(false);

	// Initialize with current managers
	useEffect(() => {
		const managerIds = new Set(currentManagers.map((m) => m.manager.id));
		setSelectedManagers(managerIds);

		const primary = currentManagers.find((m) => m.isPrimary);
		if (primary) {
			setPrimaryManager(primary.manager.id);
		}
	}, [currentManagers]);

	const handleManagerToggle = (managerId: string, checked: boolean) => {
		const newSelected = new Set(selectedManagers);

		if (checked) {
			newSelected.add(managerId);
			// If this is the first manager, make them primary
			if (newSelected.size === 1) {
				setPrimaryManager(managerId);
			}
		} else {
			newSelected.delete(managerId);
			// If removing the primary manager, select another as primary
			if (managerId === primaryManager && newSelected.size > 0) {
				setPrimaryManager(Array.from(newSelected)[0]);
			}
		}

		setSelectedManagers(newSelected);
	};

	const handleSave = async () => {
		// Validate at least one manager selected
		if (selectedManagers.size === 0) {
			toast.error("Please select at least one manager");
			return;
		}

		// Validate primary manager is selected
		if (!primaryManager || !selectedManagers.has(primaryManager)) {
			toast.error("Please designate a primary manager");
			return;
		}

		setLoading(true);

		try {
			const managers = Array.from(selectedManagers).map((managerId) => ({
				managerId,
				isPrimary: managerId === primaryManager,
			}));

			const result = await assignManagers(employeeId, { managers });

			if (result.success) {
				toast.success("Managers assigned successfully");
				onSuccess?.();
			} else {
				toast.error(result.error || "Failed to assign managers");
			}
		} catch (error) {
			toast.error("An unexpected error occurred");
		} finally {
			setLoading(false);
		}
	};

	const isChanged =
		selectedManagers.size !== currentManagers.length ||
		!currentManagers.every((m) => selectedManagers.has(m.manager.id)) ||
		primaryManager !== currentManagers.find((m) => m.isPrimary)?.manager.id;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Manager Assignment</CardTitle>
				<CardDescription>
					Select one or more managers for this employee. Designate one as primary.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{/* Manager Selection */}
				<div className="space-y-4">
					<Label className="text-base font-semibold">Available Managers</Label>
					<ScrollArea className="h-[300px] rounded-md border p-4">
						<div className="space-y-4">
							{availableManagers.length === 0 ? (
								<p className="text-sm text-muted-foreground">No available managers</p>
							) : (
								availableManagers.map((manager) => {
									const isSelected = selectedManagers.has(manager.id);
									const displayName =
										manager.firstName && manager.lastName
											? `${manager.firstName} ${manager.lastName}`
											: manager.user.name;

									return (
										<div
											key={manager.id}
											className="flex items-center space-x-3 rounded-lg p-2 hover:bg-accent"
										>
											<Checkbox
												id={`manager-${manager.id}`}
												checked={isSelected}
												onCheckedChange={(checked) =>
													handleManagerToggle(manager.id, checked as boolean)
												}
												disabled={loading}
											/>
											<Label
												htmlFor={`manager-${manager.id}`}
												className="flex flex-1 items-center gap-3 cursor-pointer"
											>
												<Avatar className="size-8">
													<AvatarImage src={manager.user.image || undefined} />
													<AvatarFallback>
														{manager.user.name
															.split(" ")
															.map((n) => n[0])
															.join("")
															.toUpperCase()}
													</AvatarFallback>
												</Avatar>
												<div className="flex-1">
													<div className="font-medium">{displayName}</div>
													<div className="text-sm text-muted-foreground">{manager.user.email}</div>
												</div>
											</Label>
										</div>
									);
								})
							)}
						</div>
					</ScrollArea>
				</div>

				{/* Primary Manager Selection */}
				{selectedManagers.size > 0 && (
					<div className="space-y-4">
						<Label className="text-base font-semibold">Primary Manager</Label>
						<RadioGroup value={primaryManager} onValueChange={setPrimaryManager} disabled={loading}>
							<div className="space-y-2">
								{Array.from(selectedManagers).map((managerId) => {
									const manager = availableManagers.find((m) => m.id === managerId);
									if (!manager) return null;

									const displayName =
										manager.firstName && manager.lastName
											? `${manager.firstName} ${manager.lastName}`
											: manager.user.name;

									return (
										<div
											key={manager.id}
											className="flex items-center space-x-3 rounded-lg border p-3"
										>
											<RadioGroupItem value={manager.id} id={`primary-${manager.id}`} />
											<Label
												htmlFor={`primary-${manager.id}`}
												className="flex flex-1 items-center gap-3 cursor-pointer"
											>
												<Avatar className="size-8">
													<AvatarImage src={manager.user.image || undefined} />
													<AvatarFallback>
														{manager.user.name
															.split(" ")
															.map((n) => n[0])
															.join("")
															.toUpperCase()}
													</AvatarFallback>
												</Avatar>
												<div className="flex-1">
													<div className="font-medium">{displayName}</div>
													<div className="text-sm text-muted-foreground">{manager.user.email}</div>
												</div>
												{primaryManager === manager.id && (
													<IconCheck className="size-5 text-primary" />
												)}
											</Label>
										</div>
									);
								})}
							</div>
						</RadioGroup>
						<p className="text-sm text-muted-foreground">
							The primary manager will be the default for approvals and notifications
						</p>
					</div>
				)}

				{/* Action Buttons */}
				<div className="flex justify-end gap-2 pt-4">
					{onCancel && (
						<Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
							<IconX className="mr-2 size-4" />
							Cancel
						</Button>
					)}
					<Button onClick={handleSave} disabled={loading || !isChanged}>
						{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
						<IconCheck className="mr-2 size-4" />
						Save Managers
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
