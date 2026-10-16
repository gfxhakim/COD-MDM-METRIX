"use client";

/** What the Profit tracker's parts share: the data's types, links to orders, ad money and one order's numbers. */
import type { inferRouterOutputs } from "@trpc/server";
import * as React from "react";
import { useMoney } from "@/components/app/currency";
import type { OrderProfitInput } from "@/domain/orderProfit";
import { msg } from "@/i18n/core";
import { convertWithRates, currencyExponent } from "@/lib/money";
import type { AppRouter } from "@/server/trpc/root";

export type Tracker = inferRouterOutputs<AppRouter>["profit"]["tracker"];
export type Row = Tracker["products"][number];
export type Days = { from?: string; to?: string };

export const count = (n: number) => Math.round(n).toLocaleString("en-US");

/** The orders behind a number: this product's orders placed in these days, in one status. */
export function ordersHref(productId: string, days: Days, filter: { parcelStatus?: "DELIVERED" | "SHIPPED" | "RETURNED" | "LOST"; status?: "CONFIRMED" | "CANCELED" | "PENDING" } = {}) {
  const q = new URLSearchParams({ productId, counted: "1" });
  if (days.from) q.set("from", days.from);
  if (days.to) q.set("to", days.to);
  if (filter.parcelStatus) q.set("parcelStatus", filter.parcelStatus);
  if (filter.status) q.set("status", filter.status);
  return `/orders?${q.toString()}`;
}

/**
 * Meta bills ads in dollars, so ad costs per order are shown in dollars when the business has a
 * dollar rate (Settings > Economics & currencies), else in its own currency.
 */
export function useAdMoney(currency: string) {
  const money = useMoney();
  return React.useMemo(() => {
    const usd = currency !== "USD" && !!money.rates.USD;
    const toAd = (minor: number) => (usd ? convertWithRates(minor, currency, "USD", money.book, money.rates) ?? minor : minor);
    const fromAd = (minor: number) => (usd ? convertWithRates(minor, "USD", currency, money.book, money.rates) ?? minor : minor);
    const adCurrency = usd ? "USD" : currency;
    const fmtAd = (minor: number) =>
      usd ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(toAd(minor) / 100) : money.fmt(minor, currency, { decimals: false });
    return { usd, adCurrency, toAd, fromAd, fmtAd, exponent: currencyExponent(adCurrency) };
  }, [currency, money]);
}

/** What one delivered order is worked out from: the numbers read from MDM, Meta and the product, at the rates in use. */
export function orderInput(row: Row): OrderProfitInput {
  const i = row.inputs;
  return {
    price: i.price.value,
    pieces: Math.max(1, row.piecesPerOrder),
    costPerPiece: i.costPerPiece.value,
    deliveryFee: i.deliveryFee.value,
    packagingFee: i.packagingFee.value,
    returnFee: i.returnFee.value,
    callCenterFee: i.callCenterFee.value,
    callCenterBasis: i.callCenterBasis,
    otherFees: 0,
    confirmationRate: row.rates.confirmation,
    shippingRate: row.rates.shipping,
    deliveryRate: row.rates.delivery,
    lostRate: row.rates.lost,
    adCostPerOrder: i.adCostPerOrder.value,
  };
}

/** Where each number came from, said the way the page says it. */
export const SOURCE_TEXT = {
  orders: msg("From your MDM orders"),
  product: msg("From your product details"),
  mdm: msg("From your MDM stock prices"),
  settings: msg("From Settings > Economics & currencies"),
  campaigns: msg("From Meta, the campaigns linked to this product"),
  none: msg("Not known yet"),
} as const;

export const RATE_SOURCE_TEXT = {
  days: msg("From the orders of these days"),
  all: msg("From all your orders: too few finished in these days"),
  example: msg("An example: not enough finished orders yet"),
} as const;
