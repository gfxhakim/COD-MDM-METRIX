import { initTRPC, TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import superjson from "superjson";
import { ZodError } from "zod";
import { CostVersionError } from "@/domain/costVersions";
import { MoneyError } from "@/lib/money";
import { RateLimitError } from "@/server/rateLimit";
import { getUserForToken, type SessionUser } from "@/server/auth/session";
import { assertCan, ForbiddenError, NotFoundError, resolveWorkspaceContext, type Permission, type WorkspaceContext } from "@/server/tenancy";

export type TRPCContext = {
  user: SessionUser | null;
  /** Workspace explicitly requested via x-workspace-id. Untrusted; must match a membership or the call is rejected. */
  requestedWorkspaceId: string | null;
  /** Last-used workspace from cookie. Untrusted; falls back to another membership if invalid. */
  preferredWorkspaceId?: string | null;
};

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export async function createContextFromHeaders(headers: Headers): Promise<TRPCContext> {
  const cookie = headers.get("cookie");
  const token = readCookie(cookie, "cft_session");
  const user = token ? await getUserForToken(token) : null;
  return { user, requestedWorkspaceId: headers.get("x-workspace-id"), preferredWorkspaceId: readCookie(cookie, "cft_ws") };
}

const t = initTRPC.context<TRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    const zod = error.cause instanceof ZodError ? error.cause.flatten() : null;
    return { ...shape, data: { ...shape.data, stack: undefined, zodError: zod } };
  },
});

/**
 * Map domain errors to safe tRPC errors. Unknown errors are logged server-side
 * and returned to the browser with a generic message only.
 */
const errorMapper = t.middleware(async ({ next, path }) => {
  const result = await next();
  if (result.ok) return result;
  const err = result.error;
  const cause = err.cause ?? err;
  if (cause instanceof TRPCError || err.code !== "INTERNAL_SERVER_ERROR") return result;
  if (cause instanceof ForbiddenError) throw new TRPCError({ code: "FORBIDDEN", message: cause.message });
  if (cause instanceof NotFoundError) throw new TRPCError({ code: "NOT_FOUND", message: cause.message });
  if (cause instanceof CostVersionError || cause instanceof MoneyError) throw new TRPCError({ code: "BAD_REQUEST", message: cause.message });
  if (cause instanceof RateLimitError) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: cause.message });
  if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === "P2002") {
    throw new TRPCError({ code: "CONFLICT", message: "A record with the same unique value already exists" });
  }
  console.error(`[trpc] ${path} failed`, cause);
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Something went wrong. The error was logged." });
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure.use(errorMapper);

export const authedProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Please sign in" });
  return next({ ctx: { ...ctx, user: ctx.user } });
});

export const workspaceProcedure = authedProcedure.use(async ({ ctx, next }) => {
  const ws: WorkspaceContext | null = await resolveWorkspaceContext(ctx.user.id, ctx.requestedWorkspaceId ?? ctx.preferredWorkspaceId);
  if (!ws) throw new TRPCError({ code: "FORBIDDEN", message: "You are not a member of any workspace" });
  if (ctx.requestedWorkspaceId && ws.workspaceId !== ctx.requestedWorkspaceId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "You do not have access to this workspace" });
  }
  return next({ ctx: { ...ctx, ws } });
});

export const permitted = (permission: Permission) =>
  workspaceProcedure.use(({ ctx, next }) => {
    try {
      assertCan(ctx.ws, permission);
    } catch (e) {
      throw new TRPCError({ code: "FORBIDDEN", message: (e as Error).message });
    }
    return next();
  });
