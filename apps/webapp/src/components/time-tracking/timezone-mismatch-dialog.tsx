"use client";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";

interface TimezoneMismatchDialogProps {
	open: boolean;
	savedTimezone: string;
	browserTimezone: string;
	isUpdating?: boolean;
	onUpdateAndContinue: () => void;
	onContinueOnce: () => void;
	onCancel: () => void;
}

export function TimezoneMismatchDialog({
	open,
	savedTimezone,
	browserTimezone,
	isUpdating = false,
	onUpdateAndContinue,
	onContinueOnce,
	onCancel,
}: TimezoneMismatchDialogProps) {
	return (
		<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Confirm Timezone for This Entry</DialogTitle>
					<DialogDescription>
						Your device timezone is {browserTimezone}, but your saved timezone is {savedTimezone}.
					</DialogDescription>
				</DialogHeader>
				<p className="text-muted-foreground text-sm">
					Choose whether to use your device timezone only for this action or update your saved
					timezone before continuing.
				</p>
				<DialogFooter>
					<Button type="button" variant="outline" onClick={onCancel} disabled={isUpdating}>
						Cancel
					</Button>
					<Button type="button" variant="secondary" onClick={onContinueOnce} disabled={isUpdating}>
						Continue once
					</Button>
					<Button type="button" onClick={onUpdateAndContinue} disabled={isUpdating}>
						Update timezone and continue
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
