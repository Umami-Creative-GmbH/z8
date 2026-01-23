# Forms: @tanstack/react-form

Use `@tanstack/react-form` for all forms. Migrate legacy `react-hook-form` when touching existing forms.

## UI Components

Use components from `src/components/ui/tanstack-form.tsx`:

- `TFormItem` - Wrapper with ID context for accessibility
- `TFormLabel` - Label with error state styling
- `TFormControl` - Input wrapper with aria attributes
- `TFormDescription` - Help text
- `TFormMessage` - Error display
- `fieldHasError` - Helper to check field errors

## Quick Reference

| react-hook-form | @tanstack/react-form |
|-----------------|----------------------|
| `useForm({ resolver: zodResolver(schema) })` | `useForm({ defaultValues })` |
| `<Controller render={({ field }) => ...} />` | `<form.Field children={(field) => ...} />` |
| `field.value` | `field.state.value` |
| `field.onChange(e)` | `field.handleChange(e.target.value)` |
| `form.formState.isDirty` | `<form.Subscribe selector={s => s.isDirty}>` |

## Pattern

```typescript
const form = useForm({
  defaultValues: { name: '', role: undefined as 'admin' | 'user' | undefined },
  onSubmit: async ({ value }) => { /* submit */ },
})

<form.Field name="name">
  {(field) => (
    <input
      value={field.state.value}
      onChange={(e) => field.handleChange(e.target.value)}
      onBlur={field.handleBlur}
    />
  )}
</form.Field>

<form.Subscribe selector={(state) => [state.isDirty, state.isSubmitting]}>
  {([isDirty, isSubmitting]) => (
    <button disabled={!isDirty || isSubmitting}>Save</button>
  )}
</form.Subscribe>
```
