"use client";

import type * as LabelPrimitive from "@radix-ui/react-label";
import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Use a simplified field type for the form components
// The TanStack Form FieldApi has complex generics, so we define a minimal interface
// that covers what our form UI components need
interface FieldApiLike {
	state: {
		meta: {
			errors: unknown[];
		};
	};
}

/**
 * Form UI components for @tanstack/react-form
 *
 * These components provide a similar API to the react-hook-form components
 * but are designed to work with TanStack Form's field API.
 *
 * Usage:
 * ```tsx
 * <form.Field name="firstName">
 *   {(field) => (
 *     <TFormItem>
 *       <TFormLabel>First Name</TFormLabel>
 *       <TFormControl>
 *         <Input
 *           value={field.state.value}
 *           onChange={(e) => field.handleChange(e.target.value)}
 *           onBlur={field.handleBlur}
 *         />
 *       </TFormControl>
 *       <TFormDescription>Enter your first name</TFormDescription>
 *       <TFormMessage field={field} />
 *     </TFormItem>
 *   )}
 * </form.Field>
 * ```
 */

// Context for sharing field ID between components
type TFormItemContextValue = {
	id: string;
};

const TFormItemContext = React.createContext<TFormItemContextValue>({} as TFormItemContextValue);

/**
 * Wrapper component for form fields - provides ID context for accessibility
 */
function TFormItem({ className, ...props }: React.ComponentProps<"div">) {
	const id = React.useId();

	return (
		<TFormItemContext.Provider value={{ id }}>
			<div data-slot="form-item" className={cn("grid gap-2", className)} {...props} />
		</TFormItemContext.Provider>
	);
}

/**
 * Hook to access form item context
 */
function useTFormItem() {
	const context = React.useContext(TFormItemContext);
	if (!context.id) {
		throw new Error("useTFormItem must be used within <TFormItem>");
	}
	return context;
}

/**
 * Form label with error state styling
 */
function TFormLabel({
	className,
	hasError,
	...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & { hasError?: boolean }) {
	const { id } = useTFormItem();

	return (
		<Label
			data-slot="form-label"
			data-error={hasError}
			className={cn("data-[error=true]:text-destructive", className)}
			htmlFor={`${id}-form-item`}
			{...props}
		/>
	);
}

/**
 * Wrapper for form control elements - adds accessibility attributes
 */
function TFormControl({
	hasError,
	...props
}: React.ComponentProps<typeof Slot> & { hasError?: boolean }) {
	const { id } = useTFormItem();
	const formItemId = `${id}-form-item`;
	const formDescriptionId = `${id}-form-item-description`;
	const formMessageId = `${id}-form-item-message`;

	return (
		<Slot
			data-slot="form-control"
			id={formItemId}
			aria-describedby={!hasError ? formDescriptionId : `${formDescriptionId} ${formMessageId}`}
			aria-invalid={hasError}
			{...props}
		/>
	);
}

/**
 * Help text for form fields
 */
function TFormDescription({ className, ...props }: React.ComponentProps<"p">) {
	const { id } = useTFormItem();

	return (
		<p
			data-slot="form-description"
			id={`${id}-form-item-description`}
			className={cn("text-muted-foreground text-sm", className)}
			{...props}
		/>
	);
}

/**
 * Error message display for form fields
 *
 * Can either receive a `field` prop to auto-extract errors,
 * or display custom children as the error message.
 */
function TFormMessage({
	className,
	field,
	children,
	...props
}: React.ComponentProps<"p"> & {
	field?: FieldApiLike;
}) {
	const { id } = useTFormItem();

	// Get error message from field state or use children
	const errors = field?.state.meta.errors;
	const errorMessages = errors?.filter((e): e is string => typeof e === "string");
	const errorMessage = errorMessages?.length ? errorMessages.join(", ") : null;
	const body = errorMessage ?? children;

	if (!body) {
		return null;
	}

	return (
		<p
			role="alert"
			aria-live="polite"
			data-slot="form-message"
			id={`${id}-form-item-message`}
			className={cn("text-destructive text-sm", className)}
			{...props}
		>
			{body}
		</p>
	);
}

/**
 * Helper to check if a field has errors
 */
function fieldHasError(field: FieldApiLike): boolean {
	return field.state.meta.errors.length > 0;
}

export {
	TFormItem,
	TFormLabel,
	TFormControl,
	TFormDescription,
	TFormMessage,
	useTFormItem,
	fieldHasError,
};
