# Theming

After this page you can change a chart's colours and type with CSS custom properties, give a series the same colour on every chart, and know what Axylo does in dark mode, in forced-colours mode and in print, and why its default palette looks the way it does.

There is no theme object and no palette option. A chart takes its font and text colour from the page, as any element does, and everything else from CSS custom properties that you can set on the chart, on any ancestor, or on `:root`.

## The custom properties

Each colour property falls back to a default from Axylo's stylesheet, with one value for light charts and one for dark. The defaults below are read from the packed package's stylesheet when this site is built.

[table: theme tokens](../data/tokens.mjs)

Values are any CSS colour, including `var()` references; a chart follows a variable when it changes, without a call. Colours of marks should keep at least 3:1 against the background behind the chart, and text 4.5:1. When the series colours fall below 3:1 against the background the chart actually sits on, Axylo raises [AX141](diagnostics.md#ax141); when that background cannot be resolved (a background image on the way up), it does not judge.

[example: theme-tokens](../examples/theme-tokens.html)

## One colour per series

The palette assigns colours by position: the first series gets the first colour. On a dashboard where charts show different subsets, "Referral" would change colour from chart to chart. `colors` pins a colour to a series key, so the same series looks the same everywhere:

```ts
const colors = { Direct: 'var(--brand-direct)', Referral: 'var(--brand-referral)' };
line('#a', { ...options, colors });
```

The key is the series key: for long rows the `series` field's value (as above), for wide rows the field name, not its `label`, and for a donut the slice label. Series not named in `colors` take palette colours. A value the browser does not accept as a colour is replaced by the series' palette colour. A donut's generated "Other" slice always uses the muted colour.

[example: theme-colors](../examples/theme-colors.html)

With wide rows, key the colours by field name:

[example: wide-keys](../examples/wide-keys.html)

## Dark mode

Each chart decides on its own whether it is light or dark, from the page around it:

1. If `--axylo-background` is set, from that colour's lightness.
2. Otherwise from the chart element's computed `color-scheme`: `light` or `dark`; for `light dark`, the scheme the browser is using there.
3. Otherwise from the inherited text colour: light text means a dark page.

So a page that sets `color-scheme`, a page whose theme switch only changes classes and colours, and a light-only page on a device set to dark mode (which stays light) all get the right defaults. The chart looks again when `prefers-color-scheme`, `forced-colors` or `prefers-contrast` change, and when the `class`, `style` or `data-theme` attribute of the chart or any of its ancestors changes, and repaints in the next frame. A theme switch that changes none of these (a stylesheet swapped in, say) is not observed.

[example: theme-toggle](../examples/theme-toggle.html)

## Forced colours, high contrast and print

In forced-colours mode (Windows High Contrast and similar) every paint becomes a system colour, the colours you set included, and they come back when the mode ends. Series are then told apart by their markers, dashes and patterns. Under `prefers-contrast: more`, and in forced colours, lines also differ by dash. No example on this site emulates forced colours; the library's own browser tests do.

Marks are drawn as SVG paths, the provisional default of [decision 0002](../../../docs/decisions/0002-mark-renderer.md), which keeps them sharp at any zoom. There is no print stylesheet in 1.0, and printing has not been tested.

## The default palette

[table: palette](../../../packages/axylo/src/theme/palette.ts)

Eight colours, in the order blue, orange, green, purple, red, cyan, magenta, slate, with the same family in the same slot in light and dark charts. They were fitted to measurable limits, not chosen by eye, and each set is measured against its own scheme's default background:

- each colour is at least 3:1 against that background;
- every pair stays at least 0.10 apart in OKLab under normal vision and under simulated protanopia, deuteranopia and tritanopia, also after the simulated colours are rounded to 8-bit values; the first four, which most charts use, at least 0.14;
- each stays at least 0.10 from the focus, reference and muted colours;
- neighbouring colours stay at least 0.06 apart as 25% and 80% fills, as computed and as Chrome painted them.

The dark scheme's focus colour is a near-white, so that the first dark series could be an ordinary dark-mode blue. Colour is never the only cue: lines and areas also carry marker shapes, bars are told apart by position and named by the legend and tooltip (with fill patterns past the eighth series, and in a compact chart), adjacent fills are separated by background, and the legend and tooltip repeat the cues.

The owner adopted this palette on 2026-11-18, out of the candidates [decision 0003](../../../docs/decisions/0003-default-palette.md) measured, for a more even light scheme, a calmer first three colours and a neutral eighth. The record states what it costs: a louder light red and purple, a dimmer dark purple, tighter dark margins to the focus and muted colours, and a deeper dark first blue. The palette it replaced is kept there under "Superseded", with its measurements. An independent recomputation found all sixteen colours within the limits above ([review](../../../reviews/2026-11-18/impl/wp/palette-b.review.md)).

## Internal properties

The stylesheet also uses a few custom properties that are not for authors. They are listed so that you can recognise them in the developer tools; setting them is unsupported.

[table: internal tokens](../data/tokens.mjs)
