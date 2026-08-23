export function scopeGrants(granted: string, required: string): boolean {
  if (granted === required) return true;
  if (!granted.endsWith(".all")) return false;
  return required.startsWith(`${granted.slice(0, -4)}.`);
}

interface ScopeMatcher {
  allows(scope: string): boolean;
}

/**
 * Compiles a granted scope list into O(1) exact matches plus a wildcard
 * prefix set, so repeated coverage checks avoid re-scanning arrays.
 */
export function createScopeMatcher(granted: Iterable<string>): ScopeMatcher {
  const exact = new Set<string>();
  const wildcards = new Set<string>();
  for (const scope of granted) {
    if (scope.endsWith(".all")) {
      wildcards.add(`${scope.slice(0, -4)}.`);
    } else {
      exact.add(scope);
    }
  }
  return {
    allows(scope: string): boolean {
      if (exact.has(scope)) return true;
      for (const prefix of wildcards) {
        if (scope.startsWith(prefix)) return true;
      }
      return false;
    },
  };
}

export function scopesCover(granted: Iterable<string>, required: Iterable<string>): boolean {
  const matcher = createScopeMatcher(granted);
  for (const needed of required) {
    if (!matcher.allows(needed)) return false;
  }
  return true;
}
