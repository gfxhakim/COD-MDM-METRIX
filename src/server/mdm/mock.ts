import { MdmError, type MdmAdapter, type MdmPage, type MdmParcel } from "./types";

/**
 * Mocked MDM adapter serving clearly labelled DEMO fixtures. It never makes a
 * network call. It exists so the whole sync pipeline can be exercised before
 * the live adapter is implemented from the verified OpenAPI schema.
 *
 * `failures` lets tests script provider errors per page (e.g. two 429s, then success).
 */
export type MockOptions = {
  fixtures: MdmParcel[];
  /** A credential beginning with "invalid" is rejected, to demo the error path. */
  credential: string | null;
  failures?: Record<number, MdmError[]>;
  latencyMs?: number;
};

export function createMockAdapter(opts: MockOptions): MdmAdapter {
  const failures = new Map(Object.entries(opts.failures ?? {}).map(([k, v]) => [Number(k), [...v]]));
  const wait = (signal?: AbortSignal) => (opts.latencyMs ? new Promise<void>((r, j) => { const t = setTimeout(r, opts.latencyMs); signal?.addEventListener("abort", () => { clearTimeout(t); j(new MdmError("Aborted", "NETWORK")); }); }) : Promise.resolve());
  const checkAuth = () => {
    if (!opts.credential) throw new MdmError("No credential saved for this workspace", "CONFIG");
    if (opts.credential.startsWith("invalid")) throw new MdmError("MDM rejected the credential (demo)", "AUTH");
  };
  return {
    kind: "mock",
    async testConnection(signal) {
      await wait(signal);
      checkAuth();
      return { accountLabel: "Demo fixtures (not a real MDM account)" };
    },
    async listParcels({ cursor, updatedSince, pageSize }, signal): Promise<MdmPage> {
      await wait(signal);
      checkAuth();
      const page = cursor ? Number(cursor) : 0;
      const queued = failures.get(page);
      if (queued?.length) throw queued.shift()!;
      const all = updatedSince ? opts.fixtures.filter((p) => !p.statusAt || p.statusAt >= updatedSince) : opts.fixtures;
      const items = all.slice(page * pageSize, (page + 1) * pageSize);
      const more = (page + 1) * pageSize < all.length;
      return { items, nextCursor: more ? String(page + 1) : null, total: all.length };
    },
  };
}
