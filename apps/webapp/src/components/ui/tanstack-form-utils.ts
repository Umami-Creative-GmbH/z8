type FieldApiLike = {
	state: {
		meta: {
			errors: unknown[];
		};
	};
};

export function fieldHasError(field: FieldApiLike): boolean {
	return field.state.meta.errors.length > 0;
}
