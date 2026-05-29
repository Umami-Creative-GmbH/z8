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
	isPending?: boolean;
	onUpdateAndContinue: () => void;
	onContinueOnce: () => void;
	onCancel: () => void;
}

export function TimezoneMismatchDialog({
	open,
	savedTimezone,
	browserTimezone,
	isPending = false,
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
					<Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>
						Cancel
					</Button>
					<Button type="button" variant="secondary" onClick={onContinueOnce} disabled={isPending}>
						Continue once
					</Button>
					<Button type="button" onClick={onUpdateAndContinue} disabled={isPending}>
						Update timezone and continue
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
