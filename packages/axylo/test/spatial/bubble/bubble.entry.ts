/**
 * The bubble chart from source, for the Chrome test (test/browser/chart/n8b-bubble.browser.test.ts): the package
 * has no `axylo/spatial` entry yet (the Director wires it), so the test bundles this file with openEntry.
 */
import { bubble, bubbleInternals, validateBubble } from '../../../src/spatial/bubble';

declare global {
  interface Window {
    n8b: {
      bubble: typeof bubble;
      bubbleInternals: typeof bubbleInternals;
      validateBubble: typeof validateBubble;
    };
  }
}

window.n8b = { bubble, bubbleInternals, validateBubble };
