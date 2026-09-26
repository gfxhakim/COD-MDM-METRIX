export function downloadText(filename: string, content: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export const KIND_META = {
  ORDERS: { label: "Orders", noun: "orders", blurb: "Shopify or EasySell order exports. Multi-line orders are grouped by order number; re-imports skip orders already imported from the same source.", template: "Name,Created at,Lineitem sku,Lineitem quantity,Lineitem price,Total,Status,Billing Phone,Shipping Province,utm_source,utm_campaign,utm_content\n#1001,2026-04-01 10:00,PC-01,1,3900,3900,confirmed,0550000000,Alger,facebook,spring,cr_hook_01\n" },
  AD_SPEND: { label: "Ad spend", noun: "spend rows", blurb: "Meta Ads Manager exports broken down by day and ad. Re-exporting the same days updates the amounts instead of adding them twice.", template: "Day,Campaign name,Ad set name,Ad name,Ad ID,Amount spent (DZD),Impressions,Link clicks\n2026-04-01,Spring,Broad,Hook 01,cr_hook_01,4500,12000,210\n" },
  EXPENSES: { label: "Expenses", noun: "expenses", blurb: "Categorized operating costs. Use a product SKU for product-specific costs; leave it empty for global overhead.", template: "date,category,amount,description,sku,cost type\n2026-04-01,Software,3000,Shopify plan,,fixed\n2026-04-01,Packaging,1500,Boxes,PC-01,variable\n" },
  BANK: { label: "Bank", noun: "bank rows", blurb: "Bank statement rows land in a review queue and never affect profit until you categorize or exclude them.", template: "date,description,debit,credit,reference\n2026-04-01,FACEBOOK ADS,12000,,TX-1\n2026-04-02,MDM REMITTANCE,,85000,TX-2\n" },
} as const;

export type Kind = keyof typeof KIND_META;
