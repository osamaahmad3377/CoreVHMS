/** @type {import('jest').Config} */
const tsJest = ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }];
module.exports = {
  // Integration tests run multi-step workflows against a real database; the 5 s default is too tight on a busy CI runner.
  testTimeout: 20_000,
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/*.spec.ts'],
      transform: { '^.+\\.ts$': tsJest },
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      roots: ['<rootDir>/test'],
      testMatch: ['**/*.int-spec.ts'],
      transform: { '^.+\\.ts$': tsJest },
      globalSetup: '<rootDir>/test/global-setup.ts',
      setupFiles: ['<rootDir>/test/env.ts'],
    },
  ],
};
