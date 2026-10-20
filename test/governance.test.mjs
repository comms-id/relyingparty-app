import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

test('the five governance files are present', () => {
	for (const path of ['NORTHSTAR.md', 'CONTRACT.md', 'AGENTS.md', 'factory.json', 'decisions/0001-templates-live-in-one-repo.md']) {
		assert.ok(existsSync(path), `${path} is missing`)
	}
})

test('factory.json states verify and both postures', () => {
	const factory = JSON.parse(readFileSync('factory.json', 'utf8'))
	for (const key of ['verify', 'drq', 'pq']) assert.equal(typeof factory[key], 'string', `factory.json has no ${key}`)
})
