import type { Select } from "./select";

type SelectProps<Value = string, Multiple extends boolean | undefined = false> = Parameters<
	typeof Select<Value, Multiple>
>[0];

type AssertAssignable<_Actual extends Expected, Expected> = true;

export type SelectAcceptsNonNullStringHandler = AssertAssignable<
	{
		value: string;
		onValueChange: (value: string) => void;
	},
	SelectProps<string, false>
>;

export type SelectAcceptsNullableStringHandler = AssertAssignable<
	{
		value: string | null;
		onValueChange: (value: string | null) => void;
	},
	SelectProps<string | null, false>
>;
