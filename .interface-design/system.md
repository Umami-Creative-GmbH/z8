# Z8 Design System

## Direction

**Slate & Indigo** — professional, calm, with material presence.

Z8 is a daily-use workforce management tool. The interface should feel like a quality instrument — structured but not sterile, composed but not lifeless. Surfaces feel made of something (blue-slate) rather than absent of everything (zinc).

### Who uses this
HR managers, team leads, and employees at German companies. They open this every morning to clock in, check it between meetings, run reports at month-end. It's routine and structural, but it touches something personal: people's time.

### Feel
Like a well-organized desk — not sterile, not chaotic. Composed quality. The reliability of a good clock face, the calm of an organized planner.

---

## Color Philosophy

### Neutral base: Blue-Slate
All neutrals sit at **hue ~260** with chroma **0.005-0.025** (OKLCH). This replaces the default shadcn zinc (hue 286, chroma ~0.005). The shift is subtle but gives every surface a sense of material rather than absence.

### Brand: Deep Indigo
Primary is **hue 265, chroma 0.17-0.18**. This is the brand — buttons, links, focus rings, active states. It stays indigo in both light and dark mode for consistency (lightness adjusts, identity doesn't).

### Domain palette
These five colors form the semantic and chart palette:

| Name | Role | Hue | Origin |
|------|------|-----|--------|
| Indigo | Brand, primary actions, chart-1 | 265 | Clock-face depth, official ink |
| Teal | Confirmation, chart-2 | 180-185 | Approval status, productive flow |
| Amber | Pending, warmth, chart-3 | 75-80 | Afternoon light, earned time |
| Sage | Balance, wellness, chart-4 | 155 | Available days, healthy margins |
| Coral | Attention, urgency, chart-5 | 22-27 | Human warmth, gentle urgency |

---

## Depth Strategy

**Borders-only** with subtle surface elevation.

- Cards lift above background via lightness difference (0.995 vs 0.98 in light mode), not shadow
- Borders use low-opacity slate (`oklch(0.905 0.012 260)`) — visible on inspection, invisible at a glance
- Dark mode borders use transparent white (`oklch(1 0 0 / 10%)`) to adapt to any surface
- No drop shadows on cards. No mixed depth approaches.

---

## Spacing

Base unit: Tailwind's default `--spacing` (0.25rem = 4px). All spacing uses multiples of this via Tailwind classes.

---

## Typography

System defaults via shadcn/Next.js. No custom typeface decision made yet — revisit if brand identity needs strengthening beyond color.

---

## Border Radius

`--radius: 0.625rem` (10px) as the base. Scale:
- `--radius-sm`: 6px (inputs, small controls)
- `--radius-md`: 8px (buttons, badges)
- `--radius-lg`: 10px (cards, dialogs)
- `--radius-xl`: 14px (modals, large containers)

---

## Token Reference

### Light Mode (:root)

```css
--background: oklch(0.98 0.005 260);
--foreground: oklch(0.16 0.02 260);
--card: oklch(0.995 0.003 260);
--card-foreground: oklch(0.16 0.02 260);
--popover: oklch(0.995 0.003 260);
--popover-foreground: oklch(0.16 0.02 260);
--primary: oklch(0.45 0.17 265);
--primary-foreground: oklch(0.985 0.008 265);
--secondary: oklch(0.955 0.012 260);
--secondary-foreground: oklch(0.20 0.02 260);
--muted: oklch(0.965 0.008 260);
--muted-foreground: oklch(0.55 0.025 260);
--accent: oklch(0.94 0.025 265);
--accent-foreground: oklch(0.20 0.02 260);
--destructive: oklch(0.577 0.235 27);
--border: oklch(0.905 0.012 260);
--input: oklch(0.905 0.012 260);
--ring: oklch(0.55 0.12 265);
--chart-1: oklch(0.55 0.18 265);   /* indigo */
--chart-2: oklch(0.65 0.12 185);   /* teal */
--chart-3: oklch(0.75 0.15 80);    /* amber */
--chart-4: oklch(0.65 0.10 155);   /* sage */
--chart-5: oklch(0.65 0.15 25);    /* coral */
```

### Dark Mode (.dark)

```css
--background: oklch(0.155 0.015 260);
--foreground: oklch(0.985 0.008 260);
--card: oklch(0.195 0.015 260);
--card-foreground: oklch(0.985 0.008 260);
--popover: oklch(0.195 0.015 260);
--popover-foreground: oklch(0.985 0.008 260);
--primary: oklch(0.55 0.18 265);
--primary-foreground: oklch(0.985 0.008 265);
--secondary: oklch(0.25 0.015 260);
--secondary-foreground: oklch(0.985 0.008 260);
--muted: oklch(0.25 0.015 260);
--muted-foreground: oklch(0.65 0.025 260);
--accent: oklch(0.25 0.025 265);
--accent-foreground: oklch(0.985 0.008 260);
--destructive: oklch(0.704 0.191 22);
--border: oklch(1 0 0 / 10%);
--input: oklch(1 0 0 / 15%);
--ring: oklch(0.55 0.12 265);
--chart-1: oklch(0.6 0.18 265);    /* indigo */
--chart-2: oklch(0.7 0.14 180);    /* teal */
--chart-3: oklch(0.78 0.14 80);    /* amber */
--chart-4: oklch(0.7 0.12 155);    /* sage */
--chart-5: oklch(0.7 0.15 22);     /* coral */
```

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-14 | Shifted neutrals from zinc (h286) to blue-slate (h260) | Surfaces feel like material, not absence |
| 2026-02-14 | Primary: deep indigo instead of near-black | Brand identity in every interactive element |
| 2026-02-14 | Consistent indigo primary across light/dark | Brand doesn't invert — only lightness adjusts |
| 2026-02-14 | Chart palette: indigo/teal/amber/sage/coral | Domain-derived colors, harmonized with brand |
| 2026-02-14 | Borders-only depth, no shadows | Dense tool interface — borders define, shadows distract |
