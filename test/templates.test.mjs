// What every template must keep true as a relying party copies it (NORTHSTAR.md "What must stay true").
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const TEMPLATES = readdirSync('templates').filter((name) => existsSync(`templates/${name}/package.json`))
const PACKAGES = ['site', ...TEMPLATES.map((name) => `templates/${name}`)]
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const text = (path) => readFileSync(path, 'utf8')

// The core every template shares, byte for byte (ADR-0068: one core, thin adapters).
const SHARED = ['src/comms-id-auth.ts', 'src/session-store.ts', 'test/comms-id-auth.test.ts', 'test/session-store.test.ts', 'test/cloudflare-workers.ts']

test('the three templates are here', () => {
	assert.deepEqual([...TEMPLATES].sort(), ['html', 'nextjs', 'react'])
})

test('every template has the same sign-in core, session store and core tests', () => {
	for (const file of SHARED) {
		const [first, ...rest] = TEMPLATES
		for (const name of rest) {
			assert.equal(text(`templates/${name}/${file}`), text(`templates/${first}/${file}`), `templates/${name}/${file} differs from templates/${first}/${file}`)
		}
	}
})

test('every dependency is an exact registry version, so a copied template installs as it is', () => {
	for (const dir of ['.', ...PACKAGES]) {
		const manifest = JSON.parse(text(`${dir}/package.json`))
		for (const [name, version] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
			assert.match(version, /^(npm:[@\w./-]+@)?\d+\.\d+\.\d+(-[\w.]+)?$/, `${dir}/package.json: ${name} is "${version}", not an exact version`)
		}
	}
})

test('no local package override is tracked: no pnpmfile, and no local path in the lockfile', () => {
	assert.ok(!tracked.some((path) => path.endsWith('.pnpmfile.cjs')), '.pnpmfile.cjs is tracked: it rewrites what pnpm installs')
	const lockfile = text('pnpm-lock.yaml')
	// A spec, not a package name that ends in "file" (proper-lockfile, get-caller-file).
	for (const local of [/(^|[\s'"@])(file|link):/m, /\.agent-scope-tmp/]) {
		assert.ok(!local.test(lockfile), `pnpm-lock.yaml matches ${local}: install from the registry only`)
	}
})

test('nothing secret is tracked: no private JWK, no .dev.vars, no .env', () => {
	for (const path of tracked) {
		assert.ok(!/(^|\/)(\.dev\.vars|\.env)/.test(path), `${path} is tracked: settings files hold secrets`)
		if (/\.(json|jsonc|ts|tsx|js|mjs|md|html|toml|yaml)$/.test(path)) {
			assert.ok(!/"(priv|d)"\s*:\s*"/.test(text(path)), `${path} holds a private key member ("priv" or "d")`)
		}
	}
})

test('no tracked file names a loopback host: every URL works off this machine', () => {
	const loopback = new RegExp(['local' + 'host', '127\\.0\\.0\\.1', '\\[::1\\]'].join('|'), 'i')
	for (const path of tracked.filter((path) => path !== 'pnpm-lock.yaml' && existsSync(path))) {
		assert.ok(!loopback.test(text(path)), `${path} names a loopback host`)
	}
})

test("the templates offer only Comms.ID's own sign-in (NORTHSTAR 2)", () => {
	const other = /turnstile|captcha|magic link|passkey|one-time code|sms code/i
	for (const path of tracked.filter((path) => /^(site|templates)\//.test(path))) {
		assert.ok(!other.test(text(path)), `${path} offers a sign-in method that is not Comms.ID's`)
	}
})

// wrangler.jsonc as alchemy.run.ts reads it: whole-line // comments only.
const wranglerConfig = (dir) =>
	JSON.parse(
		text(`${dir}/wrangler.jsonc`)
			.split('\n')
			.filter((line) => !line.trimStart().startsWith('//'))
			.join('\n'),
	)

test('the stack deploys each template on its own host, with its own redirect URI and sector document', () => {
	const stack = text('alchemy.run.ts')
	const names = new Set()
	for (const name of TEMPLATES) {
		const host = `${name}.relyingparty.app`
		assert.ok(stack.includes(`dir: "templates/${name}", host: "${host}"`), `alchemy.run.ts does not deploy templates/${name} on ${host}`)
		const config = wranglerConfig(`templates/${name}`)
		assert.equal(config.vars.COMMS_ID_REDIRECT_URI, `https://${host}/auth/callback`, `templates/${name}/wrangler.jsonc names another redirect URI`)
		assert.ok(config.compatibility_flags.includes('webcrypto_modern_algorithms'), `templates/${name} has no ML-DSA-87 in Web Crypto`)
		assert.deepEqual(config.durable_objects.bindings, [{ name: 'SESSIONS', class_name: 'SessionRecords' }])
		assert.ok(!names.has(config.name), `two templates share the Worker name ${config.name}`)
		names.add(config.name)
	}
	assert.ok(stack.includes('dir: "site", host: "relyingparty.app"'), 'alchemy.run.ts does not deploy the front page on relyingparty.app')
	assert.equal(wranglerConfig('site').name, JSON.parse(text('factory.json')).worker, 'factory.json worker is not the site Worker')
})
