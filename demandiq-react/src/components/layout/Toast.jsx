import { useStore } from "../../store/AppStore";
import { Icon } from "../ui";

export function Toast() {
  const { toast, toastTone, dismissToast } = useStore();
  if (!toast) return null;
  return (
    <div className={`toast toast-${toastTone}`} role={toastTone === "success" ? "status" : "alert"} aria-live="polite">
      <div>
        <Icon name={toastTone === "success" ? "check" : "warning"} />
      </div>
      <span>{toast}</span>
      <button onClick={dismissToast} aria-label="Dismiss">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
