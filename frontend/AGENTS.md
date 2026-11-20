# Frontend Guidelines

## Design Principles

- Calm, dense, readable.
- Reuse existing patterns before inventing new ones.
- Prefer consistent hierarchy over one-off styling.

### Typography

- Page title: `text-2xl font-semibold tracking-tight`
- Section title: `text-xl font-semibold`
- Card title: `text-lg font-semibold`
- Body: `text-sm`
- Label: `text-sm font-medium`
- Meta: `text-xs text-gray-400`
- Use `font-sans` across product UI. The stack prefers Inter with system fallbacks.

### Surfaces

1. Page background: `bg-gray-900`
2. Primary card/surface: `bg-white/5`
3. Nested card/surface: `bg-white/5`

- Nested surfaces appear lighter because they sit on a lighter parent layer.
- Avoid more than 3 surface depths in one view.

### Spacing

- Primary card: `p-6`
- Nested card: `p-5`
- Dense inner content: `p-4`
- Section spacing: `gap-6` or `space-y-6`

### Responsive Behavior

- Check narrow widths/mobile before finishing UI changes.
- Avoid controls, charts, or tables spilling outside their card/container.
- Prefer wrapping or stacking over horizontal overflow when space gets tight.
- In split layouts, make shrinking children explicitly shrinkable (for example `min-w-0`).

### Text Color

- Primary: `text-white`
- Muted: `text-gray-400`
- Accent/link: `text-blue-400`

### Charts

- Use Chart.js for trend, comparison, and composition charts.
- Charts should feel dense and readable: responsive, subtle gridlines, muted axis labels, no wasted vertical space.
- Use dynamic y-axis bounds with a small buffer when the goal is to show movement clearly.
- Start at zero when showing absolute count magnitude is important.
- Normalize to 100% only for composition charts, and label normalized views clearly.
- Round y-axis bounds and tick steps to readable values.
