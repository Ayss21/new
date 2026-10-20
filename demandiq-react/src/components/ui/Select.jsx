export function Select({ children, disabled = false, value, onChange, ariaLabel }) {
  return (
    <select disabled={disabled} value={value} onChange={(e) => onChange?.(e.target.value)} aria-label={ariaLabel}>
      {children}
    </select>
  );
}
