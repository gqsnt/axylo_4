# Theming

After this page you can change a chart's colours and type with CSS custom properties, give a series the same colour on every chart, and know what Axylo does in dark mode, in forced-colours mode and in print, and why its default palette looks the way it does.

There is no theme object and no palette option. A chart takes its font and text colour from the page, as any element does, and everything else from CSS custom properties that you can set on the chart, on any ancestor, or on `:root`.

## The custom properties

Each colour property falls back to a default from Axylo's stylesheet, with one value for light charts and one for dark. The defaults below are read from the built stylesheet when this site is built.

[table: theme tokens](../data/tokens.mjs)

Values are any CSS colour, including `var()` references; a chart follows a variable when it changes, without a call. Colours of marks should keep at least 3:1 against the background behind the chart, and text 4.5:1. When the series colours fall below 3:1 against the background the chart actually sits on, Axylo raises [AX141](diagnostics.md#ax141).

[example: theme-tokens](../examples/theme-tokens.html)

## One colour per series name

The palette assigns colours by position: the first series gets the first colour. On a dashboard where charts show different subsets, "Referral" would change colour from chart to chart. `colors` pins a colour to a series name, so the same series looks the same everywhere:

```ts
const colors = { Direct: 'var(--brand-direct)', Referral: 'var(--brand-referral)' };
line('#a', { ...options, colors });
```

Series not named in `colors` take palette colours. A value the browser does not accept as a colour is replaced by the series' palette colour.

[example: theme-colors](../examples/theme-colors.html)

## Dark mode

Each chart decides on its own whether it is light or dark, from the page around it:

1. If `--axylo-background` is set, from that colour's lightness.
2. Otherwise from the chart element's computed `color-scheme`: `light` or `dark`; for `light dark`, the scheme the browser is using there.
3. Otherwise from the inherited text colour: light text means a dark page.

So a page that sets `color-scheme`, a page whose theme switch only changes classes and colours, and a light-only page on a device set to dark mode (which stays light) all get the right defaults. The chart repaints within a frame when the colour scheme, forced colours or the contrast preference change, and when the `class`, `style` or `data-theme` of `<html>` or `<body>` changes.

[example: theme-toggle](../examples/theme-toggle.html)

## Forced colours, high contrast and print

In forced-colours mode (Windows High Contrast and similar) every paint becomes a system colour, the colours you set included, and they come back when the mode ends. Series are then told apart by their markers and dashes. Under `prefers-contrast: more`, and in forced colours, lines also differ by dash.

Marks are drawn as SVG by default, so they stay sharp at any zoom and in print. There is no print stylesheet in 1.0, and printing has not been tested; the toolbar prints as it appears on screen.

## The default palette

[table: palette](../../../packages/axylo/src/theme/palette.ts)

Eight colours, in the order blue, orange, green, purple, red, cyan, magenta, slate, with the same family in the same slot in light and dark charts. They were fitted to measurable limits, not chosen by eye:

- each colour is at least 3:1 against the default light and dark backgrounds;
- every pair stays apart (OKLab difference of at least 0.10) under normal vision and under simulated protanopia, deuteranopia and tritanopia, and the first four, which most charts use, further apart still;
- they stay clear of the focus, reference and muted colours;
- neighbouring colours stay apart as translucent and solid fills.

Colour is never the only cue: lines and areas also carry marker shapes, adjacent fills are separated by background, and the legend and tooltip repeat the cues. The palette is a proposal that meets those limits; whether it is pleasant to look at is still open. The reasoning, the measurements and what was tried are in [decision 0003](../../../docs/decisions/0003-default-palette.md).

## Internal properties

The stylesheet also uses a few custom properties that are not for authors. They are listed so that you can recognise them in the developer tools; setting them is unsupported.

[table: internal tokens](../data/tokens.mjs)
