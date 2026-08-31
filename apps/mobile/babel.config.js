// `@Inject` is a 2023-11 **standard** decorator, not the legacy TypeScript
// form. Getting this wrong produces confusing runtime errors rather than a
// compile failure, so it is called out in docs/04 §17.
module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    plugins: [['@babel/plugin-proposal-decorators', { version: '2023-11' }]],
  }
}
