// A template copied on its own installs and runs (relyingparty-app-ubgp): pnpm reads build approvals only
// from a pnpm-workspace.yaml (pnpm 11 and later ignore the "pnpm" field of package.json), so each template
// carries one. That file makes the template its own workspace root for any pnpm started inside it, so no
// template script, and no tool a script starts, may run pnpm again: pnpm would install there first.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const TEMPLATES = readdirSync('templates').filter((name) => existsSync(`templates/${name}/package.json`))
const text = (path) => readFileSync(path, 'utf8')

/** The allowBuilds block of a pnpm-workspace.yaml: its key and indented lines. */
const allowBuilds = (path) => {
	const lines = text(path).split('\n')
	const start = lines.indexOf('allowBuilds:')
	assert.ok(start !== -1, `${path} has no allowBuilds block`)
	const block = []
	for (const line of lines.slice(start + 1)) {
		if (!/^\s+\S/.test(line)) break
		block.push(line.trim())
	}
	return block
}

test('each template approves the same builds as the repo, in its own pnpm-workspace.yaml', () => {
	const root = allowBuilds('pnpm-workspace.yaml')
	for (const name of TEMPLATES) {
		const path = `templates/${name}/pnpm-workspace.yaml`
		assert.ok(existsSync(path), `${path} is missing: a copy of templates/${name} fails pnpm install (ERR_PNPM_IGNORED_BUILDS)`)
		assert.deepEqual(allowBuilds(path), root, `${path} approves other builds than pnpm-workspace.yaml`)
	}
})

test('no template script runs pnpm, which would install inside the template', () => {
	for (const name of TEMPLATES) {
		const { scripts = {} } = JSON.parse(text(`templates/${name}/package.json`))
		for (const [script, command] of Object.entries(scripts)) {
			assert.ok(!/\bpnpm\b/.test(command), `templates/${name} script "${script}" runs pnpm: ${command}`)
		}
	}
})

test('OpenNext builds Next.js itself, not through the package manager', () => {
	assert.match(text('templates/nextjs/open-next.config.ts'), /buildCommand: "next build"/)
})
