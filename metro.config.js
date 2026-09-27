const { getDefaultConfig } = require("expo/metro-config");

// Default Expo/Metro config for the project.
const config = getDefaultConfig(__dirname);

// @getpaseo/* packages (peer deps of @getpaseo/client) publish exports maps
// whose "node" condition points at compiled dist/*.js, while their
// "import"/"default" conditions point at repo-relative src/*.ts files that are
// not shipped in the tarball. Bundling for RN/web must therefore evaluate the
// "node" condition — the dist output is plain runtime-agnostic JS (verified:
// relay E2EE uses tweetnacl + base64-js, no node: imports).
config.resolver.unstable_conditionNames = [
  ...(config.resolver.unstable_conditionNames ?? []),
  "node",
];

module.exports = config;
