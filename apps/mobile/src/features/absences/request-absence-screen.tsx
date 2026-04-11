import { useMemo, useState } from "react";
import { useForm } from "@tanstack/react-form";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import {
  createRequestAbsencePayload,
  createRequestAbsenceFormValidator,
  createRequestAbsenceFormValues,
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

const PERIOD_OPTIONS: Array<{ value: MobileAbsenceDayPeriod; label: string }> = [
  { value: "full_day", label: "Full day" },
  { value: "am", label: "AM" },
  { value: "pm", label: "PM" },
];

export function RequestAbsenceScreen({
  categories,
  vacationBalance,
  isSubmitting,
  submitErrorMessage,
  onBack,
  onSubmit,
}: RequestAbsenceScreenProps) {
  const [validationErrors, setValidationErrors] = useState<RequestAbsenceFormErrors>({});
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
    <ScrollView contentContainerStyle={styles.content} style={styles.container}>
      <View style={styles.headerSurface}>
        <Text style={styles.eyebrow}>Request absence</Text>
        <Text style={styles.title}>Submit a time-off request</Text>
        <Text style={styles.description}>
          Keep the request short and precise so it can be reviewed quickly.
        </Text>

        <View style={styles.balanceRow}>
          <Text style={styles.balanceLabel}>Remaining vacation</Text>
          <Text style={styles.balanceValue}>{vacationBalance.remainingDays} days</Text>
        </View>
      </View>

      <View style={styles.formSurface}>
        {errorSummary ? (
          <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.fieldError}>
            {errorSummary}
          </Text>
        ) : null}

        <form.Field name="categoryId">
          {(field) => (
            <View style={styles.section}>
              <Text style={styles.label}>Absence type</Text>
              <View style={styles.chipWrap}>
                {categories.map((category) => {
                  const isSelected = field.state.value === category.id;

                  return (
                    <Pressable
                      accessibilityLabel={category.name}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      key={category.id}
                      onPress={() => {
                        field.handleChange(category.id);
                        setValidationErrors((current) => ({ ...current, categoryId: undefined }));
                      }}
                      style={[styles.choiceChip, isSelected && styles.choiceChipActive]}
                    >
                      <Text style={[styles.choiceChipLabel, isSelected && styles.choiceChipLabelActive]}>
                        {category.name}
                      </Text>
                    </Pressable>
                  );
                })}
                {categories.length === 0 ? (
                  <Text style={styles.helperText}>No absence types available right now.</Text>
                ) : null}
              </View>
              {validationErrors.categoryId ? (
                <Text style={styles.fieldError}>{validationErrors.categoryId}</Text>
              ) : null}
            </View>
          )}
        </form.Field>

        <form.Field name="startDate">
          {(field) => (
            <View style={styles.section}>
              <Text style={styles.label}>Start date</Text>
              <TextInput
                autoCapitalize="none"
                accessibilityLabel="Start date"
                keyboardType="numbers-and-punctuation"
                onChangeText={(value) => {
                  field.handleChange(value);
                  setValidationErrors((current) => ({ ...current, startDate: undefined }));
                }}
                placeholder="YYYY-MM-DD…"
                style={styles.input}
                value={field.state.value}
              />
              {validationErrors.startDate ? (
                <Text style={styles.fieldError}>{validationErrors.startDate}</Text>
              ) : null}
            </View>
          )}
        </form.Field>

        <form.Field name="startPeriod">
          {(field) => (
            <View style={styles.section}>
              <Text style={styles.label}>Start period</Text>
              <View style={styles.segmentedControl}>
                {PERIOD_OPTIONS.map((option) => {
                  const isSelected = field.state.value === option.value;

                  return (
                    <Pressable
                      accessibilityLabel={`Start period ${option.label}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      key={option.value}
                      onPress={() => field.handleChange(option.value)}
                      style={[styles.segment, isSelected && styles.segmentActive]}
                    >
                      <Text style={[styles.segmentLabel, isSelected && styles.segmentLabelActive]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
        </form.Field>

        <form.Field name="endDate">
          {(field) => (
            <View style={styles.section}>
              <Text style={styles.label}>End date</Text>
              <TextInput
                autoCapitalize="none"
                accessibilityLabel="End date"
                keyboardType="numbers-and-punctuation"
                onChangeText={(value) => {
                  field.handleChange(value);
                  setValidationErrors((current) => ({ ...current, endDate: undefined, endPeriod: undefined }));
                }}
                placeholder="YYYY-MM-DD…"
                style={styles.input}
                value={field.state.value}
              />
              {validationErrors.endDate ? (
                <Text style={styles.fieldError}>{validationErrors.endDate}</Text>
              ) : null}
            </View>
          )}
        </form.Field>

        <form.Field name="endPeriod">
          {(field) => (
            <View style={styles.section}>
              <Text style={styles.label}>End period</Text>
              <View style={styles.segmentedControl}>
                {PERIOD_OPTIONS.map((option) => {
                  const isSelected = field.state.value === option.value;

                  return (
                    <Pressable
                      accessibilityLabel={`End period ${option.label}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      key={option.value}
                      onPress={() => {
                        field.handleChange(option.value);
                        setValidationErrors((current) => ({ ...current, endPeriod: undefined }));
                      }}
                      style={[styles.segment, isSelected && styles.segmentActive]}
                    >
                      <Text style={[styles.segmentLabel, isSelected && styles.segmentLabelActive]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {validationErrors.endPeriod ? (
                <Text style={styles.fieldError}>{validationErrors.endPeriod}</Text>
              ) : null}
            </View>
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

        <View style={styles.actions}>
          <Pressable accessibilityLabel="Go back" accessibilityRole="button" onPress={onBack} style={styles.secondaryAction}>
            <Text style={styles.secondaryActionLabel}>Back</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Submit Request"
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={() => void form.handleSubmit()}
            style={[styles.primaryAction, isSubmitting && styles.actionDisabled]}
          >
            <Text style={styles.primaryActionLabel}>
              {isSubmitting ? "Submitting…" : "Submit Request"}
            </Text>
          </Pressable>
        </View>
      </View>
    </ScrollView>
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
  formSurface: {
    gap: 16,
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
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  secondaryAction: {
    flex: 1,
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    paddingVertical: 14,
    backgroundColor: "#f8fafc",
  },
  secondaryActionLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#334155",
  },
  primaryAction: {
    flex: 1,
    alignItems: "center",
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: "#3730a3",
  },
  primaryActionLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: "#ffffff",
  },
  actionDisabled: {
    opacity: 0.55,
  },
});
