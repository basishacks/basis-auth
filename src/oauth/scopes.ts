export function scopeGrants(granted: string, required: string): boolean {
  if (granted === required) return true;
  if (!granted.endsWith(".all")) return false;
  return required.startsWith(`${granted.slice(0, -4)}.`);
}

export function scopesCover(granted: Iterable<string>, required: Iterable<string>): boolean {
  const available = [...granted];
  return [...required].every((needed) => available.some((scope) => scopeGrants(scope, needed)));
}
