export interface NamedRouteTarget {
  name: string;
}

export interface PermissionMeta {
  requiredPermission?: string;
  requiredPermissionsAnyOf?: string[];
}

export function hasRouteAccess(permissions: string[] | undefined, meta: PermissionMeta): boolean {
  const granted = new Set(permissions ?? []);
  if (meta.requiredPermission && !granted.has(meta.requiredPermission)) {
    return false;
  }
  if (
    meta.requiredPermissionsAnyOf?.length &&
    !meta.requiredPermissionsAnyOf.some((permission) => granted.has(permission))
  ) {
    return false;
  }
  return true;
}

export function authenticatedLandingRoute(permissions: string[] | undefined): NamedRouteTarget {
  if (permissions?.includes('tenant.read')) {
    return { name: 'dashboard' };
  }
  if (permissions?.includes('membership.read')) {
    return { name: 'users' };
  }
  if (permissions?.includes('model_catalog.read') || permissions?.includes('tenant_model.read')) {
    return { name: 'models' };
  }
  if (permissions?.includes('credits.manage')) {
    return { name: 'credits' };
  }
  return { name: 'forbidden' };
}
