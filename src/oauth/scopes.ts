export function scopeGrants(granted: string, required: string): boolean {
  if (granted === required) return true;
  if (!granted.endsWith(".all")) return false;
  return required.startsWith(`${granted.slice(0, -4)}.`);
}

export function scopesCover(granted: Iterable<string>, required: Iterable<string>): boolean {
  const grantedSet = new Set(granted);
  const prefixes = new Set<string>();
  for (const scope of grantedSet) {
    if (scope.endsWith(".all")) prefixes.add(scope.slice(0, -4));
  }
  for (const needed of required) {
    if (grantedSet.has(needed)) continue;
    let covered = false;
    for (const prefix of prefixes) {
      if (needed.startsWith(`${prefix}.`)) {
        covered = true;
        break;
      }
    }
    if (!covered) return false;
  }
  return true;
}
