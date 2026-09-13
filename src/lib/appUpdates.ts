/** Explicit update only: never interrupt an active computation or discard drafts. */
const guards = new Set<() => Promise<boolean>>();
export function addUpdateGuard(guard: () => Promise<boolean>) {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}
export async function prepareAppUpdate() {
  for (const guard of guards) if (!(await guard())) return false;
  return true;
}
export function updateURL(href: string, version: string) {
  const url = new URL(href);
  url.searchParams.set("appVersion", version);
  return url.toString();
}
