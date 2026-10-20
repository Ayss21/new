import { Icon } from "./Icon";

export function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="search">
      <Icon name="search" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value && (
        <button className="search-clear" onClick={() => onChange("")} aria-label="Clear search">
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  );
}
