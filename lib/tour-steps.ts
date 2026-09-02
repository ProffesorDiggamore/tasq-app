/**
 * The guided tour, as data. Each step points at a real element on the board by
 * a `data-tour` attribute; the engine in components/tour/BoardTour.tsx
 * spotlights it and shows the copy.
 *
 * A step whose target is missing right now — an empty Done row, the tab strip
 * on a board with no tabs — falls back to a centred card rather than being
 * skipped. Skipping looked like the tour was broken: press Next once on an
 * empty board and three steps went by in a blink. See `optional` for the one
 * case where dropping a step really is right.
 */
export interface TourStep {
  key: string;
  /** `data-tour` value to spotlight, or null for a centred card with no target. */
  target: string | null;
  title: string;
  body: string;
  /** Only shown to admins. */
  adminOnly?: boolean;
  /**
   * Drop the step entirely when its target is not on the page, instead of
   * showing it centred. For steps that explain a thing that is not there —
   * the tab strip on a shop that has never made a tab.
   */
  optional?: boolean;
  /**
   * Spotlight the whole viewport instead of one element. "This is the board"
   * is about the screen, so ringing just the title bar undersold it.
   */
  full?: boolean;
  /** Force the caption above or below the target; default picks by room. */
  place?: 'above' | 'below';
  /** The outro card gets the checkmark. */
  kind?: 'intro' | 'outro';
}

export const TOUR_STEPS: TourStep[] = [
  {
    key: 'intro',
    target: null,
    kind: 'intro',
    title: 'Welcome',
    body: "Let's get you familiar with the app — it only takes about a minute.",
  },
  {
    key: 'board',
    target: null,
    full: true,
    title: 'This is the board',
    body: 'Every tasq shows up here. It refreshes itself every half minute.',
  },
  {
    key: 'settings',
    target: 'settings',
    place: 'below',
    title: 'Settings',
    body: 'Change things about the app — add people, switch the theme, set up repeats.',
  },
  {
    key: 'switch-user',
    target: 'switch-user',
    place: 'below',
    title: 'Your profile',
    body: 'This is you. If you ever need to switch, tap this icon.',
  },
  {
    key: 'tabs',
    target: 'tabs',
    optional: true,
    place: 'below',
    title: 'Your tabs',
    body: 'Tasqs is shared with the whole shop. The rest are your groups.',
  },
  {
    key: 'rows',
    target: 'rows',
    title: 'Tasqs',
    body: 'All things tasqs show up here — urgent first, then anything free to take, then yours.',
  },
  {
    key: 'new-task',
    target: 'new-task',
    place: 'above',
    title: 'Add tasq',
    body: 'When something needs doing, tap here and fill in what you know.',
  },
  {
    key: 'card',
    target: 'card',
    title: 'A tasq card',
    body: 'Tap any card to open it — accept it, hand it back, or mark it done.',
  },
  {
    key: 'row-done',
    target: 'row-done',
    title: 'Done today',
    body: 'Finished work drops down here with an undo on each. It clears overnight.',
  },
  {
    key: 'outro',
    target: null,
    kind: 'outro',
    title: "That's the whole app",
    body: 'Run this tour again anytime from Settings → Walkthrough.',
  },
];
