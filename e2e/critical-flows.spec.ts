import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * The spec's 11 critical E2E flows, in order, against a production build.
 * Flows 1–7 run in a brand-new workspace created by signing up.
 * Flows 8–10 use the seeded DEMO workspace, whose MDM connection runs on the
 * labelled mock adapter (no request ever reaches MDM).
 * Flow 11 signs in as a different business and probes both workspaces.
 */
test.describe.configure({ mode: "serial" });

const fixture = (name: string) => path.join(__dirname, "fixtures", name);
const stamp = Date.now();
const owner = { name: "E2E Owner", email: `e2e-${stamp}@test.local`, password: "e2e-password-123", business: `E2E Lamps ${stamp}` };
const DEMO_KEY = "demo-key-e2e-4242";
const workspaceIds: { e2e?: string; demo?: string } = {};

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  await page.waitForURL("/");
}

/** Calls a tRPC query as the signed-in browser, optionally asking for a specific workspace. */
async function trpcQuery(page: Page, procedure: string, workspaceId?: string) {
  const input = encodeURIComponent(JSON.stringify({ json: {} }));
  const res = await page.request.get(`/api/trpc/${procedure}?input=${input}`, { headers: workspaceId ? { "x-workspace-id": workspaceId } : {} });
  return { status: res.status(), body: await res.text() };
}

async function currentWorkspaceId(page: Page) {
  const res = await trpcQuery(page, "workspace.getCurrent");
  expect(res.status).toBe(200);
  return JSON.parse(res.body).result.data.json.id as string;
}

test("1. sign up and land in a new workspace", async ({ page }) => {
  await page.goto("/signup");
  await page.fill("#name", owner.name);
  await page.fill("#email", owner.email);
  await page.fill("#password", owner.password);
  await page.fill("#workspaceName", owner.business);
  await page.click("button:has-text('Create workspace')");
  await page.waitForURL("/");
  await expect(page.getByText(owner.business).first()).toBeVisible();
  await expect(page.getByText("DEMO DATA")).toHaveCount(0);
  workspaceIds.e2e = await currentWorkspaceId(page);

  // Sign out and back in: the workspace is selected again from the membership.
  await page.context().clearCookies();
  await signIn(page, owner.email, owner.password);
  expect(await currentWorkspaceId(page)).toBe(workspaceIds.e2e);
});

test.describe("new workspace", () => {
  test.beforeEach(async ({ page }) => signIn(page, owner.email, owner.password));

  test("4. add a product and a new cost version", async ({ page }) => {
    await page.goto("/products");
    await page.getByRole("button", { name: "New product" }).first().click();
    await page.fill("#pname", "E2E Lamp");
    await page.fill("#psku", "E2E-LAMP");
    await page.fill("#salePrice", "3900");
    await page.fill("#sourcingCost", "900");
    await page.fill("#forwardShippingFee", "600");
    await page.fill("#rtoFee", "250");
    await page.fill("#callCenterFee", "120");
    await page.fill("#packagingFee", "50");
    await page.click("button:has-text('Create product')");
    await expect(page.getByRole("cell", { name: "E2E Lamp", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Cost versions for E2E Lamp" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#eff").fill("2026-09-16");
    await dialog.locator("#sourcingCost").fill("1000");
    await dialog.locator("#note").fill("Supplier price increase");
    await dialog.getByRole("button", { name: "Add cost version" }).click();
    await expect(page.getByText("New cost version saved")).toBeVisible();
    await page.getByRole("button", { name: "Cost versions for E2E Lamp" }).click();
    await expect(page.getByRole("dialog").getByText("current")).toHaveCount(1);
    await expect(page.getByRole("dialog").locator("li", { hasText: "Supplier price increase" })).toContainText("1,000");
  });

  test("2. import an orders CSV", async ({ page }) => {
    await page.goto("/imports?tab=orders");
    await page.setInputFiles("#file-ORDERS", fixture("orders.csv"));
    await page.click("button:has-text('Validate & preview')");
    await expect(page.getByText("Row errors")).toBeVisible(); // 31/09/2026 is not a date
    await page.click("button:has-text('Import 3 orders')");
    await expect(page.getByRole("button", { name: "Download error CSV" }).first()).toBeVisible();

    // Re-importing the same file finds only duplicates.
    await page.click("button:has-text('Import another file')");
    await page.setInputFiles("#file-ORDERS", fixture("orders.csv"));
    await page.click("button:has-text('Validate & preview')");
    await expect(page.getByText("Nothing new to import")).toBeVisible();
  });

  test("3. import a Meta spend CSV", async ({ page }) => {
    await page.goto("/imports?tab=spend");
    await page.setInputFiles("#file-AD_SPEND", fixture("meta-spend.csv"));
    await page.click("button:has-text('Validate & preview')");
    await page.click("button:has-text('Import 2 spend rows')");
    await expect(page.getByText("2 imported")).toBeVisible();
  });

  test("5. add an expense", async ({ page }) => {
    await page.goto("/expenses");
    await page.getByRole("button", { name: "New expense" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#ed").fill("2026-09-15");
    await dialog.locator("#ea").fill("4500");
    await dialog.locator("#ec").selectOption({ label: "Software" });
    await dialog.locator("#edesc").fill("E2E analytics tool");
    await dialog.getByRole("button", { name: "Add expense" }).click();
    await expect(page.getByRole("cell", { name: "E2E analytics tool" })).toBeVisible();

    // A dollar rate saved in Settings fills in when an expense is paid in USD.
    await page.goto("/settings?tab=economics");
    await page.getByLabel("Add a currency").selectOption("USD");
    await page.locator("#fx-USD").fill("250");
    await page.getByRole("button", { name: "Save exchange rates" }).click();
    await expect(page.getByText("Exchange rates saved")).toBeVisible();

    await page.goto("/expenses");
    await page.getByRole("button", { name: "New expense" }).first().click();
    const usd = page.getByRole("dialog");
    await usd.locator("#ed").fill("2026-09-16");
    await usd.locator("#ea").fill("29");
    await usd.locator("#ea-currency").selectOption("USD");
    await expect(usd.locator("#ea-rate")).toHaveValue("250");
    await expect(usd.getByText(/= DZD.7,250/)).toBeVisible();
    await usd.locator("#edesc").fill("E2E store plan");
    await usd.getByRole("button", { name: "Add expense" }).click();
    const row = page.locator("tr", { hasText: "E2E store plan" });
    await expect(row).toContainText("7,250");
    await expect(row).toContainText(/USD.29 × 250/);
  });

  test("6. view creative matrix metrics", async ({ page }) => {
    await page.goto("/creatives?from=2026-09-01&to=2026-09-30");
    const row = page.locator("tr", { hasText: "cr_e2e_hook_01" });
    await expect(row).toBeVisible();
    // 1 500 + 1 200 DZD of spend over 3 placed orders.
    await expect(row).toContainText("2,700");
    await expect(row).toContainText("900");
  });

  test("6b. show amounts in another currency", async ({ page }) => {
    // Flow 5 saved 1 USD = 250 DZD. Stored amounts stay in DZD; only what is shown changes.
    const matrix = "/creatives?from=2026-09-01&to=2026-09-30";
    await page.goto(matrix);
    const row = page.locator("tr", { hasText: "cr_e2e_hook_01" });
    await expect(row).toContainText("2,700");
    await page.getByLabel("Show amounts in").selectOption("USD");
    await expect(row).toContainText(/USD.10\.80/); // 2 700 DZD at 250

    // The pick follows this browser to every page; the original entry stays visible.
    await page.goto("/expenses");
    const plan = page.locator("tr", { hasText: "E2E store plan" });
    await expect(plan).toContainText(/USD.29 × 250/);
    await expect(plan).not.toContainText("7,250");
    await page.getByLabel("Show amounts in").selectOption("DZD");
    await expect(plan).toContainText("7,250");

    // The workspace default, for everyone, in Settings.
    await page.goto("/settings?tab=workspace");
    await page.locator("#wsc").selectOption("USD");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Workspace saved")).toBeVisible();
    await page.goto(matrix);
    await expect(row).toContainText(/USD.10\.80/);
    await page.goto("/settings?tab=workspace");
    await page.locator("#wsc").selectOption("DZD");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Workspace saved")).toBeVisible();
  });

  test("7. run the breakeven simulator", async ({ page }) => {
    await page.goto("/products");
    await page.getByRole("link", { name: "Breakeven simulator for E2E Lamp" }).click();
    await expect(page.getByRole("heading", { name: "Breakeven CPA simulator" })).toBeVisible();
    await page.fill("#D", "70");
    // (3 900 − 1 000 − 600) × 0.70 − 250 × 0.30 − 120 = 1 415 DZD
    await expect(page.getByText(/1[\s,.  ]?415/).first()).toBeVisible();
  });
});

test.describe("demo workspace MDM (mock adapter)", () => {
  test.beforeEach(async ({ page }) => signIn(page, "demo@codflow.local", "demo-password-123"));

  test("8. configure a test MDM connection without the key reaching the browser", async ({ page }) => {
    workspaceIds.demo = await currentWorkspaceId(page);
    const seen: string[] = [];
    page.on("response", async (r) => { if (r.url().includes("/api/trpc")) seen.push(await r.text().catch(() => "")); });
    await page.goto("/settings?tab=mdm");
    await expect(page.getByText("Demo workspace: syncs use a mocked adapter")).toBeVisible();
    const replace = page.getByRole("button", { name: "Replace key" });
    if (await replace.isVisible()) await replace.click();
    await page.fill("#mdm-key", DEMO_KEY);
    await page.click("button:has-text('Encrypt & save')");
    await expect(page.getByText("••••4242")).toBeVisible();
    await expect(page.locator("#mdm-key")).toHaveCount(0);
    await page.click("button:has-text('Test connection')");
    await expect(page.getByText("Demo adapter responded")).toBeVisible();
    expect(await page.content()).not.toContain(DEMO_KEY);
    expect(seen.join("\n")).not.toContain(DEMO_KEY);
  });

  test("9. start an MDM sync and observe progress", async ({ page }) => {
    await page.goto("/syncs");
    await page.getByRole("button", { name: "Sync now" }).click();
    // The request returns at once; the job runs in the background and the page polls it.
    await expect(page.getByRole("heading", { name: "Sync history" })).toBeVisible();
    await expect(page.getByRole("row", { name: /manual.*(Succeeded|Partial)/ }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("MDM-DEMO-ORPHAN-1")).toBeVisible();
  });

  test("12. connect Meta ads without the token reaching the browser, and sync spend", async ({ page }) => {
    const token = "demo-meta-token-00000000000000007777";
    const second = "demo-meta-token-00000000000000008888";
    const seen: string[] = [];
    page.on("response", async (r) => { if (r.url().includes("/api/trpc")) seen.push(await r.text().catch(() => "")); });
    await page.goto("/settings?tab=meta");
    await expect(page.getByText("Demo workspace: a mocked Meta account")).toBeVisible();
    await page.fill("#meta-label", "Main BM");
    await page.fill("#meta-token", token);
    await page.click("button:has-text('Encrypt & save')");
    await expect(page.getByText("••••7777")).toBeVisible();
    await page.click("button:has-text('Test connection')");
    await expect(page.getByText("It can read 1 ad account")).toBeVisible();
    await expect(page.getByText("Demo ad account (not a real Meta account)")).toBeVisible();
    await page.click("button:has-text('Sync spend now')");
    await expect(page.getByText("Last spend sync")).toBeVisible({ timeout: 30_000 });
    // A second Business Manager gets its own token.
    await page.click("button:has-text('Add Business Manager')");
    await page.fill("#meta-label", "Second BM");
    await page.fill("#meta-token", second);
    await page.click("button:has-text('Encrypt & save')");
    await expect(page.getByText("2 saved, 1 working")).toBeVisible();
    await expect(page.getByText("••••8888")).toBeVisible();
    for (const t of [token, second]) {
      expect(await page.content()).not.toContain(t);
      expect(seen.join("\n")).not.toContain(t);
    }
  });

  test("13. see each campaign's own numbers and link campaigns to a product", async ({ page }) => {
    const name = "LN-03 | Conversions | DZ";
    await page.goto("/campaigns");
    await expect(page.getByRole("heading", { name: "Ad accounts & campaigns" })).toBeVisible();
    // The seeded spend came from a CSV, so its campaigns have no ad account.
    await page.getByLabel("Ad account").selectOption("__none__");
    const row = page.locator("tr", { hasText: "camp_LN-03" });
    await expect(row).toContainText(name);
    await page.getByRole("button", { name: `Show ads of ${name}` }).click();
    await expect(page.locator("tr", { hasText: "cr_ln_story_02" })).toBeVisible();

    // Linked to another product here, its lamp orders are flagged.
    await page.getByLabel(`Product for ${name}`).selectOption({ label: "Mini Blender Go" });
    await expect(page.getByText("Campaign linked")).toBeVisible();
    await expect(row).toContainText("for another product");

    // Unlinked again from the product form.
    await page.goto("/products");
    await page.getByRole("button", { name: "Edit Mini Blender Go" }).click();
    const box = page.getByRole("dialog").getByRole("checkbox", { name: new RegExp(name.replaceAll("|", "\\|")) });
    await expect(box).toBeChecked();
    await box.uncheck();
    await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Product updated")).toBeVisible();
    await page.goto("/campaigns");
    await page.getByLabel("Ad account").selectOption("__none__");
    await expect(page.getByLabel(`Product for ${name}`)).toHaveValue("");
  });

  test("10. review an unmatched parcel", async ({ page }) => {
    await page.goto("/syncs");
    const row = page.locator("tr", { hasText: "MDM-DEMO-ORPHAN-1" });
    await row.getByRole("button", { name: "Link" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Link parcel to an order")).toBeVisible();
    // Its MDM reference matches no order; search for the right one by number.
    await expect(dialog.getByText("No matching orders.")).toBeVisible();
    await dialog.locator("#lk").fill("ES-10007");
    await dialog.locator("tr", { hasText: "ES-10007" }).getByRole("button", { name: "Link" }).click();
    await expect(page.getByText("Parcel MDM-DEMO-ORPHAN-1 linked")).toBeVisible();
    await expect(page.locator("tr", { hasText: "MDM-DEMO-ORPHAN-1" })).toHaveCount(0);
    await page.getByRole("tab", { name: "Resolved" }).click();
    await expect(page.locator("tr", { hasText: "MDM-DEMO-ORPHAN-1" })).toBeVisible();
  });
});

test("11. another business cannot reach either workspace's data", async ({ page }) => {
  expect(workspaceIds.e2e && workspaceIds.demo).toBeTruthy();
  await signIn(page, "other@codflow.local", "other-password-123");
  for (const ws of [workspaceIds.e2e!, workspaceIds.demo!]) {
    for (const proc of ["orders.list", "integrations.mdm", "sync.list", "expenses.list"]) {
      const res = await trpcQuery(page, proc, ws);
      expect(res.status, `${proc} on a foreign workspace`).toBe(403);
      expect(res.body).not.toContain("E2E analytics tool");
      expect(res.body).not.toContain("4242");
    }
  }
  // Its own data still loads, and none of the E2E orders appear in it.
  const own = await trpcQuery(page, "orders.list");
  expect(own.status).toBe(200);
  expect(own.body).not.toContain("E2E-1");
  await page.goto("/orders");
  await expect(page.getByText("#E2E-1")).toHaveCount(0);
});
