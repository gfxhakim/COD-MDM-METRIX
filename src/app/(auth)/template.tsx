import { ViewTransition } from "react";

/** Every page change: the old page fades up and away, the new one rises into place (see globals.css). */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="page" exit="page" default="none">
      <div className="page-shell">{children}</div>
    </ViewTransition>
  );
}
