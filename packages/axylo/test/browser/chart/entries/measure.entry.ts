/** The text measurer on its own in the page, for the late-font test (core/environment.ts). */
import { createMeasurer, noteFontLoad } from '../../../../src/core/environment';

declare global {
  interface Window {
    measure: { width(text: string, font: string): number; fontsLoaded(): void };
  }
}

const measurer = createMeasurer(document);
window.measure = {
  width: (text, font) => measurer.width(text, { font, letterSpacing: 0, wordSpacing: 0, lineHeight: 20 }),
  fontsLoaded: () => noteFontLoad(document),
};
