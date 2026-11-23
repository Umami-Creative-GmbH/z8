"use client";
import { IconLock, IconPencil, IconShieldCheck, IconSteeringWheel } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	LICENCE_CLASS_GROUPS,
	LICENCE_CLASS_INFO,
	LICENCE_CLASSES,
	type LicenceClass,
} from "@/lib/organization/driving-licence/check-types";
import {
	saveDeclaredLicenceClassesAction,
	withdrawDeclaredLicenceClassesAction,
} from "@/lib/organization/driving-licence/declared-classes-actions";
import type { DrivingLicenceDeclaredClasses } from "@/lib/organization/driving-licence/declared-classes-store";
import { queryKeys } from "@/lib/query";
import { cn } from "@/lib/utils";
import { useDrivingDateOnly } from "./deadline-date";
import { LicenceClassIcon, useLicenceClassNames } from "./licence-class-visuals";

/**
 * *Your licence classes* on My driving licence (#2003): the intended driver states which
 * classes they hold. Shown as declared, never as authorized; a verifier's check replaces it.
 */
export function DeclaredLicenceClasses({
	declared,
	declaredUnchecked,
	authorizedClasses,
}: {
	declared: DrivingLicenceDeclaredClasses | null;
	declaredUnchecked: readonly string[];
	authorizedClasses: readonly string[];
}) {
	const { t } = useTranslate();
	const titleId = useId();
	const formatDate = useDrivingDateOnly();
	const { className: nameOf } = useLicenceClassNames();
	const [editing, setEditing] = useState(false);
	const unchecked = new Set(declaredUnchecked);
	const shown = declared?.classes.filter((entry) => unchecked.has(entry.code)) ?? [];
	const dialog = editing ? (
		<DeclaredClassesDialog
			declared={declared}
			authorizedClasses={authorizedClasses}
			onClose={() => setEditing(false)}
		/>
	) : null;
	if (!shown.length)
		return (
			<Card role="region" aria-labelledby={titleId}>
				<Empty className="gap-4 p-6 md:p-8">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<IconSteeringWheel aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>
							<h2 id={titleId}>
								{authorizedClasses.length
									? t("drivingLicence.declared.emptyMoreTitle", "Got another licence class?")
									: t("drivingLicence.declared.emptyTitle", "What can you drive?")}
							</h2>
						</EmptyTitle>
						<EmptyDescription>
							{authorizedClasses.length
								? t(
										"drivingLicence.declared.emptyMoreDescription",
										"Add a class you have passed since your last check. Your verifier is asked to check it.",
									)
								: t(
										"drivingLicence.declared.emptyDescription",
										"Tell your organization which licence classes you hold. It helps with planning and prepares your check; it does not authorize you to drive.",
									)}
						</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button onClick={() => setEditing(true)}>
							<IconSteeringWheel aria-hidden="true" />
							{t("drivingLicence.declared.add", "Add licence classes")}
						</Button>
					</EmptyContent>
				</Empty>
				{dialog}
			</Card>
		);
	return (
		<Card role="region" aria-labelledby={titleId}>
			<CardHeader>
				<CardTitle>
					<h2 id={titleId} className="text-lg font-semibold">
						{t("drivingLicence.declared.title", "Your declared licence classes")}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"drivingLicence.declared.description",
						"Declared by you, not checked yet. They don't authorize you to drive until a verifier checks your original licence.",
					)}
				</CardDescription>
				<CardAction>
					<Button variant="outline" size="sm" onClick={() => setEditing(true)}>
						<IconPencil aria-hidden="true" />
						{t("drivingLicence.declared.edit", "Edit")}
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent className="space-y-4">
				<ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
					{shown.map((entry) => (
						<li
							key={entry.code}
							className="flex items-center gap-3 rounded-lg border border-dashed bg-muted/30 p-3"
						>
							<LicenceClassIcon code={entry.code} size="lg" className="text-muted-foreground" />
							<div className="min-w-0">
								<p className="font-semibold leading-tight" translate="no">
									{entry.code}
								</p>
								<p className="truncate text-xs text-muted-foreground">{nameOf(entry.code)}</p>
								{entry.expiryDate ? (
									<p className="text-xs text-muted-foreground">
										{t("drivingLicence.declared.classExpires", "Expires {date}", {
											date: formatDate(entry.expiryDate),
										})}
									</p>
								) : null}
							</div>
						</li>
					))}
				</ul>
				<dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
					{declared?.documentExpiresOn ? (
						<div className="flex gap-1">
							<dt>{t("drivingLicence.declared.documentExpires", "Licence card expires")}</dt>
							<dd className="text-foreground">{formatDate(declared.documentExpiresOn)}</dd>
						</div>
					) : null}
					{declared ? (
						<div className="flex gap-1">
							<dt>{t("drivingLicence.declared.updated", "Updated")}</dt>
							<dd className="text-foreground">{formatDate(declared.updatedAt.slice(0, 10))}</dd>
						</div>
					) : null}
				</dl>
			</CardContent>
			{dialog}
		</Card>
	);
}

type FormValues = {
	selected: LicenceClass[];
	expiry: Partial<Record<LicenceClass, string>>;
	documentExpiresOn: string;
};

function DeclaredClassesDialog({
	declared,
	authorizedClasses,
	onClose,
}: {
	declared: DrivingLicenceDeclaredClasses | null;
	authorizedClasses: readonly string[];
	onClose: () => void;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const [error, setError] = useState("");
	const [withdrawing, startWithdraw] = useTransition();
	const { className: nameOf } = useLicenceClassNames();
	const authorized = new Set(authorizedClasses);
	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: queryKeys.drivingLicence.status });
		router.refresh();
	};
	const failure = (code: string) =>
		code === "not_intended_driver"
			? t(
					"drivingLicence.declared.notIntended",
					"You are not an intended driver anymore, so your organization doesn't collect your licence classes.",
				)
			: code === "invalid"
				? t("drivingLicence.declared.invalid", "Check the selected classes and dates.")
				: t(
						"drivingLicence.declared.saveFailed",
						"Your licence classes could not be saved. Your selection is kept; try again.",
					);
	const form = useForm({
		defaultValues: {
			selected: (declared?.classes.map((entry) => entry.code) ?? []).filter(
				(code) => !authorized.has(code),
			),
			expiry: Object.fromEntries(
				declared?.classes.flatMap((entry) =>
					entry.expiryDate ? [[entry.code, entry.expiryDate]] : [],
				) ?? [],
			),
			documentExpiresOn: declared?.documentExpiresOn ?? "",
		} as FormValues,
		onSubmit: async ({ value }) => {
			setError("");
			const chosen = new Set(value.selected);
			const result = await saveDeclaredLicenceClassesAction({
				classes: LICENCE_CLASSES.filter((code) => chosen.has(code)).map((code) => ({
					code,
					expiryDate: (LICENCE_CLASS_INFO[code].expires && value.expiry[code]) || null,
				})),
				documentExpiresOn: value.documentExpiresOn || null,
			}).catch(() => ({ success: false as const, error: "save_failed" }));
			if (!result.success) {
				setError(failure(result.error));
				return;
			}
			toast.success(
				t(
					"drivingLicence.declared.saved",
					"Licence classes saved. Your verifier will check them with your original licence.",
				),
			);
			refresh();
			onClose();
		},
	});
	const withdraw = () =>
		startWithdraw(async () => {
			const result = await withdrawDeclaredLicenceClassesAction().catch(() => ({
				success: false as const,
				error: "save_failed",
			}));
			if (!result.success) {
				setError(failure(result.error));
				return;
			}
			toast.success(t("drivingLicence.declared.removed", "Declared licence classes removed"));
			refresh();
			onClose();
		});
	return (
		<Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
			<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{t("drivingLicence.declared.dialogTitle", "Which classes are on your licence?")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"drivingLicence.declared.dialogDescription",
							"Select every class on your driving licence. Your verifier confirms them when checking your original licence.",
						)}
					</DialogDescription>
				</DialogHeader>
				<form
					className="space-y-6"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<form.Field name="selected">
						{(field) => (
							<ClassPicker
								selected={field.state.value}
								authorized={authorized}
								onChange={field.handleChange}
							/>
						)}
					</form.Field>
					<form.Subscribe selector={(state) => state.values.selected}>
						{(selected) =>
							selected.length ? (
								<fieldset className="space-y-3">
									<legend className="mb-1 text-sm font-medium">
										{t("drivingLicence.declared.expiryTitle", "Expiry dates (optional)")}
									</legend>
									<div className="grid gap-3 sm:grid-cols-2">
										<form.Field name="documentExpiresOn">
											{(field) => (
												<ExpiryDateInput
													label={t(
														"drivingLicence.declared.documentExpiry",
														"Licence card expires on",
													)}
													help={t(
														"drivingLicence.declared.documentExpiryHelp",
														"Field 4b on the card. Leave empty if your licence has none.",
													)}
													value={field.state.value}
													onChange={field.handleChange}
												/>
											)}
										</form.Field>
										{LICENCE_CLASSES.filter(
											(code) => selected.includes(code) && LICENCE_CLASS_INFO[code].expires,
										).map((code) => (
											<form.Field key={code} name={`expiry.${code}`}>
												{(field) => (
													<ExpiryDateInput
														code={code}
														label={t(
															"drivingLicence.declared.classExpiry",
															"{code} ({name}) expires on",
															{ code, name: nameOf(code) },
														)}
														value={field.state.value ?? ""}
														onChange={field.handleChange}
													/>
												)}
											</form.Field>
										))}
									</div>
								</fieldset>
							) : null
						}
					</form.Subscribe>
					<p className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
						<IconLock aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
						{t(
							"drivingLicence.declared.privacy",
							"Only your classes and expiry dates are saved, no licence number or photo. Your statement doesn't authorize you to drive.",
						)}
					</p>
					{error ? (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					) : null}
					<DialogFooter className="gap-2 sm:justify-between">
						{declared ? (
							<Button
								type="button"
								variant="ghost"
								className="text-destructive hover:text-destructive"
								disabled={withdrawing}
								onClick={withdraw}
							>
								{withdrawing
									? t("drivingLicence.declared.removing", "Removing…")
									: t("drivingLicence.declared.remove", "Remove my classes")}
							</Button>
						) : (
							<span />
						)}
						<div className="flex flex-col-reverse gap-2 sm:flex-row">
							<Button type="button" variant="outline" onClick={onClose}>
								{t("common.cancel", "Cancel")}
							</Button>
							<form.Subscribe
								selector={(state) => [state.isSubmitting, state.values.selected.length] as const}
							>
								{([submitting, count]) => (
									<Button type="submit" disabled={submitting || count === 0}>
										{submitting
											? t("drivingLicence.declared.saving", "Saving…")
											: t(
													"drivingLicence.declared.save",
													"Save {count, plural, one {# class} other {# classes}}",
													{
														count,
													},
												)}
									</Button>
								)}
							</form.Subscribe>
						</div>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/** Class tiles by vehicle group; already authorized classes are shown, locked. */
function ClassPicker({
	selected,
	authorized,
	onChange,
}: {
	selected: readonly LicenceClass[];
	authorized: ReadonlySet<string>;
	onChange: (next: LicenceClass[]) => void;
}) {
	const { t } = useTranslate();
	const { className: nameOf, groupName } = useLicenceClassNames();
	const id = useId();
	const chosen = new Set(selected);
	return (
		<div className="space-y-5">
			{LICENCE_CLASS_GROUPS.map((group) => (
				<fieldset key={group} className="space-y-2">
					<legend className="mb-2 text-sm font-medium">{groupName(group)}</legend>
					<div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
						{LICENCE_CLASSES.filter((code) => LICENCE_CLASS_INFO[code].group === group).map(
							(code) => {
								const locked = authorized.has(code);
								const on = locked || chosen.has(code);
								return (
									<Label
										key={code}
										htmlFor={`${id}-${code}`}
										className={cn(
											"relative flex h-full cursor-pointer flex-col items-start gap-2 rounded-lg border p-3 font-normal transition-colors",
											"hover:bg-accent/50 has-focus-visible:ring-[3px] has-focus-visible:ring-ring/50",
											on && "border-primary bg-primary/5",
											locked && "cursor-default border-success/40 bg-success/5 hover:bg-success/5",
										)}
									>
										<Checkbox
											id={`${id}-${code}`}
											className="absolute top-3 right-3"
											checked={on}
											disabled={locked}
											onCheckedChange={(checked) =>
												onChange(
													checked === true
														? [...selected, code]
														: selected.filter((entry) => entry !== code),
												)
											}
										/>
										<LicenceClassIcon
											code={code}
											size="lg"
											className={cn(
												"text-muted-foreground",
												on && !locked && "text-primary",
												locked && "text-success",
											)}
										/>
										<span className="flex flex-col pr-6">
											<span className="font-semibold" translate="no">
												{code}
											</span>{" "}
											<span className="text-xs leading-snug text-muted-foreground">
												{nameOf(code)}
											</span>
											{locked ? " " : null}
											{locked ? (
												<span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-success">
													<IconShieldCheck aria-hidden="true" className="size-3.5" />
													{t("drivingLicence.declared.authorized", "Authorized")}
												</span>
											) : null}
										</span>
									</Label>
								);
							},
						)}
					</div>
				</fieldset>
			))}
		</div>
	);
}

/** One optional expiry date: the licence card's, or a C or D class's own. */
function ExpiryDateInput({
	code,
	label,
	help,
	value,
	onChange,
}: {
	code?: LicenceClass;
	label: string;
	help?: string;
	value: string;
	onChange: (value: string) => void;
}) {
	const id = useId();
	return (
		<div className="space-y-1.5">
			<Label htmlFor={id} className="flex items-center gap-2">
				{code ? <LicenceClassIcon code={code} size="sm" className="text-muted-foreground" /> : null}
				{label}
			</Label>
			<Input
				id={id}
				type="date"
				autoComplete="off"
				aria-describedby={help ? `${id}-help` : undefined}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
			{help ? (
				<p id={`${id}-help`} className="text-xs text-muted-foreground">
					{help}
				</p>
			) : null}
		</div>
	);
}
