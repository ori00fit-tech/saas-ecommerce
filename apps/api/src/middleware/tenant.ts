// apps/api/src/middleware/tenant.ts
import type { MiddlewareHandler } from 'hono';
import { createDb } from '@repo/db';
import type { AppContext } from '../index.js';

/**
 * Resolves tenant from:
 * 1) X-Tenant-Slug header (preferred)
 * 2) Host subdomain
 * 3) Path: /store/{slug}/... or /t/{slug}/...
 */
export function resolveTenant(): MiddlewareHandler<AppContext> {
  return async (c, next) => {
    const db = createDb(c.env.DB);

    const slug = extractTenantSlugFromContext(c);
    if (!slug) return c.json({ error: 'Tenant not found' }, 404);

    const tenant = await db.query.tenants.findFirst({
      where: (t, { eq, and }) => and(eq(t.slug, slug), eq(t.isActive, true)),
    });

    if (!tenant) return c.json({ error: 'Store not found or inactive' }, 404);

    // OPTIONAL: only enforce membership when user is authenticated
    const userId = c.get('userId');
    if (userId) {
      const membership = await db.query.memberships.findFirst({
        where: (m, { eq, and }) => and(eq(m.tenantId, tenant.id), eq(m.userId, userId)),
      });
      if (!membership) return c.json({ error: 'Access denied to this store' }, 403);
      c.set('role', membership.role);
    }

    c.set('tenantId', tenant.id);
    c.set('plan', tenant.plan);

    await next();
  };
}

function extractTenantSlugFromContext(c: any): string | null {
  // 1) Header
  const headerSlug = c.req.header?.('X-Tenant-Slug') || c.req.header?.('x-tenant-slug');
  if (headerSlug) return String(headerSlug).toLowerCase().trim();

  // 2) Subdomain from Host
  const host = c.req.header?.('Host') || c.req.header?.('host') || '';
  const subdomain = String(host).split('.')[0];
  const ignored = new Set(['www', 'api', 'app', 'admin', 'localhost']);
  if (subdomain && !ignored.has(subdomain) && !subdomain.includes(':')) {
    return subdomain.toLowerCase();
  }

  // 3) Path fallback
  const path = c.req.path || new URL(c.req.url).pathname;
  const match = String(path).match(/^\/(?:store|t)\/([a-z0-9-]+)/);
  if (match) return match[1].toLowerCase();

  return null;
}
