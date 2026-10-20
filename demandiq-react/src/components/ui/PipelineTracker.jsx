import { formatDateTime } from "../../lib/format";
import { Icon } from "./Icon";
import { Status } from "./Status";

const products = (n) => `${n} product${n === 1 ? "" : "s"}`;

/**
 * The "Forecasted" step, from the dataset's lineage (which saved forecasts used its records):
 * the server works out the status product by product, so it only changes when a forecast used this upload.
 */
function forecastDetail(dataset) {
  if (dataset.validation === "Failed") return "Not started — upload failed";
  if (dataset.cleaning !== "Completed") return "Waiting for cleaning first";
  const lineage = dataset.lineage ?? { skus: [], forecastedSkus: [] };
  if (dataset.forecasting === "Completed") return `${formatDateTime(dataset.forecastedAt)} · all ${products(lineage.skus.length)}`;
  if (dataset.forecasting === "Partial") return `${lineage.forecastedSkus.length} of ${products(lineage.skus.length)} forecast so far`;
  if (dataset.forecasting === "Not needed") return "None of its records were added to the sales history";
  return "Waiting for a forecast that uses its records";
}

/** The three pipeline steps for a dataset: [label, detail, status]. */
export function pipelineSteps(dataset) {
  const failed = dataset.validation === "Failed";
  return [
    ["Uploaded", formatDateTime(dataset.uploadedAt), failed ? "Failed" : "Completed"],
    [
      "Cleaned",
      dataset.cleanedAt ? formatDateTime(dataset.cleanedAt) : failed ? "Not started — upload failed" : "Waiting for analyst",
      dataset.cleaning,
    ],
    ["Forecasted", forecastDetail(dataset), dataset.forecasting],
  ];
}

function StepDot({ status, index }) {
  const done = status === "Completed";
  return (
    <div className={`step-dot ${done ? "" : status === "Failed" ? "failed" : "pending"}`}>
      {done ? <Icon name="check" size={13} /> : status === "Failed" ? <Icon name="close" size={12} /> : <b>{index + 1}</b>}
    </div>
  );
}

/**
 * Uploaded → Cleaned → Forecasted status tracker for a dataset.
 * `vertical` stacks the steps (used on the Data Analyst dashboard).
 */
export function PipelineTracker({ dataset, centered = true, vertical = false }) {
  const steps = pipelineSteps(dataset);
  if (vertical)
    return (
      <ol className="pipeline-vertical" aria-label={`Pipeline status for ${dataset.fileName}`}>
        {steps.map((step, index) => (
          <li key={step[0]} className={index < 2 && steps[index + 1][2] === "Completed" ? "next-done" : ""}>
            <StepDot status={step[2]} index={index} />
            <div>
              <strong>{step[0]}</strong>
              <span>{step[1]}</span>
            </div>
            <Status value={step[2]} />
          </li>
        ))}
      </ol>
    );
  return (
    <div className={`pipeline ${centered ? "pipeline-centered" : ""}`} aria-label={`Pipeline status for ${dataset.fileName}`}>
      {steps.map((step, index) => {
        const nextDone = index < 2 && steps[index + 1][2] === "Completed";
        return (
          <div className="pipeline-step" key={step[0]}>
            <StepDot status={step[2]} index={index} />
            {index < 2 && <i className={nextDone ? "" : "pending"} />}
            <strong>{step[0]}</strong>
            <span>{step[1]}</span>
            <Status value={step[2]} />
          </div>
        );
      })}
    </div>
  );
}
