import path from 'node:path'

const documentRoutes = new Map([
  ['/', '/index.html'],
  ['/embed/', '/embed/index.html'],
  ['/portal-demo/', '/portal-demo/index.html'],
])

const trailingSlashRedirects = new Map([
  ['/embed', '/embed/'],
  ['/portal-demo', '/portal-demo/'],
])

export function resolveStaticRoute(pathname) {
  const redirect = trailingSlashRedirects.get(pathname)
  if (redirect) return { redirect }
  return { pathname: documentRoutes.get(pathname) || pathname }
}

export function resolveStaticFile(root, pathname, paths = path) {
  const route = resolveStaticRoute(pathname)
  if ('redirect' in route) return null
  const file = paths.resolve(root, '.' + route.pathname)
  const relative = paths.relative(root, file)
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith('..' + paths.sep) ||
    paths.isAbsolute(relative)
  )
    return null
  return file
}
