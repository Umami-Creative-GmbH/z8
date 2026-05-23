import { Button, Column, Row, Text } from "@expo/ui";
import { StyleSheet } from "react-native";

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
    <Column spacing={10}>
      <Text textStyle={styles.labelText}>Work location</Text>
      <Row spacing={8}>
        {WORK_LOCATION_OPTIONS.map((option) => {
          const isSelected = option.value === selectedValue;

          return (
            <Button
              disabled={disabled}
              key={option.value}
              label={isSelected ? `${option.label} selected` : option.label}
              onPress={() => onChange(option.value)}
              variant={isSelected ? "filled" : "outlined"}
            />
          );
        })}
      </Row>
    </Column>
  );
}

const styles = StyleSheet.create({
  labelText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
  },
});
