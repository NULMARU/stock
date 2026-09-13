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

export function navigateAppUpdate(
  navigation: Pick<Location, "href" | "reload" | "replace">,
  version: string,
) {
  const target = updateURL(navigation.href, version);
  // Replacing an identical URL with a hash may be treated as an in-page navigation.
  if (target === navigation.href) navigation.reload();
  else navigation.replace(target);
}
