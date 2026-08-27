---
paths:
  - "garmin-dashboard/src/**/*.{ts,tsx}"
  - "garmin-stats/locales/*.json"
---

# Frontend i18n invariants

- **No hardcoded user-facing text in components.** Labels, tooltips, placeholders, buttons, empty states, errors, `title`, `placeholder`, `aria-label`, and user-visible catch fallbacks go through i18next `t()`.
- Use `t("namespace.key", "English default text", { var: value })`.
- Keys live in `garmin-stats/locales/en.json` and `it.json` as flat dotted keys. **Both locale files must always have the exact same key set.** Add/update both in the same edit.
- **Never put `{{var}}` placeholders in the `defaultValue` argument.** The not-ready `t` stub returns `defaultValue` verbatim. Use an already-interpolated JavaScript template literal as the default while still passing interpolation options for the loaded translation.
- **Never include `t` itself in a `useCallback` or `useEffect` dependency array.** Its identity is not reliably stable in every mount/loading scenario and can cause fetch/effect loops. If a stable callback needs it, access `t` through a ref.
- Exempt from translation: numeric/date/unit formatting handled by shared formatters; bare universal unit abbreviations; standalone brand/product names; backend/user-provided free text.
- Sport enum presentation remains a known separate gap; do not opportunistically mass-fix it outside an approved Story.
