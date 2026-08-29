import 'vue-router';

export {};

declare module 'vue-router' {
  interface RouteMeta {
    title: string;
    isPublic?: boolean;
    requiresAuth?: boolean;
    requiredPermission?: string;
    requiredPermissionsAnyOf?: string[];
  }
}
