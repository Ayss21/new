import { Icon } from "./Icon";

export function EmptyState({ title, detail, icon = "search", inline = false, className = "" }) {
  return (
    <div className={`empty-state ${inline ? "inline" : ""} ${className}`}>
      <Icon name={icon} size={inline ? 18 : 28} />
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}
