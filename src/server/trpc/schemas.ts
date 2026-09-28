import { z } from "zod";
import { currencyCodeSchema } from "@/domain/settings";
import { CostType, ExpenseAllocation, ExpenseCategory, NormalizedStatus, OrderSource, OrderStatus, Role } from "@prisma/client";

export const id = z.string().uuid();
/** Money crosses the API as integer minor units. */
export const minor = z.number().int().min(0).max(1_000_000_000_00);
export const optionalText = (max = 200) => z.string().trim().max(max).optional();

/** Units of the workspace currency per 1 unit of another currency. */
export const fxRate = z.number().positive().max(1_000_000);

export const costInput = z.object({
  salePrice: minor,
  /** In `sourcingCurrency` when given; every other field is in the workspace currency. */
  sourcingCost: minor,
  forwardShippingFee: minor,
  rtoFee: minor,
  callCenterFee: minor,
  packagingFee: minor,
  sourcingCurrency: currencyCodeSchema.optional(),
  sourcingFxRate: fxRate.nullish(),
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
    /** Currency `amount` is in. Defaults to the workspace currency. */
    currency: currencyCodeSchema.optional(),
    fxRate: fxRate.nullish(),
  })
  .refine((v) => v.allocation === "GLOBAL" || !!v.productId, { message: "Choose a product", path: ["productId"] });
