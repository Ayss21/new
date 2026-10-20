// Coloured status pill. Colour is always paired with the label text.
// Shared colour rules, so the same word looks the same everywhere in the app:
//   Uploaded / Ordered → blue (teal)
//   Completed / Safe / Active / Delivered / Forecasted … → green · Processing / Pending / Warning … → amber
//   Failed / Critical / Error … → red · anything else → grey
const TONES = {
  blue: ["Uploaded", "Ongoing", "Ordered"],
  red: ["Critical", "Failed", "Error", "Open", "Inactive", "Cancelled"],
  yellow: ["Warning", "Low", "Pending", "Processing", "Investigating", "In Progress", "Pending activation", "Partial"],
  green: ["Completed", "Safe", "Resolved", "Valid", "Active", "Delivered", "Forecasted"],
};

export function statusTone(value) {
  for (const [tone, words] of Object.entries(TONES)) if (words.includes(value)) return tone;
  if (/warning/i.test(value)) return "yellow";
  return "gray";
}

export function Status({ value }) {
  return (
    <span className={`status status-${statusTone(value)}`}>
      <span className="status-dot" />
      {value}
    </span>
  );
}
