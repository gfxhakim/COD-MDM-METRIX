import { msg } from "@/i18n/core";
/** Plain-language metric definitions used in tooltips across the app. */
export const DEF = {
  netCashCollected: msg("Cash the carrier has actually remitted to you (REMITTED cash events) for orders placed in this period. Differs from delivered revenue until remittances arrive."),
  cashInTransit: msg("COD value of parcels that have shipped but are not yet delivered, returned or lost (including dispatched parcels with an unknown status). Not yet yours."),
  deliveredRevenue: msg("COD value of parcels with a delivered status. Delivered is not the same as remitted."),
  adSpend: msg("Ad spend in the period. Includes spend whose creative ID could not be matched."),
  rtoLoss: msg("Money burned on returned parcels: forward shipping + RTO fee + packaging."),
  trueNetProfit: msg("Revenue (delivered or remitted, per the selected view) − ad spend − COGS − outbound shipping − RTO fees − call-center cost − packaging − allocated overhead. A parcel still with the carrier counts once it is delivered or returned."),
  truePoas: msg("True net profit ÷ ad spend. 0 means breakeven after all costs; 0.3 means 30% profit on top of ad spend."),
  placedCpa: msg("Ad spend ÷ placed orders. Cheap leads can still lose money."),
  cpco: msg("Cost per confirmed order: ad spend ÷ confirmed orders."),
  cpdo: msg("Cost per delivered order: ad spend ÷ delivered parcels."),
  confirmationRate: msg("Confirmed ÷ placed orders."),
  deliveryRate: msg("Delivered ÷ parcels whose delivery is finished (delivered, returned, lost or exchanged). Parcels still with the carrier are left out until they finish."),
  returnRate: msg("Returned (RTO) ÷ parcels whose delivery is finished. Parcels still with the carrier are left out until they finish."),
  cogs: msg("Delivered quantity × sourcing cost from the cost version in effect on the order date. Returned goods go back to stock."),
  overhead: msg("Expenses in the period. At business level all of them count; per product/creative they are allocated by your overhead policy."),
  verdict: msg("Kill: losing money with enough data. Bad traffic: cheap orders that don't deliver. Scale: POAS at or above target with enough orders. Watch: enough data, below target. Not enough data: too few orders."),
} as const;
