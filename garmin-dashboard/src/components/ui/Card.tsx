import type { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
  // Custom hover tooltip (.hra-tooltip, index.css) instead of the native
  // `title` attribute — a browser tooltip can't be restyled, so anything
  // that wants to actually look like part of the app (comparison figures,
  // etc.) goes through this class/attribute pair instead.
  tooltip?: string;
}

export function Card({ children, className, tooltip }: CardProps) {
  const classes = [className, tooltip ? "hra-tooltip" : null].filter(Boolean).join(" ") || undefined;
  return (
    <div
      className={classes ? `card ${classes}` : "card"}
      data-tooltip={tooltip}
    >
      {children}
    </div>
  );
}
