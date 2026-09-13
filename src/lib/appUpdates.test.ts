import { it, expect } from "vitest";
import { addUpdateGuard, prepareAppUpdate, updateURL, navigateAppUpdate } from "./appUpdates";
it("preserves hash route and existing query when bypassing an old HTML response", () => {
  const url = new URL(
    updateURL(
      "https://nulmaru.github.io/stock/?x=1#/lab?scenario=abc",
      "release-2",
    ),
  );
  expect(url.pathname).toBe("/stock/");
  expect(url.searchParams.get("x")).toBe("1");
  expect(url.searchParams.get("appVersion")).toBe("release-2");
  expect(url.hash).toBe("#/lab?scenario=abc");
});
it("never permits refresh while computation or saving guard refuses", async () => {
  const remove = addUpdateGuard(async () => false);
  try {
    expect(await prepareAppUpdate()).toBe(false);
  } finally {
    remove();
  }
  expect(await prepareAppUpdate()).toBe(true);
});
it("waits for saving before refresh", async () => {
  let saved = false;
  const remove = addUpdateGuard(async () => {
    await Promise.resolve();
    saved = true;
    return true;
  });
  try {
    expect(await prepareAppUpdate()).toBe(true);
    expect(saved).toBe(true);
  } finally {
    remove();
  }
});

it("reloads instead of navigating to an identical hash URL", () => {
  let reloaded = false,
    replaced = false;
  const navigation = {
    href: "https://nulmaru.github.io/stock/?appVersion=v2#/lab",
    reload: () => {
      reloaded = true;
    },
    replace: () => {
      replaced = true;
    },
  };
  navigateAppUpdate(navigation, "v2");
  expect(reloaded).toBe(true);
  expect(replaced).toBe(false);
});
