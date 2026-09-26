import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/server/trpc/root";
import { createContextFromHeaders } from "@/server/trpc/init";

/**
 * CSRF: session cookies are SameSite=Lax and mutations are POST with a JSON body.
 * We additionally reject cross-origin POSTs by checking Origin against Host.
 */
function isSameOrigin(req: Request): boolean {
  if (req.method === "GET") return true;
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients (tests, curl) have no ambient cookies to abuse
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const handler = (req: Request) => {
  if (!isSameOrigin(req)) return new Response("Cross-origin request rejected", { status: 403 });
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContextFromHeaders(req.headers),
    onError({ error, path }) {
      if (error.code === "INTERNAL_SERVER_ERROR") console.error(`[trpc] ${path}:`, error.cause ?? error);
    },
  });
};

export { handler as GET, handler as POST };
