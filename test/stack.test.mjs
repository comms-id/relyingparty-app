// The stack's tools load: ship imports these before it deploys anything, and tsc does not run them.
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('alchemy/Cloudflare and @effect/platform-node load with the pinned effect', async () => {
	const cloudflare = await import('alchemy/Cloudflare')
	assert.equal(typeof cloudflare.Worker, 'function')
	const node = await import('@effect/platform-node')
	assert.ok(node.NodeServices ?? node.NodeContext ?? node.NodeRuntime, '@effect/platform-node has no Node layer')
})
