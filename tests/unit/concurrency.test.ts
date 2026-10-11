import { describe, expect, it } from "vitest";
import { createLock, mapLimit, readAhead } from "@/lib/concurrency";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe("several at a time", () => {
  it("keeps the order and never runs more than the limit", async () => {
    let running = 0;
    let most = 0;
    const out = await mapLimit([5, 1, 4, 2, 3, 0], 3, async (n, i) => {
      running++;
      most = Math.max(most, running);
      await tick(n);
      running--;
      return `${i}:${n}`;
    });
    expect(out).toEqual(["0:5", "1:1", "2:4", "3:2", "4:3", "5:0"]);
    expect(most).toBe(3);
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });

  it("starts nothing new after a failure, lets the running ones finish, then throws", async () => {
    const started: number[] = [];
    const finished: number[] = [];
    const run = mapLimit([0, 1, 2, 3, 4, 5], 2, async (n) => {
      started.push(n);
      if (n === 1) throw new Error("boom");
      await tick(10);
      finished.push(n);
    });
    await expect(run).rejects.toThrow("boom");
    expect(started).toEqual([0, 1]);
    expect(finished).toEqual([0]);
  });

  it("a lock runs one at a time, in order, even after a failure", async () => {
    const lock = createLock();
    const log: string[] = [];
    const job = (name: string, ms: number, fail = false) =>
      lock(async () => {
        log.push(`start ${name}`);
        await tick(ms);
        log.push(`end ${name}`);
        if (fail) throw new Error(name);
        return name;
      });
    const results = await Promise.allSettled([job("a", 15), job("b", 1, true), job("c", 1)]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("a read started ahead fails only where its result is taken", async () => {
    const ahead = readAhead("page-2", () => Promise.reject(new Error("offline")));
    await tick();
    expect(ahead.key).toBe("page-2");
    await expect(ahead.promise).rejects.toThrow("offline");
  });
});
