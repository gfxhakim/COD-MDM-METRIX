import { msg } from "@/i18n/core";

/** Creative matrix column catalog, shared by the table and the CSV export. */
export const MATRIX_COLUMNS = [
  { key: "creative", label: msg("Creative ID"), kind: "text" },
  { key: "product", label: msg("Product"), kind: "text" },
  { key: "campaign", label: msg("Campaign"), kind: "text" },
  { key: "adSpend", label: msg("Spend"), kind: "money" },
  { key: "placed", label: msg("Placed"), kind: "count" },
  { key: "placedCpa", label: msg("Placed CPA"), kind: "money" },
  { key: "confirmed", label: msg("Confirmed"), kind: "count" },
  { key: "confirmationRate", label: msg("Confirm rate"), kind: "rate" },
  { key: "cpco", label: msg("CPCO"), kind: "money" },
  { key: "shipped", label: msg("Shipped"), kind: "count" },
  { key: "delivered", label: msg("Delivered"), kind: "count" },
  { key: "deliveryRate", label: msg("Delivery rate"), kind: "rate" },
  { key: "returned", label: msg("Returned"), kind: "count" },
  { key: "returnRate", label: msg("RTO rate"), kind: "rate" },
  { key: "cpdo", label: msg("CPDO"), kind: "money" },
  { key: "revenue", label: msg("Net revenue"), kind: "money" },
  { key: "trueNetProfit", label: msg("True net profit"), kind: "money" },
  { key: "truePoas", label: msg("True POAS"), kind: "ratio" },
  { key: "verdict", label: msg("Verdict"), kind: "text" },
] as const;

export type MatrixColumnKey = (typeof MATRIX_COLUMNS)[number]["key"];
export const MATRIX_COLUMN_KEYS = MATRIX_COLUMNS.map((c) => c.key) as [MatrixColumnKey, ...MatrixColumnKey[]];
