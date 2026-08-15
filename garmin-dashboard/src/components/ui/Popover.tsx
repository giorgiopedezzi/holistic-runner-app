import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ReactNode } from "react";

// Thin wrapper (HRA-98) — Root/Trigger passed through as-is, Content always
// portaled + given the app's dark popover chrome via a real class (see
// index.css's .hra-popover-content, same "pseudo-state needs a class"
// reasoning as Card/Select above).
export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({ children, align = "start" }: { children: ReactNode; align?: "start" | "center" | "end" }) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={6} className="hra-popover-content">
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
