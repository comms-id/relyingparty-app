// Each template is a registered IdX client (relyingparty-app-ycka): alchemy.run.ts names its client id, and
// then binds the inherited COMMS_ID_PRIVATE_JWK that `npx comms-id key` wrote, so every deploy keeps it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const stack = readFileSync('alchemy.run.ts', 'utf8')

const clientIds = () => {
	const block = /export const CLIENT_IDS[^=]*=\s*\{([^}]*)\}/.exec(stack)
	assert.ok(block, 'alchemy.run.ts has no CLIENT_IDS object')
	return Object.fromEntries([...block[1].matchAll(/(\w+):\s*"([^"]*)"/g)].map((match) => [match[1], match[2]]))
}

test('CLIENT_IDS names the IdX client id of each template', () => {
	const ids = clientIds()
	for (const template of ['Html', 'React', 'Nextjs']) {
		// IdX client ids: at least 32 characters of [a-z0-9] (shared-globals ENFORCED_MIN_CLIENT_ID_LENGTH).
		assert.match(ids[template] ?? '', /^[a-z0-9]{32,}$/, `CLIENT_IDS.${template} is not an IdX client id`)
	}
	assert.equal(new Set(Object.values(ids)).size, Object.values(ids).length, 'two templates share a client id')
})

test('a registered template inherits its private key on every deploy', () => {
	assert.match(stack, /type: "inherit", name: "COMMS_ID_PRIVATE_JWK"/)
	assert.match(stack, /if \(template && clientId !== undefined\)/)
})
