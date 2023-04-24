cli ->
createServer(server/index.ts) ->
resolveConfig(config.ts)，loadConfigFromFile(config.ts) ->
mergeConfig(utils),mergeConfigRecursively(utils) ->
resolvePlugins(plugins/index.ts) ->
resolveBuildPlugins(build.ts) ->
buildEsbuildPlugin(esbuild.ts)

plugin.config.order 的优先级比 plugin.enfore 的高
先排序 plugin.enforce,执行一遍 plugins，顺序根据 plugin.config.order,
再执行一遍 plugins，顺序根据 plugin.config.order
再执行一遍 plugins，顺序根据 plugin.options.order (sever/pluginContainer.ts)
再执行一遍 plugins，顺序根据 plugin.opti.order

```ts
export function createPluginHookUtils(
  plugins: readonly Plugin[],
): PluginHookUtils {
  const sortedPluginsCache = new Map<keyof Plugin, Plugin[]>()
  function getSortedPlugins(hookName: keyof Plugin): Plugin[] {
    if (sortedPluginsCache.has(hookName))
      return sortedPluginsCache.get(hookName)!
    const sorted = getSortedPluginsByHook(hookName, plugins)
    sortedPluginsCache.set(hookName, sorted)
    return sorted
  }
  function getSortedPluginHooks<K extends keyof Plugin>(
    hookName: K,
  ): NonNullable<HookHandler<Plugin[K]>>[] {
    const plugins = getSortedPlugins(hookName)
    return plugins
      .map((p) => {
        const hook = p[hookName]!
        return typeof hook === 'object' && 'handler' in hook
          ? hook.handler
          : hook
      })
      .filter(Boolean)
  }

  return {
    getSortedPlugins,
    getSortedPluginHooks,
  }
}
```
