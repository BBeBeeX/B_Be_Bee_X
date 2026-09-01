// `@Inject` is a 2023-11 **standard** decorator, not the legacy TypeScript
// form. Getting this wrong produces confusing runtime errors rather than a
// compile failure, so it is called out in docs/04 §17.
//
// Configured *through* the preset rather than as a plugin of our own.
// `babel-preset-expo` always adds `@babel/plugin-proposal-decorators` itself,
// defaulting to `{ legacy: true }`; a second entry alongside it puts both
// `decorators` and `decorators-legacy` into the parser, which Babel refuses
// outright. The preset forwards this option to that same plugin.
module.exports = function (api) {
  api.cache(true)
  return {
    presets: [['babel-preset-expo', { decorators: { version: '2023-11' } }]],
  }
}
