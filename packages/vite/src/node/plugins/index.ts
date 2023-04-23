import aliasPlugin from '@rollup/plugin-alias'
import type { PluginHookUtils, ResolvedConfig } from '../config'
import { isDepsOptimizerEnabled } from '../config'
import type { HookHandler, Plugin } from '../plugin'
import { getDepsOptimizer } from '../optimizer'
import { shouldExternalizeForSSR } from '../ssr/ssrExternal'
import { watchPackageDataPlugin } from '../packages'
import { jsonPlugin } from './json'
import { resolvePlugin } from './resolve'
import { optimizedDepsBuildPlugin, optimizedDepsPlugin } from './optimizedDeps'
import { esbuildPlugin } from './esbuild'
import { importAnalysisPlugin } from './importAnalysis'
import { cssPlugin, cssPostPlugin } from './css'
import { assetPlugin } from './asset'
import { clientInjectionsPlugin } from './clientInjections'
import { buildHtmlPlugin, htmlInlineProxyPlugin } from './html'
import { wasmFallbackPlugin, wasmHelperPlugin } from './wasm'
import { modulePreloadPolyfillPlugin } from './modulePreloadPolyfill'
import { webWorkerPlugin } from './worker'
import { preAliasPlugin } from './preAlias'
import { definePlugin } from './define'
import { workerImportMetaUrlPlugin } from './workerImportMetaUrl'
import { assetImportMetaUrlPlugin } from './assetImportMetaUrl'
import { ensureWatchPlugin } from './ensureWatch'
import { metadataPlugin } from './metadata'
import { dynamicImportVarsPlugin } from './dynamicImportVars'
import { importGlobPlugin } from './importMetaGlob'

export async function resolvePlugins(
  config: ResolvedConfig, // 用户配置在 inlineConfig 属性中
  prePlugins: Plugin[],
  normalPlugins: Plugin[],
  postPlugins: Plugin[],
): Promise<Plugin[]> {
  const isBuild = config.command === 'build'
  const isWatch = isBuild && !!config.build.watch
  const buildPlugins = isBuild
    ? await (await import('../build')).resolveBuildPlugins(config)
    : { pre: [], post: [] }
  const { modulePreload } = config.build

  return [
    isWatch ? ensureWatchPlugin() : null,
    isBuild ? metadataPlugin() : null,
    watchPackageDataPlugin(config.packageCache),
    preAliasPlugin(config),
    aliasPlugin({ entries: config.resolve.alias }),
    ...prePlugins,
    modulePreload === true ||
    (typeof modulePreload === 'object' && modulePreload.polyfill)
      ? modulePreloadPolyfillPlugin(config)
      : null,
    ...(isDepsOptimizerEnabled(config, false) ||
    isDepsOptimizerEnabled(config, true)
      ? [
          isBuild
            ? optimizedDepsBuildPlugin(config)
            : optimizedDepsPlugin(config),
        ]
      : []),
    resolvePlugin({
      ...config.resolve,
      root: config.root,
      isProduction: config.isProduction,
      isBuild,
      packageCache: config.packageCache,
      ssrConfig: config.ssr,
      asSrc: true,
      getDepsOptimizer: (ssr: boolean) => getDepsOptimizer(config, ssr),
      shouldExternalize:
        isBuild && config.build.ssr && config.ssr?.format !== 'cjs'
          ? (id) => shouldExternalizeForSSR(id, config)
          : undefined,
    }),
    htmlInlineProxyPlugin(config),
    cssPlugin(config),
    config.esbuild !== false ? esbuildPlugin(config) : null,
    jsonPlugin(
      {
        namedExports: true,
        ...config.json,
      },
      isBuild,
    ),
    wasmHelperPlugin(config),
    webWorkerPlugin(config),
    assetPlugin(config),
    ...normalPlugins,
    wasmFallbackPlugin(),
    definePlugin(config),
    cssPostPlugin(config),
    isBuild && buildHtmlPlugin(config),
    workerImportMetaUrlPlugin(config),
    assetImportMetaUrlPlugin(config),
    ...buildPlugins.pre,
    dynamicImportVarsPlugin(config),
    importGlobPlugin(config),
    ...postPlugins,
    ...buildPlugins.post,
    // internal server-only plugins are always applied after everything else
    ...(isBuild
      ? []
      : [clientInjectionsPlugin(config), importAnalysisPlugin(config)]),
  ].filter(Boolean) as Plugin[]
}

export function createPluginHookUtils(
  plugins: readonly Plugin[],
): PluginHookUtils {
  // sort plugins per hook
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

// 对 [...prePlugins, ...normalPlugins, ...postPlugins] 二次排序
export function getSortedPluginsByHook(
  hookName: keyof Plugin, // 字符串 'config'
  plugins: readonly Plugin[],
): Plugin[] {
  const pre: Plugin[] = []
  const normal: Plugin[] = []
  const post: Plugin[] = []
  for (const plugin of plugins) {
    // 这里需要获取vite插件的名称
    const hook = plugin[hookName]
    if (hook) {
      /**
       * {
       *  name:'vite:module',
       *  config:{
       *    order:'pre',
       *    handler(){
       *
       *    }
       *  },
       *  resoveId(){
       *
       *  },
       *  load(){
       *
       *  },
       *  transoform(){
       *
       *  },
       *  ...
       * }
       */
      if (typeof hook === 'object') {
        // 二次排序
        if (hook.order === 'pre') {
          pre.push(plugin)
          continue
        }
        if (hook.order === 'post') {
          post.push(plugin)
          continue
        }
      }
      normal.push(plugin)
    }
  }
  // 一般用户的插件config没有配置成对象形式，且设置order的话就是，传回去的顺序和传进来的顺序是一致的
  return [...pre, ...normal, ...post]
}
