# Changelog

### 2.0.0

BREAKING CHANGES:

- Node.js 20 or newer is required

IMPROVEMENTS:

- No runtime dependencies anymore (`lodash` and `rr` were removed)
- Parallel lookups of the same host share one promise instead of adding event listeners per call
- Cache expiration is checked in constant time, expired entries are removed from the cache
- Removed the per-hostname retry counter that was growing with every new hostname
- Dev dependencies were bumped (mocha 12, eslint 10, chai 6, sinon 22), `istanbul` was replaced with `c8`
- npm scripts work on Windows


### 1.0.4

IMPROVEMENTS:

- Dependencies was bumped

### 1.0.3

IMPROVEMENTS:

- Dependencies was bumped [[GH-1](https://github.com/LCMApps/dns-lookup-cache/pull/1),
[GH-8](https://github.com/LCMApps/dns-lookup-cache/pull/8), [GH-9](https://github.com/LCMApps/dns-lookup-cache/pull/9)]

BUG FIXES:

- Fix "uncaughtException" error on task error for parallel requests
[[GH-7](https://github.com/LCMApps/dns-lookup-cache/pull/7)]
