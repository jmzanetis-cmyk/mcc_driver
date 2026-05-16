# Patches for the main MCC repo

These patches are produced **here** in the driver project but are meant to
be applied **in the main MCC platform repo** (the one that owns
`docs/driver-app-style-guide.md` and `docs/driver-app-assets/driver-tokens.css`).

## `driver-tokens-a11y.patch`

Brings the canonical `docs/driver-app-assets/driver-tokens.css` in the
main MCC repo up to match what the driver app is already shipping:

1. Bumps `--text-muted` from `#6b7280` → `#9ca3af` so muted text passes
   WCAG AA on dark-mode card surfaces.
2. Adds a `:focus-visible` keyboard focus ring (2px gold halo).
3. Adds a `prefers-reduced-motion` media query that quiets animations
   for users who've enabled OS-level reduce-motion.

### Apply

From the root of the **main MCC repo**:

```bash
git apply docs/patches/driver-tokens-a11y.patch
# or, if applying from elsewhere:
git apply --directory=. /path/to/driver-tokens-a11y.patch
```

If `git apply` complains about whitespace, use `git apply --whitespace=fix`.

### Also update the style-guide doc

In the same PR, edit `docs/driver-app-style-guide.md` §2 → the dark-theme
color table, and change the `--text-muted` row from `#6b7280` to
`#9ca3af` so the documented value matches the CSS.

### Why this lives over here

These improvements were originally made in this driver project (in
`artifacts/driver/public/css/driver-tokens.css`) and the new style guide
tarball didn't carry them back. Per §9 of the style guide ("Keeping this
in sync with the main platform"), drift between the two files should be
reconciled in a single PR — this patch is that reconciliation,
authored on the driver-app side.
