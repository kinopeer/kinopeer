---
paths:
  - "**/*.css"
  - "src/**/*.tsx"
  - "src/lib/{breakpoints,useIsDesktop,stubDesktop}.ts"
  - "e2e/**"
---

# Styles and layout in code

How the design (`CLAUDE.md` → Design) is written in code. Claude Code loads this file with any stylesheet or component.

- Spacing (`gap`, `padding`, `margin`) and radii go through the tokens in `src/styles/tokens.css` (`var(--space-N)`, `var(--r-*)`). A raw px value is for what the scale doesn't have (an offset made of other elements' sizes), with a comment on its line saying why; `src/styles/tokens.test.ts` checks both, and also that colors, shadows (`--shadow-*`; a ring or a tint drawn with `box-shadow` is fine) and the durations and easings of transitions and animations come from `tokens.css` (or carry such a comment), and that every `var(--x)` names a property a stylesheet defines or the app's code sets. A token added, changed or removed, and a raw value a branch lets through with such a comment, are judged by the deputy, and the PR says why the scale doesn't have the value (the checks guard: `docs/QUALITY.md` → What it marks).
- Type goes through the design system's roles, `--t-display` … `--t-mono` in `tokens.css` (a `font` shorthand each, plus `--t-*-tracking` where the role has letter-spacing): a screen's text gets the `t-*` class (`src/styles/base.css`) in the TSX, a component's own text gets `font: var(--t-*)` in its stylesheet, so its look stays in its CSS. The role sets the size, line-height and family; an element's weight is its own (`font-weight` after the role). The `font` shorthand resets `font-variant-numeric`, so an element that also needs `ks-num` takes the class, or sets tabular figures after the shorthand. A raw `font-size` or `line-height` in px is for what a role can't express (16px in inputs, so iOS Safari doesn't zoom), with a comment; the same test checks it.
- Space between siblings comes from their parent's `gap` (flex or grid), one value on the wrapper, not from margins on the children: a child with a `margin-top` to "fix" its distance is a sign the wrapper's `gap` is wrong. Margins are for exceptions (a negative offset, an element that leaves the flow), with a comment. When porting from the canvas, don't copy its inline margins.
- Desktop layout from 1024px (`DESKTOP_QUERY` in `src/lib/breakpoints.ts`; stylesheets repeat it as `@media (min-width: 1024px)`, since media queries can't use custom properties). There `App` renders `Sidebar` (`ks-side`, an icon rail up to 1100px, then 248px with labels) in place of `TabBar`. `useIsDesktop()` (`src/lib/useIsDesktop.ts`) is for behavior that differs on desktop (what renders); differences only in looks stay in CSS. In tests jsdom has no matchMedia, so the phone layout applies unless a test calls `stubDesktop()` (`src/lib/stubDesktop.ts`). Fixed elements offset themselves by `--nav-left` (the sidebar's width, 0 on phones) and `--nav-bottom` (the tab bar's height, 0 on desktop) from `layout.css`, beside the other layout and runtime properties, which aren't design tokens. Screenshot tests use `DESKTOP` (1440×900) and `DESKTOP_RAIL` (1024×768) from `e2e/app.ts`.
- Below the desktop breakpoint, screens sit in a centered column of `--column` width on wide screens; the tab bar's tabs stay over it.
- Font: Onest. Numbers that update (speeds, sizes, percentages) use tabular figures.
