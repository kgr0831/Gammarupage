// Reports and delivery rows created before revisions were supported are edition 1.
export const reportRevision = (report) => report?.revision || 1;

export function currentDeliveryReport(state, delivery) {
  const report = state.reports.find((entry) => entry.date === delivery.date);
  return report && reportRevision(report) === reportRevision(delivery) ? report : null;
}

export function deliveryKey(report, target) {
  return `${report.date}${reportRevision(report) > 1 ? `:r${reportRevision(report)}` : ""}:${target}`;
}
