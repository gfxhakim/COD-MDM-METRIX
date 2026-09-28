"use client";

import { Input, Select } from "@/components/ui/form";
import { CURRENCIES, convertMinor, formatMoney, parseToMinor } from "@/lib/money";
import { MoneyInput } from "./money-input";

/** Form state for an amount that may be in another currency. Strings, as typed. */
export type CurrencyAmount = { amount: string; currency: string; rate: string };
export type Rates = Partial<Record<string, number>>;

/** The workspace's own currency first, then the others. */
export function currencyOptions(workspaceCurrency: string) {
  return [workspaceCurrency, ...CURRENCIES.filter((c) => c !== workspaceCurrency)];
}

export function rateInput(rates: Rates, currency: string, fallback?: number | null) {
  const r = rates[currency] ?? fallback;
  return r ? String(r) : "";
}

/**
 * Amount with a currency picker. In another currency it asks for the exchange rate
 * (filled from Settings) and shows the converted amount, which is what reports use.
 */
export function CurrencyAmountInput({ id, value, onChange, workspaceCurrency, rates, required, disabled }: {
  id: string;
  value: CurrencyAmount;
  onChange: (v: CurrencyAmount) => void;
  workspaceCurrency: string;
  rates: Rates;
  required?: boolean;
  disabled?: boolean;
}) {
  const foreign = value.currency !== workspaceCurrency;
  let converted: string | null = null;
  if (foreign && value.amount && Number(value.rate) > 0) {
    try {
      converted = formatMoney(convertMinor(parseToMinor(value.amount, value.currency), value.currency, workspaceCurrency, Number(value.rate)), workspaceCurrency);
    } catch {
      converted = null;
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <MoneyInput id={id} currency={value.currency} value={value.amount} onChange={(amount) => onChange({ ...value, amount })} required={required} disabled={disabled} />
        </div>
        <Select
          id={`${id}-currency`}
          aria-label="Currency"
          className="w-[5.5rem] shrink-0"
          value={value.currency}
          disabled={disabled}
          onChange={(e) => {
            const currency = e.target.value;
            onChange({ ...value, currency, rate: currency === workspaceCurrency ? "" : rateInput(rates, currency) });
          }}
        >
          {currencyOptions(workspaceCurrency).map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>
      {foreign ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <label htmlFor={`${id}-rate`}>1 {value.currency} =</label>
          <Input id={`${id}-rate`} inputMode="decimal" className="num h-8 w-24" value={value.rate} onChange={(e) => onChange({ ...value, rate: e.target.value.replace(/[^\d.]/g, "") })} placeholder="e.g. 250" required disabled={disabled} />
          <span>{workspaceCurrency}</span>
          {converted ? <span className="num ml-auto text-fg">= {converted}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** What the API takes: minor units of the chosen currency, plus the rate when it isn't the workspace's. */
export function parseCurrencyAmount(v: CurrencyAmount, workspaceCurrency: string, label = "Amount") {
  const amount = parseToMinor(v.amount || "0", v.currency);
  if (amount < 0) throw new Error(`${label} cannot be negative`);
  if (v.currency === workspaceCurrency) return { amount, currency: undefined, rate: null };
  const rate = Number(v.rate);
  if (!(rate > 0)) throw new Error(`Enter how many ${workspaceCurrency} one ${v.currency} costs`);
  return { amount, currency: v.currency as (typeof CURRENCIES)[number], rate };
}

/** The amount as entered, under its converted value: "5 USD × 250". */
export function OriginalAmount({ amount, currency, rate }: { amount: number | null | undefined; currency: string | null | undefined; rate: number | null | undefined }) {
  if (amount === null || amount === undefined || !currency) return null;
  return <span className="num block text-[11px] text-muted">{formatMoney(amount, currency)}{rate ? ` × ${rate}` : ""}</span>;
}
