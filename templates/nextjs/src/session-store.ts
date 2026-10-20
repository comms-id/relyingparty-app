// One pending sign-in or one session per Durable Object (comms-id-auth.ts durableStore names it).
// Not KV: a KV write can take a minute to be seen elsewhere, and the callback must see the
// pending record at once and use it once. The alarm deletes the record at its deleteAt.
// The same file in every relyingparty.app template.

import { DurableObject } from "cloudflare:workers";

interface Stored {
  readonly deleteAt: number;
  readonly value: unknown;
}

const KEY = "record";

export class SessionRecords extends DurableObject {
  async put(value: unknown, deleteAt: number): Promise<void> {
    await this.ctx.storage.put<Stored>(KEY, { value, deleteAt });
    await this.ctx.storage.setAlarm(deleteAt);
  }

  /** The record, or undefined once its deleteAt has passed (even before the alarm runs). */
  async get(): Promise<unknown> {
    const stored = await this.ctx.storage.get<Stored>(KEY);
    return stored === undefined || stored.deleteAt <= Date.now() ? undefined : stored.value;
  }

  /** Reads and deletes in one call: a second take of the same record gets nothing. */
  async take(): Promise<unknown> {
    const value = await this.get();
    await this.delete();
    return value;
  }

  async delete(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
