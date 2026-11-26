/// <reference lib="webworker" />

import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

const navigationRoute = new NavigationRoute(
  createHandlerBoundToURL("index.html"),
  {
    denylist: [
      /^\/api(?:\/|$)/,
      /^\/socket\.io(?:\/|$)/,
      /\/[^/?]+\.[^/?]+(?:\?|$)/,
    ],
  },
);
registerRoute(navigationRoute);

self.addEventListener("fetch", () => {});
