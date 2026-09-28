import { mockChildCases } from './mockChild.cases';

// happy-dom (the default environment). mockChild.jsdom.test.tsx runs the same cases
// in jsdom, the other environment users test in.
mockChildCases();
