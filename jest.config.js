/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  // The e2e smoke test talks to a live deployment; it is run explicitly via `npm run e2e`,
  // never as part of the unit-test suite or CI.
  testPathIgnorePatterns: ['/node_modules/', '/test/e2e/'],
  collectCoverageFrom: ['src/**/*.ts'],
  clearMocks: true,
};
