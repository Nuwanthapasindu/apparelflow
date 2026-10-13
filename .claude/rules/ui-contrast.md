---
paths:
  - "src/app/**/*.tsx"
  - "src/components/**"
  - "src/app/**/*.css"
---

# UI, contrast and usability rules

**Zero-tolerance defect: any input, dropdown or focus state with low contrast (white-on-white). Fix it immediately and mention it in `AI_NOTES.md` if AI generated it.**

## Inputs, selects, textareas, search, dropdown options
- Explicit styles on every one, never inherited: `bg-white text-gray-900 border-gray-400 placeholder-gray-500`, a clearly visible focus ring (not removed), and a distinct disabled style that is still legible.
- Set `color-scheme: light` on the app so OS dark mode cannot turn text white on a white field. Style `<option>` elements explicitly too.
- Use `type="text"` with `inputMode="numeric"` or `"decimal"` rather than `type="number"`.
- Inline validation errors appear immediately next to the field (dark red text with an icon, linked via `aria-describedby`), and inputs reject negatives, decimals (piece counts), non-numeric strings and empty values.

## Users and context
Primary users are factory staff under time pressure, often on tablets or shared terminals. Large touch targets; Approve and Reject separated clearly; no clutter. Design every state: empty, loading, in-progress, pending verification, RED, YELLOW, verified, rejected, in sewing.

## Traffic lights and badges (reuse, don't reinvent)
- GREEN match, YELLOW excess, RED shortage: colour **plus** icon **plus** text, never colour alone.
- RED and YELLOW are reserved for component status. Wastage over cap uses a separate amber "OVER CAP" badge with icon and text.
- **Approve Batch** is disabled whenever any component is RED or uncounted (with a visible reason). **Reject Batch** requires a note and shows an inline error if empty. Both are mirrored by the server; the UI is not the security boundary.

## Role-based visibility
Verifier sees no create-order button. Sewing Supervisor never sees pending, unverified or rejected orders. Cutting Supervisor and Verifier never see the Sewing Queue. Hiding is for usability only; every rule is enforced on the server.

## Role Switcher / demo panel
A visible panel listing the three demo logins. Each button calls the real login endpoint (revoking the current session first) and reloads. It never changes a client-side role variable.

## Layout
Responsive from tablet to desktop. Keep an established pattern once chosen (badges, tables, modals); call out inconsistency rather than introducing a new style.
