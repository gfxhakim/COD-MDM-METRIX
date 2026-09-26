import { z } from "zod";
import { CostType, ExpenseAllocation, ExpenseCategory, NormalizedStatus, OrderSource, OrderStatus, Role } from "@prisma/client";

export const id = z.string().uuid();
/** Money crosses the API as integer minor units. */
export const minor = z.number().int().min(0).max(1_000_000_000_00);
export const optionalText = (max = 200) => z.string().trim().max(max).optional();

export const costInput = z.object({
  salePrice: minor,
  sourcingCost: minor,
  forwardShippingFee: minor,
  rtoFee: minor,
  callCenterFee: minor,
  packagingFee: minor,
});

export const roleEnum = z.enum(Role);
export const orderStatusEnum = z.enum(OrderStatus);
export const normalizedStatusEnum = z.enum(NormalizedStatus);
export const orderSourceEnum = z.enum(OrderSource);
export const expenseCategoryEnum = z.enum(ExpenseCategory);
export const expenseAllocationEnum = z.enum(ExpenseAllocation);
export const costTypeEnum = z.enum(CostType);

export const expenseInput = z
  .object({
    date: z.coerce.date(),
    category: expenseCategoryEnum,
    amount: minor.refine((v) => v > 0, "Amount must be greater than zero"),
    description: optionalText(500),
    allocation: expenseAllocationEnum,
    productId: id.nullish(),
    costType: costTypeEnum,
  })
  .refine((v) => v.allocation === "GLOBAL" || !!v.productId, { message: "Choose a product", path: ["productId"] });
