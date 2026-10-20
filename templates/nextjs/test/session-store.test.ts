// The Durable Object behind each record, on an in-memory storage with the runtime's alarm calls.
import { describe, expect, it, vi } from "vitest";
import { SessionRecords } from "../src/session-store";

const records = () => {
  const data = new Map<string, unknown>();
  let alarm: number | null = null;
  const storage = {
    get: async (key: string) => data.get(key),
    put: async (key: string, value: unknown) => {
      data.set(key, structuredClone(value));
    },
    deleteAll: async () => {
      data.clear();
    },
    setAlarm: async (at: number) => {
      alarm = at;
    },
    deleteAlarm: async () => {
      alarm = null;
    },
  };
  const object = new SessionRecords({ storage } as unknown as DurableObjectState, {});
  return { object, data, alarm: () => alarm };
};

describe("SessionRecords", () => {
  it("keeps a record and sets the alarm at its deleteAt", async () => {
    const { object, alarm } = records();
    const deleteAt = Date.now() + 60_000;
    await object.put({ sub: "a" }, deleteAt);
    expect(await object.get()).toEqual({ sub: "a" });
    expect(alarm()).toBe(deleteAt);
  });

  it("gives a record to one take only", async () => {
    const { object, alarm } = records();
    await object.put({ state: "s" }, Date.now() + 60_000);
    expect(await object.take()).toEqual({ state: "s" });
    expect(await object.take()).toBeUndefined();
    expect(alarm()).toBeNull();
  });

  it("hides a record whose deleteAt has passed, before the alarm runs", async () => {
    const { object } = records();
    vi.useFakeTimers({ now: 1_000_000 });
    await object.put({ sub: "a" }, 1_000_000 + 1_000);
    vi.setSystemTime(1_000_000 + 1_000);
    expect(await object.get()).toBeUndefined();
    vi.useRealTimers();
  });

  it("deletes the record when the alarm runs", async () => {
    const { object, data } = records();
    await object.put({ sub: "a" }, Date.now() + 60_000);
    await object.alarm();
    expect(data.size).toBe(0);
  });
});
