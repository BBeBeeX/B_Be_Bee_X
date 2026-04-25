# @b_be_bee/network

All application and plugin HTTP requests should go through this package.

Plugin code must use `createPluginNetworkClient(pluginId, config)`. Plugin code must not call native HTTP APIs directly, including `fetch`, `XMLHttpRequest`, Node `http`, Node `https`, or unapproved HTTP clients such as `axios`, `got`, `ky`, and `superagent`.

Proxy settings are persisted through `@b_be_bee/database` and hydrated by the network package before proxy policy is resolved. Persisted proxy settings intentionally exclude credential fields; proxy credentials must not be stored in plaintext.

Use `findPluginHttpViolations` or `assertNoPluginHttpViolations` in plugin validation to reject direct HTTP usage before plugin code is accepted or executed.
