import { Card } from "./Card";
import { Icon } from "./Icon";

export function Kpi({ label, value, change, icon, tone }) {
  return (
    <Card className={`kpi ${tone || ""}`}>
      <div className="kpi-top">
        <span>{label}</span>
        <div className="kpi-icon">
          <Icon name={icon} />
        </div>
      </div>
      <strong>{value}</strong>
      <small className={change.startsWith("+") ? "positive" : change.startsWith("−") ? "negative" : ""}>{change}</small>
    </Card>
  );
}
