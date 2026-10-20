// A stand-in for the Workers runtime module "cloudflare:workers" in the Node tests (vitest.config.ts):
// the DurableObject base class keeps ctx and env, as the runtime's does.
export class DurableObject<Env = unknown> {
  constructor(
    protected readonly ctx: DurableObjectState,
    protected readonly env: Env
  ) {}
}
