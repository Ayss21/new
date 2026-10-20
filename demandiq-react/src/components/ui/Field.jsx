/** A labelled form field. Use as="div" around controls that hold their own labels (MultiSelect). */
export function Field({ label, children, helper, error, as: Tag = "label" }) {
  return (
    <Tag className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="helper field-error">{error}</span> : helper && <span className="helper">{helper}</span>}
    </Tag>
  );
}
