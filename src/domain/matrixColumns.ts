/** Creative matrix column catalog, shared by the table and the CSV export. */
export const MATRIX_COLUMNS = [
  { key: "creative", label: "Creative ID", kind: "text" },
  { key: "campaign", label: "Campaign", kind: "text" },
  { key: "adSpend", label: "Spend", kind: "money" },
  { key: "placed", label: "Placed", kind: "count" },
  { key: "placedCpa", label: "Placed CPA", kind: "money" },
  { key: "confirmed", label: "Confirmed", kind: "count" },
  { key: "confirmationRate", label: "Confirm rate", kind: "rate" },
  { key: "cpco", label: "CPCO", kind: "money" },
  { key: "shipped", label: "Shipped", kind: "count" },
  { key: "delivered", label: "Delivered", kind: "count" },
  { key: "deliveryRate", label: "Delivery rate", kind: "rate" },
  { key: "returned", label: "Returned", kind: "count" },
  { key: "returnRate", label: "RTO rate", kind: "rate" },
  { key: "cpdo", label: "CPDO", kind: "money" },
  { key: "revenue", label: "Net revenue", kind: "money" },
  { key: "trueNetProfit", label: "True net profit", kind: "money" },
  { key: "truePoas", label: "True POAS", kind: "ratio" },
  { key: "verdict", label: "Verdict", kind: "text" },
] as const;

export type MatrixColumnKey = (typeof MATRIX_COLUMNS)[number]["key"];
export const MATRIX_COLUMN_KEYS = MATRIX_COLUMNS.map((c) => c.key) as [MatrixColumnKey, ...MatrixColumnKey[]];
