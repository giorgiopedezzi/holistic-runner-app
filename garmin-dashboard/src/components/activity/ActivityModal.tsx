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
      className="hra-modal-backdrop hra-modal-layer fixed inset-0 flex items-center justify-center p-6"
    >
      <div className="hra-activity-modal hra-bg-surface hra-border rounded-2xl w-full overflow-y-auto p-6">
        <ActivityDetailBody activityId={activityId} onDelete={onDelete} onClose={onClose} />
      </div>
    </div>
  );
}
