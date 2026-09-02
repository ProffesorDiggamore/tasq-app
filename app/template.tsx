/**
 * Remounts on every navigation, which re-runs the `page-enter` CSS animation —
 * the cross-fade that makes screen changes read as one app rather than a series
 * of hard swaps. Deliberately a plain server component: the motion is pure CSS
 * (globals.css), so it starts at first paint without waiting for hydration, and
 * the stylesheet's reduced-motion rule already flattens it to an instant cut.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
