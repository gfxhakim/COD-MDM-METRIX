import { createCallerFactory, router } from "@/server/trpc/init";
import { auditRouter, membersRouter, workspaceRouter } from "@/server/trpc/routers/workspace";
import { productsRouter } from "@/server/trpc/routers/products";
import { ordersRouter } from "@/server/trpc/routers/orders";
import { expensesRouter } from "@/server/trpc/routers/expenses";

export const appRouter = router({
  workspace: workspaceRouter,
  members: membersRouter,
  audit: auditRouter,
  products: productsRouter,
  orders: ordersRouter,
  expenses: expensesRouter,
});

export type AppRouter = typeof appRouter;
export const createCaller = createCallerFactory(appRouter);
