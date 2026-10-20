import { useEffect, useRef } from "react";
import { Icon } from "./Icon";

export function Modal({ title, children, onClose, width = "normal" }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event) => event.key === "Escape" && closeRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`modal ${width === "wide" ? "modal-wide" : width === "xwide" ? "modal-wide modal-xwide" : ""}`}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">DEMANDIQ WORKSPACE</span>
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Spinner + progress bar used while uploads, forecasts and exports run. */
export function ProgressState({ title, detail }) {
  return (
    <div className="progress-state">
      <div className="spinner" />
      <strong>{title}</strong>
      <span>{detail}</span>
      <div className="progress-bar">
        <i />
      </div>
    </div>
  );
}
