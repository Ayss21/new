import { Icon } from "./Icon";

export function Button({
  children,
  variant = "primary",
  icon,
  onClick,
  disabled = false,
  className = "",
  type = "button",
  title,
}) {
  return (
    <button type={type} disabled={disabled} onClick={onClick} className={`btn btn-${variant} ${className}`} title={title}>
      {icon && <Icon name={icon} size={16} />}
      <span>{children}</span>
    </button>
  );
}
