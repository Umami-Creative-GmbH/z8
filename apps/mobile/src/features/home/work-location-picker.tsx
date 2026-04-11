import { Pressable, StyleSheet, Text, View } from "react-native";

import type { WorkLocationType } from "./use-home-query";

const WORK_LOCATION_OPTIONS: Array<{ label: string; value: WorkLocationType }> = [
  { label: "Office", value: "office" },
  { label: "Home", value: "home" },
  { label: "Field", value: "field" },
  { label: "Other", value: "other" },
];

interface WorkLocationPickerProps {
  selectedValue: WorkLocationType | null;
  disabled: boolean;
  onChange: (value: WorkLocationType) => void;
}

export function WorkLocationPicker({
  selectedValue,
  disabled,
  onChange,
}: WorkLocationPickerProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Work location</Text>
      <View style={styles.options}>
        {WORK_LOCATION_OPTIONS.map((option) => {
          const isSelected = option.value === selectedValue;

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled, selected: isSelected }}
              disabled={disabled}
              key={option.value}
              onPress={disabled ? undefined : () => onChange(option.value)}
              style={[styles.option, isSelected && styles.optionSelected, disabled && styles.optionDisabled]}
            >
              <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 10,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
  },
  options: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  option: {
    minWidth: 72,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    alignItems: "center",
  },
  optionSelected: {
    borderColor: "#2563eb",
    backgroundColor: "#eff6ff",
  },
  optionDisabled: {
    opacity: 0.6,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: "500",
    color: "#0f172a",
  },
  optionLabelSelected: {
    color: "#1d4ed8",
  },
});
