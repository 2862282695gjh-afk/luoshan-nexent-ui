import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { resolveStaticFile, resolveStaticRoute } from '../server/static-path.mjs'

for (const [name, paths, root] of [
  ['POSIX', path.posix, '/opt/luoshan/dist'],
  ['Windows', path.win32, 'C:\\园区助手\\dist'],
] as const) {
  describe(`${name} static files`, () => {
    it('serves the homepage and nested assets', () => {
      expect(resolveStaticFile(root, '/', paths)).toBe(paths.join(root, 'index.html'))
      expect(resolveStaticFile(root, '/embed/', paths)).toBe(
        paths.join(root, 'embed', 'index.html'),
      )
      expect(resolveStaticFile(root, '/portal-demo/', paths)).toBe(
        paths.join(root, 'portal-demo', 'index.html'),
      )
      expect(resolveStaticFile(root, '/assets/app.js', paths)).toBe(
        paths.join(root, 'assets', 'app.js'),
      )
    })
    it('rejects traversal, sibling directories and the directory itself', () => {
      for (const url of [
        '/../.env',
        '/../dist-backup/private.js',
        '/assets/../../.env',
        '/assets/..',
      ])
        expect(resolveStaticFile(root, url, paths)).toBeNull()
    })
  })
}

it('rejects Windows backslash traversal after URL decoding', () => {
  expect(
    resolveStaticFile('C:\\园区助手\\dist', decodeURIComponent('/..%5c.env'), path.win32),
  ).toBeNull()
})

describe('standalone document routes', () => {
  it('canonicalizes embedded and portal document URLs without broad fallback', () => {
    expect(resolveStaticRoute('/embed')).toEqual({ redirect: '/embed/' })
    expect(resolveStaticRoute('/portal-demo')).toEqual({ redirect: '/portal-demo/' })
    expect(resolveStaticRoute('/embed/')).toEqual({ pathname: '/embed/index.html' })
    expect(resolveStaticRoute('/portal-demo/')).toEqual({ pathname: '/portal-demo/index.html' })
    expect(resolveStaticRoute('/not-a-page/')).toEqual({ pathname: '/not-a-page/' })
  })
})
