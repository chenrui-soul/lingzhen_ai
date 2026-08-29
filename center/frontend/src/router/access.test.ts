import { authenticatedLandingRoute, hasRouteAccess } from '@/router/access';

describe('router access', () => {
  it('accepts any granted permission from an any-of route', () => {
    const meta = { requiredPermissionsAnyOf: ['model_catalog.read', 'tenant_model.read'] };

    expect(hasRouteAccess(['model_catalog.read'], meta)).toBe(true);
    expect(hasRouteAccess(['tenant_model.read'], meta)).toBe(true);
    expect(hasRouteAccess(['tenant.read'], meta)).toBe(false);
  });

  it('uses the model catalog as a valid authenticated landing page', () => {
    expect(authenticatedLandingRoute(['tenant_model.read'])).toEqual({ name: 'models' });
    expect(authenticatedLandingRoute(['model_catalog.read'])).toEqual({ name: 'models' });
    expect(authenticatedLandingRoute(['credits.manage'])).toEqual({ name: 'credits' });
    expect(authenticatedLandingRoute([])).toEqual({ name: 'forbidden' });
  });
});
