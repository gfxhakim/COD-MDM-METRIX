import { createCallerFactory, router } from "@/server/trpc/init";
import { auditRouter, membersRouter, workspaceRouter } from "@/server/trpc/routers/workspace";
import { productsRouter } from "@/server/trpc/routers/products";
import { campaignsRouter } from "@/server/trpc/routers/campaigns";
import { ordersRouter } from "@/server/trpc/routers/orders";
import { expensesRouter } from "@/server/trpc/routers/expenses";
import { bankRouter, importsRouter, spendReviewRouter } from "@/server/trpc/routers/imports";
import { integrationsRouter, syncRouter } from "@/server/trpc/routers/mdm";
import { moneyRouter } from "@/server/trpc/routers/money";
import { creativesRouter, reportsRouter, simulatorRouter } from "@/server/trpc/routers/economics";

export const appRouter = router({
  workspace: workspaceRouter,
  members: membersRouter,
  audit: auditRouter,
  products: productsRouter,
  orders: ordersRouter,
  expenses: expensesRouter,
  reports: reportsRouter,
  creatives: creativesRouter,
  campaigns: campaignsRouter,
  simulator: simulatorRouter,
  imports: importsRouter,
  bank: bankRouter,
  spendReview: spendReviewRouter,
  integrations: integrationsRouter,
  sync: syncRouter,
  money: moneyRouter,
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
