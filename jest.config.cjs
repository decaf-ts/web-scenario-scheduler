const config = {
  verbose: true,
  // eslint-disable-next-line no-undef
  rootDir: __dirname,
  transform: { "^.+\\.ts$": "ts-jest" },
  testEnvironment: "node",
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  testRegex: "/tests/.*\\.(test|spec)\\.(ts|tsx)$",
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverage: false,
  // Rewriting serialized page.evaluate callbacks breaks them inside Chromium.
  coverageProvider: "v8",
  coverageDirectory: "./workdocs/reports/coverage",
  collectCoverageFrom: [
    "src/**/*.{js,jsx,ts,tsx}",
    "!src/bin/**",
    "!src/**/*.stories.{js,jsx,ts,tsx}",
  ],
  reporters: ["default"],
  watchman: false,
};

// eslint-disable-next-line no-undef
module.exports = config;
