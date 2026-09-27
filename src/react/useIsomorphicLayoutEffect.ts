import { useEffect, useLayoutEffect } from 'react';

// useLayoutEffect warns during server rendering; nothing needs to run there anyway.
export const useIsomorphicLayoutEffect: typeof useLayoutEffect =
  typeof document === 'undefined' ? useEffect : useLayoutEffect;
