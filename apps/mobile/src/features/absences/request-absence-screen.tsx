import {
	Button,
	Column,
	FieldGroup,
	Host,
	Row,
	Text as UiText,
	TextInput as UiTextInput,
} from "@expo/ui";
import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { useForm } from "@tanstack/react-form";
import { useMemo, useState } from "react";
import {
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	View,
} from "react-native";

import {
	createRequestAbsenceFormValidator,
	createRequestAbsenceFormValues,
	createRequestAbsencePayload,
	formatDatePickerButtonLabel,
	isoDateToPickerDate,
	pickerDateToIsoDate,
	type RequestAbsenceFormErrors,
} from "./request-absence-form";
import type {
	CreateMobileAbsenceRequestInput,
	MobileAbsenceCategory,
	MobileAbsenceDayPeriod,
	MobileVacationBalance,
} from "./use-absences-query";

interface RequestAbsenceScreenProps {
	categories: MobileAbsenceCategory[];
	vacationBalance: MobileVacationBalance;
	isSubmitting: boolean;
	submitErrorMessage?: string | null;
	onBack: () => void;
	onSubmit: (values: CreateMobileAbsenceRequestInput) => Promise<void>;
}

const PERIOD_OPTIONS: Array<{ value: MobileAbsenceDayPeriod; label: string }> =
	[
		{ value: "full_day", label: "Full day" },
		{ value: "am", label: "AM" },
		{ value: "pm", label: "PM" },
	];

type DateFieldName = "startDate" | "endDate";

function RequestAbsenceHeader({
	remainingDays,
}: {
	remainingDays: MobileVacationBalance["remainingDays"];
}) {
	return (
		<View style={styles.headerSurface}>
			<Text style={styles.eyebrow}>Request absence</Text>
			<Text style={styles.title}>Submit a time-off request</Text>
			<Text style={styles.description}>
				Keep the request short and precise so it can be reviewed quickly.
			</Text>
			<View style={styles.balanceRow}>
				<Text style={styles.balanceLabel}>Remaining vacation</Text>
				<Text style={styles.balanceValue}>{remainingDays} days</Text>
			</View>
		</View>
	);
}

function AbsenceCategorySelector({
	categories,
	error,
	onChange,
	value,
}: {
	categories: MobileAbsenceCategory[];
	error?: string;
	onChange: (categoryId: string) => void;
	value: string;
}) {
	return (
		<View style={styles.section}>
			<Text style={styles.label}>Absence type</Text>
			<View style={styles.chipWrap}>
				{categories.map((category) => {
					const isSelected = value === category.id;

					return (
						<Pressable
							accessibilityLabel={category.name}
							accessibilityRole="button"
							accessibilityState={{ selected: isSelected }}
							key={category.id}
							onPress={() => onChange(category.id)}
							style={[styles.choiceChip, isSelected && styles.choiceChipActive]}
						>
							<Text
								style={[
									styles.choiceChipLabel,
									isSelected && styles.choiceChipLabelActive,
								]}
							>
								{category.name}
							</Text>
						</Pressable>
					);
				})}
				{categories.length === 0 ? (
					<Text style={styles.helperText}>
						No absence types available right now.
					</Text>
				) : null}
			</View>
			{error ? <Text style={styles.fieldError}>{error}</Text> : null}
		</View>
	);
}

function AbsenceDateField({
	active,
	error,
	fieldName,
	label,
	onDismiss,
	onOpen,
	onSelect,
	value,
}: {
	active: boolean;
	error?: string;
	fieldName: DateFieldName;
	label: string;
	onDismiss: () => void;
	onOpen: () => void;
	onSelect: (date: Date) => void;
	value: string;
}) {
	return (
		<View style={styles.section}>
			<Text style={styles.label}>{label}</Text>
			<Pressable
				accessibilityLabel={formatDatePickerButtonLabel(fieldName, value)}
				accessibilityRole="button"
				onPress={onOpen}
			>
				<UiTextInput
					key={`${fieldName}-${value}`}
					defaultValue={value}
					editable={false}
					style={styles.dateInput}
					testID={`${fieldName === "startDate" ? "start" : "end"}-date-input`}
					textStyle={styles.dateInputText}
				/>
			</Pressable>
			{active ? (
				<DateTimePicker
					mode="date"
					onDismiss={onDismiss}
					onValueChange={(_event, selectedDate) => onSelect(selectedDate)}
					presentation="dialog"
					testID={`${fieldName === "startDate" ? "start" : "end"}-date-picker`}
					value={isoDateToPickerDate(value)}
				/>
			) : null}
			<UiText textStyle={styles.dateHelperText}>Tap to choose a date</UiText>
			{error ? <Text style={styles.fieldError}>{error}</Text> : null}
		</View>
	);
}

function AbsencePeriodSelector({
	error,
	label,
	onChange,
	value,
}: {
	error?: string;
	label: string;
	onChange: (value: MobileAbsenceDayPeriod) => void;
	value: MobileAbsenceDayPeriod;
}) {
	return (
		<View style={styles.section}>
			<Text style={styles.label}>{label} period</Text>
			<View style={styles.segmentedControl}>
				{PERIOD_OPTIONS.map((option) => {
					const isSelected = value === option.value;
					return (
						<Pressable
							accessibilityLabel={`${label} period ${option.label}`}
							accessibilityRole="button"
							accessibilityState={{ selected: isSelected }}
							key={option.value}
							onPress={() => onChange(option.value)}
							style={[styles.segment, isSelected && styles.segmentActive]}
						>
							<Text
								style={[
									styles.segmentLabel,
									isSelected && styles.segmentLabelActive,
								]}
							>
								{option.label}
							</Text>
						</Pressable>
					);
				})}
			</View>
			{error ? <Text style={styles.fieldError}>{error}</Text> : null}
		</View>
	);
}

export function RequestAbsenceScreen({
	categories,
	vacationBalance,
	isSubmitting,
	submitErrorMessage,
	onBack,
	onSubmit,
}: RequestAbsenceScreenProps) {
	const [activeDatePicker, setActiveDatePicker] =
		useState<DateFieldName | null>(null);
	const [validationErrors, setValidationErrors] =
		useState<RequestAbsenceFormErrors>({});
	const validate = createRequestAbsenceFormValidator();
	const form = useForm({
		defaultValues: createRequestAbsenceFormValues(),
		onSubmit: async ({ value }) => {
			const nextErrors = validate(value);

			setValidationErrors(nextErrors);

			if (Object.keys(nextErrors).length > 0) {
				return;
			}

			await onSubmit(createRequestAbsencePayload(value));
			form.reset();
			setValidationErrors({});
		},
	});
	const errorSummary = useMemo(() => {
		const messages = Object.values(validationErrors).filter(Boolean);

		if (submitErrorMessage) {
			messages.push(submitErrorMessage);
		}

		if (messages.length === 0) {
			return null;
		}

		return messages.join(" ");
	}, [submitErrorMessage, validationErrors]);

	return (
		<Host style={styles.container}>
			<ScrollView
				contentContainerStyle={styles.content}
				style={styles.container}
			>
				<Column spacing={16}>
					<RequestAbsenceHeader remainingDays={vacationBalance.remainingDays} />

					<FieldGroup style={styles.fieldGroupSurface}>
						<Column spacing={16}>
							{errorSummary ? (
								<Text
									accessibilityLiveRegion="polite"
									accessibilityRole="alert"
									style={styles.fieldError}
								>
									{errorSummary}
								</Text>
							) : null}

							<form.Field name="categoryId">
								{(field) => (
									<AbsenceCategorySelector
										categories={categories}
										error={validationErrors.categoryId}
										onChange={(categoryId) => {
											field.handleChange(categoryId);
											setValidationErrors((current) => ({
												...current,
												categoryId: undefined,
											}));
										}}
										value={field.state.value}
									/>
								)}
							</form.Field>

							<form.Field name="startDate">
								{(field) => (
									<AbsenceDateField
										active={activeDatePicker === "startDate"}
										error={validationErrors.startDate}
										fieldName="startDate"
										label="Start date"
										onDismiss={() => setActiveDatePicker(null)}
										onOpen={() => setActiveDatePicker("startDate")}
										onSelect={(selectedDate) => {
											field.handleChange(pickerDateToIsoDate(selectedDate));
											setValidationErrors((current) => ({
												...current,
												startDate: undefined,
											}));
											setActiveDatePicker(null);
										}}
										value={field.state.value}
									/>
								)}
							</form.Field>

							<form.Field name="startPeriod">
								{(field) => (
									<AbsencePeriodSelector
										label="Start"
										onChange={field.handleChange}
										value={field.state.value}
									/>
								)}
							</form.Field>

							<form.Field name="endDate">
								{(field) => (
									<AbsenceDateField
										active={activeDatePicker === "endDate"}
										error={validationErrors.endDate}
										fieldName="endDate"
										label="End date"
										onDismiss={() => setActiveDatePicker(null)}
										onOpen={() => setActiveDatePicker("endDate")}
										onSelect={(selectedDate) => {
											field.handleChange(pickerDateToIsoDate(selectedDate));
											setValidationErrors((current) => ({
												...current,
												endDate: undefined,
												endPeriod: undefined,
											}));
											setActiveDatePicker(null);
										}}
										value={field.state.value}
									/>
								)}
							</form.Field>

							<form.Field name="endPeriod">
								{(field) => (
									<AbsencePeriodSelector
										error={validationErrors.endPeriod}
										label="End"
										onChange={(period) => {
											field.handleChange(period);
											setValidationErrors((current) => ({
												...current,
												endPeriod: undefined,
											}));
										}}
										value={field.state.value}
									/>
								)}
							</form.Field>

							<form.Field name="notes">
								{(field) => (
									<View style={styles.section}>
										<Text style={styles.label}>Notes</Text>
										<TextInput
											multiline
											accessibilityLabel="Notes"
											onChangeText={field.handleChange}
											placeholder="Add context if needed…"
											style={[styles.input, styles.notesInput]}
											textAlignVertical="top"
											value={field.state.value}
										/>
									</View>
								)}
							</form.Field>

							<Row spacing={10}>
								<Button
									label="Back"
									onPress={onBack}
									style={styles.actionButton}
									variant="outlined"
								/>
								<Button
									disabled={isSubmitting}
									label={isSubmitting ? "Submitting…" : "Submit Request"}
									onPress={() => void form.handleSubmit()}
									style={
										isSubmitting
											? styles.actionButtonDisabled
											: styles.actionButton
									}
								/>
							</Row>
						</Column>
					</FieldGroup>
				</Column>
			</ScrollView>
		</Host>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#f8fafc",
	},
	content: {
		padding: 20,
		gap: 16,
	},
	headerSurface: {
		padding: 18,
		gap: 12,
		borderRadius: 16,
		borderWidth: 1,
		borderColor: "#dbe2f0",
		backgroundColor: "#ffffff",
	},
	eyebrow: {
		fontSize: 13,
		fontWeight: "600",
		letterSpacing: 0.3,
		color: "#3730a3",
		textTransform: "uppercase",
	},
	title: {
		fontSize: 24,
		lineHeight: 29,
		fontWeight: "700",
		color: "#0f172a",
	},
	description: {
		fontSize: 14,
		lineHeight: 20,
		color: "#475569",
	},
	balanceRow: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
		borderRadius: 12,
		borderWidth: 1,
		borderColor: "#e2e8f0",
		padding: 12,
		backgroundColor: "#f8fafc",
	},
	balanceLabel: {
		fontSize: 14,
		color: "#475569",
	},
	balanceValue: {
		fontSize: 15,
		fontWeight: "700",
		color: "#0f172a",
	},
	fieldGroupSurface: {
		borderRadius: 16,
		borderWidth: 1,
		borderColor: "#dbe2f0",
		padding: 18,
		backgroundColor: "#ffffff",
	},
	section: {
		gap: 8,
	},
	helperText: {
		fontSize: 13,
		lineHeight: 18,
		color: "#64748b",
	},
	label: {
		fontSize: 14,
		fontWeight: "600",
		color: "#0f172a",
	},
	chipWrap: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 8,
	},
	choiceChip: {
		borderRadius: 10,
		borderWidth: 1,
		borderColor: "#dbe2f0",
		paddingHorizontal: 12,
		paddingVertical: 10,
		backgroundColor: "#f8fafc",
	},
	choiceChipActive: {
		borderColor: "#c7d2fe",
		backgroundColor: "#eef2ff",
	},
	choiceChipLabel: {
		fontSize: 13,
		fontWeight: "600",
		color: "#334155",
	},
	choiceChipLabelActive: {
		color: "#3730a3",
	},
	input: {
		borderRadius: 12,
		borderWidth: 1,
		borderColor: "#cbd5e1",
		paddingHorizontal: 12,
		paddingVertical: 12,
		fontSize: 15,
		color: "#0f172a",
		backgroundColor: "#f8fafc",
	},
	dateInput: {
		borderRadius: 12,
		borderWidth: 1,
		borderColor: "#cbd5e1",
		paddingHorizontal: 12,
		paddingVertical: 12,
		backgroundColor: "#f8fafc",
	},
	dateInputText: {
		fontSize: 15,
		color: "#0f172a",
	},
	dateHelperText: {
		fontSize: 12,
		lineHeight: 16,
		color: "#64748b",
	},
	notesInput: {
		minHeight: 96,
	},
	segmentedControl: {
		flexDirection: "row",
		gap: 8,
	},
	segment: {
		flex: 1,
		alignItems: "center",
		borderRadius: 10,
		borderWidth: 1,
		borderColor: "#dbe2f0",
		paddingVertical: 10,
		backgroundColor: "#f8fafc",
	},
	segmentActive: {
		borderColor: "#c7d2fe",
		backgroundColor: "#eef2ff",
	},
	segmentLabel: {
		fontSize: 13,
		fontWeight: "600",
		color: "#475569",
	},
	segmentLabelActive: {
		color: "#3730a3",
	},
	fieldError: {
		fontSize: 13,
		lineHeight: 18,
		color: "#b91c1c",
	},
	actionButton: {
		width: "48%",
		borderRadius: 12,
		paddingVertical: 14,
	},
	actionButtonDisabled: {
		width: "48%",
		borderRadius: 12,
		paddingVertical: 14,
		opacity: 0.55,
	},
});
