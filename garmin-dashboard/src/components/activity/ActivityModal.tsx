import { ActivityDetailBody } from "./ActivityDetailBody";

interface Props {
  activityId: number;
  onClose: () => void;
  onDelete: (id: number) => void;
}

// Popup variant — a fixed backdrop overlay wrapping ActivityDetailBody, with
// an × close button (see the modal-vs-accordion setting in CLAUDE.md).
export function ActivityModal({ activityId, onClose, onDelete }: Props) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 100, padding: "24px",
      }}
    >
      <div style={{
        background: "var(--bg-surface)", border: "1px solid var(--border)",
        borderRadius: 16, width: "100%", maxWidth: 680,
        maxHeight: "90vh", overflowY: "auto",
        padding: "24px",
      }}>
        <ActivityDetailBody activityId={activityId} onDelete={onDelete} onClose={onClose} />
      </div>
    </div>
  );
}
