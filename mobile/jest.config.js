// Tempo — Jest config for the deterministic-core unit suite (§4.2/§11.2).
//
// Scope on purpose: the pure logic in src/lib (periodization, progression, the
// exercise classifier, streak, goal projection, plan-rollover) — no React Native,
// no Supabase, no async I/O. That's the cheapest code to test and the code whose
// regressions silently miscalculate for every user at once (the "4-week plan
// cliff" shipped once already). Uses ts-jest so there's no Babel/Metro config to
// add to the app; transpile-only (isolatedModules) since `npx tsc` already
// type-checks the project separately.

/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Resolve the app's "@/…" path alias the same way tsconfig does.
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    // A dedicated, Node-oriented tsconfig (CommonJS + rootDir) so tests run under
    // plain Node independent of the app's bundler-targeted tsconfig.
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
}
