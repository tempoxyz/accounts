/** Whether IntersectionObserver v2 (with `isVisible`) is supported. */
export const supported = () =>
  'IntersectionObserver' in window &&
  'IntersectionObserverEntry' in window &&
  'intersectionRatio' in IntersectionObserverEntry.prototype &&
  'isVisible' in IntersectionObserverEntry.prototype
//# sourceMappingURL=IntersectionObserver.js.map
