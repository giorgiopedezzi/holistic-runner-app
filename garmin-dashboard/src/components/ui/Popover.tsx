import * as PopoverPrimitive from "@radix-ui/react-popover";
import { useRef, useState, type ComponentProps, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";

// Thin wrapper (HRA-98) — Root/Trigger passed through as-is, Content always
// portaled + given the app's dark popover chrome via a real class (see
// index.css's .hra-popover-content, same "pseudo-state needs a class"
// reasoning as Card/Select above).
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({ children, align = "start", onCloseAutoFocus }: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  onCloseAutoFocus?: ComponentProps<typeof PopoverPrimitive.Content>["onCloseAutoFocus"];
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={6} className="hra-popover-content" onCloseAutoFocus={onCloseAutoFocus}>
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}

interface HelpDisclosureProps {
  // Trigger's accessible name (aria-label) — must read as its own label,
  // distinct from `heading`, since a screen-reader user hears both in the
  // same session (trigger announced on focus, heading right after opening).
  label: string;
  heading?: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
}

// HRA-276 — shared accessible "help" disclosure for any mobile screen that
// needs one accessible way to reveal supplementary detail. Most of the
// contract comes for free from Radix's own Popover wiring: PopoverTrigger
// already sets aria-haspopup/aria-expanded/aria-controls from the shared
// open state, Popover is non-modal by default so its DismissableLayer
// closes on Escape/an outside pointer-down without trapping Tab inside the
// content. The one thing Radix's non-modal default does NOT do is refocus
// the trigger after a genuine outside-tap dismissal (it deliberately leaves
// focus wherever the tap landed, e.g. another control) — the AC here wants
// the trigger refocused unconditionally, so onCloseAutoFocus is overridden
// to always return focus there regardless of what closed the popover.
export function HelpDisclosure({ label, heading, children, align }: HelpDisclosureProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger ref={triggerRef} aria-label={label} className="hra-help-trigger">
        <CircleHelp size={18} aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent
        align={align}
        onCloseAutoFocus={event => {
          event.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        {heading && <p className="text-label hra-text-primary font-semibold mb-1">{heading}</p>}
        <div className="text-body hra-text-secondary">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
