import React from "react";

type PrimitiveProps = Record<string, unknown> & { children?: React.ReactNode };

function createPrimitive(type: string) {
	return function Primitive({ children, ...props }: PrimitiveProps) {
		return React.createElement(type, props, children);
	};
}

export const Host = createPrimitive("Host");
export const Column = createPrimitive("Column");
export const Row = createPrimitive("Row");
export const Spacer = createPrimitive("Spacer");
export const ScrollView = createPrimitive("ScrollView");
export const Text = createPrimitive("Text");

export function Button({ label, children, onPress, disabled, ...props }: PrimitiveProps & {
	label?: string;
	onPress?: () => void;
	disabled?: boolean;
}) {
	return React.createElement(
		"Button",
		{ ...props, disabled, onPress: disabled ? undefined : onPress },
		children ?? label,
	);
}

export function List({ children, ...props }: PrimitiveProps) {
	return React.createElement("List", props, children);
}

export function ListItem({ children, supportingText, onPress, ...props }: PrimitiveProps & {
	supportingText?: React.ReactNode;
	onPress?: () => void;
}) {
	return React.createElement(
		"ListItem",
		{ ...props, onPress },
		children,
		supportingText ? React.createElement("Text", {}, supportingText) : null,
	);
}

ListItem.Leading = createPrimitive("ListItemLeading");
ListItem.Supporting = createPrimitive("ListItemSupporting");
ListItem.Trailing = createPrimitive("ListItemTrailing");

export function FieldGroup({ children, ...props }: PrimitiveProps) {
	return React.createElement("FieldGroup", props, children);
}

FieldGroup.Section = createPrimitive("FieldGroupSection");
FieldGroup.SectionHeader = createPrimitive("FieldGroupSectionHeader");
FieldGroup.SectionFooter = createPrimitive("FieldGroupSectionFooter");

export function TextInput({ value, defaultValue, onChangeText, ...props }: PrimitiveProps & {
	value?: { value: string } | string;
	defaultValue?: string;
	onChangeText?: (value: string) => void;
}) {
	const resolvedValue = typeof value === "object" && value ? value.value : value;
	return React.createElement("TextInput", {
		...props,
		defaultValue,
		onChangeText,
		value: resolvedValue,
	});
}

export function useNativeState<T>(initialValue: T) {
	return { value: initialValue };
}
