/**
 * Fixed catalog of portal permissions.
 *
 * Permissions are plain strings assigned to users through user_permissions
 * and checked deny-by-default on every route. The catalog lives in code so
 * the runtime attack surface stays minimal: nothing can invent a new
 * permission through configuration or database writes alone.
 */
export const PORTAL_PERMISSIONS = [
  "portal.users.read",
  "portal.users.write",
  "portal.clients.read",
  "portal.clients.write",
  "portal.resources.write",
  "portal.tokens.revoke",
  "portal.consents.revoke",
  "portal.audit.read",
  "portal.signins.read",
  "portal.privileged.read",
  "portal.admins.manage",
  "portal.settings.write",
] as const;

export type PortalPermission = (typeof PORTAL_PERMISSIONS)[number];

const PORTAL_PERMISSION_SET: ReadonlySet<string> = new Set(PORTAL_PERMISSIONS);

export function isPortalPermission(value: string): value is PortalPermission {
  return PORTAL_PERMISSION_SET.has(value);
}

export function selectPortalPermissions(values: string[]): PortalPermission[] {
  return values.filter(isPortalPermission);
}
