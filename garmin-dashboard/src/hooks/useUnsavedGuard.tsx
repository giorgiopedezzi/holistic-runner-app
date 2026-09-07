import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmModal } from "@/components/ui";

// HRA-281: cross-cutting guard so an editor with unsaved changes (currently
// only the race-plan instance editor, PlanInstancesSection.tsx) can block an
// in-app navigation (sidebar tab switch, agenda/feedback deep links) or a
// language change (LanguagePicker) the same way PlanTemplatesSection.tsx's
// own beforeunload listener already blocks a browser refresh/close. A React
// context, not a module-scope variable (the pattern utils/units.ts and
// utils/dateFormat.ts use for document-wide settings) — this needs to drive
// a real confirm dialog, not just be read at render time, and there is at
// most one guarded editor mounted at once (the race-plan editor lives on its
// own tab), so "last registration wins" is the whole contract.
//
// The context default (not null) is deliberate: most components/tests never
// need to think about this guard at all — PlanInstancesSection.test.tsx's
// many `render(<PlanInstancesSection ... />)` calls have no provider, and
// should keep working exactly as before (setGuard a no-op, guardedAction
// running immediately). Only App.tsx mounts a real UnsavedGuardProvider.
interface UnsavedGuardApi {
  setGuard: (isDirty: (() => boolean) | null) => void;
  guardedAction: (action: () => void) => void;
}

const noopGuard: UnsavedGuardApi = {
  setGuard: () => {},
  guardedAction: action => action(),
};

const UnsavedGuardContext = createContext<UnsavedGuardApi>(noopGuard);

export function UnsavedGuardProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const guardRef = useRef<(() => boolean) | null>(null);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);

  const setGuard = useCallback((isDirty: (() => boolean) | null) => {
    guardRef.current = isDirty;
  }, []);

  const guardedAction = useCallback((action: () => void) => {
    if (guardRef.current?.()) {
      setPendingAction(() => action);
      return;
    }
    action();
  }, []);

  const api = useMemo<UnsavedGuardApi>(() => ({ setGuard, guardedAction }), [setGuard, guardedAction]);

  return (
    <UnsavedGuardContext.Provider value={api}>
      {children}
      <ConfirmModal
        open={pendingAction != null}
        title={
          <div className="hra-text-primary text-label font-semibold leading-normal mb-4">
            {t("common.unsavedNavConfirm", "You have unsaved changes. Leave and discard them?")}
          </div>
        }
        confirmLabel={t("common.discardAndLeave", "Discard and leave")}
        variant="danger"
        onConfirm={() => { pendingAction?.(); setPendingAction(null); }}
        onCancel={() => setPendingAction(null)}
      />
    </UnsavedGuardContext.Provider>
  );
}

export function useUnsavedGuard(): UnsavedGuardApi {
  return useContext(UnsavedGuardContext);
}
