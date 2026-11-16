import { describe, expect, it } from 'vitest'
import { embedContentSecurityPolicy, embedFrameAncestors } from '../server/embed-csp.mjs'

describe('embedded chat CSP', () => {
  it('defaults to same-origin framing', () => {
    expect(embedFrameAncestors()).toBe("'self'")
    expect(embedContentSecurityPolicy()).toBe("frame-ancestors 'self'")
  })

  it('adds explicitly configured portal origins without trusting malformed values', () => {
    expect(
      embedFrameAncestors(
        'https://portal.example.com, http://localhost:8080 invalid https://bad.example.com/path',
      ),
    ).toBe("'self' https://portal.example.com http://localhost:8080")
  })
})
