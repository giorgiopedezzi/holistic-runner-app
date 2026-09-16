import { createContext, useContext } from "react";

// HRA-374: the one server-authoritative frontend app-mode/capability context —
// replaces the GuestShell/AppShell fork with a single shared shell that
// branches on capability, not on which component is mounted. Capability
// checks (not scattered ad hoc guest booleans) are what nav/UI branches read.
// Guest security must never be enforced here alone — every write capability
// below is already independently rejected server-side (HRA-373's route
// capability matrix); these flags only drive which affordances the UI offers.
export type AppMode = "authenticated" | "guest";

export interface AppCapabilities {
  mode: AppMode;
  canPersist: boolean;
  canUseBillableAi: boolean;
  canSync: boolean;
  canManageAccount: boolean;
  canExplore: boolean;
  canReplay: boolean;
  canCompare: boolean;
  canEditTransiently: boolean;
  canSendFeedback: boolean;
}

export const AUTHENTICATED_CAPABILITIES: AppCapabilities = {
  mode: "authenticated",
  canPersist: true,
  canUseBillableAi: true,
  canSync: true,
  canManageAccount: true,
  canExplore: true,
  canReplay: true,
  canCompare: true,
  canEditTransiently: true,
  canSendFeedback: true,
};

export const GUEST_CAPABILITIES: AppCapabilities = {
  mode: "guest",
  canPersist: false,
  canUseBillableAi: false,
  canSync: false,
  canManageAccount: false,
  canExplore: true,
  canReplay: true,
  canCompare: true,
  canEditTransiently: false,
  canSendFeedback: true,
};

export const AppModeContext = createContext<AppCapabilities>(AUTHENTICATED_CAPABILITIES);
export function useAppMode(): AppCapabilities {
  return useContext(AppModeContext);
}
