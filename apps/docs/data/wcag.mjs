// The level A and AA success criteria of WCAG 2.2 (W3C Recommendation, 5 October 2023; 4.1.1 Parsing is
// obsolete and removed there), by number: name, level and, for a criterion the specification does not cite,
// why no test covers it (spec A9). Which criteria are cited, and the evidence for them, come from the
// specification and the acceptance checker (lib/conformance.mjs), not from here; the build fails when an
// uncited criterion has no reason.
//
// The reasons are the documentation's own judgement of what a chart component renders: NA (Axylo renders
// nothing the criterion is about), PAGE (it is decided by the page or site around the charts), and NOT
// ASSESSED (it can apply to a chart, and nothing checks it, so nothing is claimed).

const NA = 'not applicable to a chart component';
const PAGE = 'the page\'s responsibility';
const ASSESSED = 'not assessed';

export const wcag = {
  '1.1.1': ['Non-text Content', 'A'],
  '1.2.1': ['Audio-only and Video-only (Prerecorded)', 'A', NA, 'A chart has no audio or video.'],
  '1.2.2': ['Captions (Prerecorded)', 'A', NA, 'A chart has no audio or video.'],
  '1.2.3': ['Audio Description or Media Alternative (Prerecorded)', 'A', NA, 'A chart has no audio or video.'],
  '1.2.4': ['Captions (Live)', 'AA', NA, 'A chart has no audio or video.'],
  '1.2.5': ['Audio Description (Prerecorded)', 'AA', NA, 'A chart has no audio or video.'],
  '1.3.1': ['Info and Relationships', 'A'],
  '1.3.2': ['Meaningful Sequence', 'A'],
  '1.3.3': ['Sensory Characteristics', 'A', ASSESSED, 'It can apply to the plot\'s instructions and the messages; no test is cited for it.'],
  '1.3.4': ['Orientation', 'AA', ASSESSED, 'Responsive sizing is tested, but no test exercises a restriction to one orientation.'],
  '1.3.5': ['Identify Input Purpose', 'AA', NA, 'The chart\'s one text field ("Jump to") asks for an x value, nothing about the user.'],
  '1.4.1': ['Use of Color', 'A'],
  '1.4.2': ['Audio Control', 'A', NA, 'A chart plays no audio.'],
  '1.4.3': ['Contrast (Minimum)', 'AA'],
  '1.4.4': ['Resize Text', 'AA'],
  '1.4.5': ['Images of Text', 'AA', ASSESSED, 'It can apply to the chart\'s labels; no test is cited for it.'],
  '1.4.10': ['Reflow', 'AA'],
  '1.4.11': ['Non-text Contrast', 'AA'],
  '1.4.12': ['Text Spacing', 'AA'],
  '1.4.13': ['Content on Hover or Focus', 'AA'],
  '2.1.1': ['Keyboard', 'A'],
  '2.1.2': ['No Keyboard Trap', 'A'],
  '2.1.4': ['Character Key Shortcuts', 'A', ASSESSED, 'The zoom keys (+, - and 0) act only while the plot has focus, but no test establishes that protection.'],
  '2.2.1': ['Timing Adjustable', 'A', NA, 'A chart sets no time limit. Moving content, such as a stream, is 2.2.2.'],
  '2.2.2': ['Pause, Stop, Hide', 'A'],
  '2.3.1': ['Three Flashes or Below Threshold', 'A', ASSESSED, 'It can apply to drawing and to streamed updates; no test is cited for it.'],
  '2.4.1': ['Bypass Blocks', 'A', PAGE, 'Skipping repeated blocks is done by the page around the charts.'],
  '2.4.2': ['Page Titled', 'A', PAGE, 'A chart does not set the page\'s title.'],
  '2.4.3': ['Focus Order', 'A'],
  '2.4.4': ['Link Purpose (In Context)', 'A', NA, 'A chart contains no links.'],
  '2.4.5': ['Multiple Ways', 'AA', PAGE, 'How a set of pages can be reached is the site\'s.'],
  '2.4.6': ['Headings and Labels', 'AA'],
  '2.4.7': ['Focus Visible', 'AA'],
  '2.4.11': ['Focus Not Obscured (Minimum)', 'AA'],
  '2.5.1': ['Pointer Gestures', 'A'],
  '2.5.2': ['Pointer Cancellation', 'A', ASSESSED, 'One test cancels a drag in progress and checks that the view is unchanged after release; no test covers the other pointer actions.'],
  '2.5.3': ['Label in Name', 'A'],
  '2.5.4': ['Motion Actuation', 'A', NA, 'Nothing in a chart responds to moving the device.'],
  '2.5.7': ['Dragging Movements', 'AA'],
  '2.5.8': ['Target Size (Minimum)', 'AA'],
  '3.1.1': ['Language of Page', 'A', PAGE, 'The page\'s language is set by the page; the chart marks its own English text (3.1.2).'],
  '3.1.2': ['Language of Parts', 'AA'],
  '3.2.1': ['On Focus', 'A', ASSESSED, 'It can apply to focus in the plot and the toolbar; no test is cited for it.'],
  '3.2.2': ['On Input', 'A', ASSESSED, 'It can apply to the table\'s "Jump to" field and pager; no test is cited for it.'],
  '3.2.3': ['Consistent Navigation', 'AA', PAGE, 'Navigation repeated across pages is the site\'s.'],
  '3.2.4': ['Consistent Identification', 'AA', PAGE, 'Consistency across a set of pages is the site\'s.'],
  '3.2.6': ['Consistent Help', 'A', PAGE, 'Help offered across a set of pages is the site\'s.'],
  '3.3.1': ['Error Identification', 'A'],
  '3.3.2': ['Labels or Instructions', 'A', ASSESSED, 'The table\'s "Jump to" field has a label, but no test asserts it.'],
  '3.3.3': ['Error Suggestion', 'AA', ASSESSED, 'It can apply to the "Jump to" field\'s error; no test is cited for it.'],
  '3.3.4': ['Error Prevention (Legal, Financial, Data)', 'AA', NA, 'A chart submits nothing: no legal, financial or data commitments.'],
  '3.3.7': ['Redundant Entry', 'A', NA, 'A chart has no multi-step process.'],
  '3.3.8': ['Accessible Authentication (Minimum)', 'AA', NA, 'A chart has no sign-in.'],
  '4.1.2': ['Name, Role, Value', 'A'],
  '4.1.3': ['Status Messages', 'AA'],
};
