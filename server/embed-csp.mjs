const SELF = "'self'"

function asOrigin(value) {
  try {
    const url = new URL(value)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    )
      return null
    return url.origin
  } catch {
    return null
  }
}

/**
 * Builds the allowlist for the embedded chat page. The application itself is
 * always permitted so the bundled portal demo and same-origin integrations
 * keep working; configured origins are additive.
 */
export function embedFrameAncestors(allowedOrigins) {
  const sources = new Set([SELF])
  for (const value of (allowedOrigins || '').split(/[\s,]+/)) {
    if (!value || value === SELF || value === 'self') continue
    const origin = asOrigin(value)
    if (origin) sources.add(origin)
  }
  return [...sources].join(' ')
}

export function embedContentSecurityPolicy(allowedOrigins) {
  return `frame-ancestors ${embedFrameAncestors(allowedOrigins)}`
}
