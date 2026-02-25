import type { LeaferWarpvas } from './leafer-warpvas.class'
import { Warpvas } from 'warpvas'

/**
 * 变形模式的抽象基类
 *
 * 继承此基类以实现自定义 Leafer 变形模式。
 *
 * @example
 * ```typescript
 * class CustomMode extends AbstractMode {
 *   name = 'custom-mode'
 *
 *   render(leaferWarpvas: LeaferWarpvas) {
 *     const cleanup = super.render(leaferWarpvas)
 *     // 添加自定义交互元素 ...
 *     return () => {
 *       cleanup?.()
 *       // 清理自定义元素 ...
 *     }
 *   }
 * }
 * ```
 */
export abstract class AbstractMode {
  /** 变形模式的唯一标识名称 */
  abstract name: string

  /**
   * 计算变形区域分割点位置的策略方法（默认使用 warpvas 扭曲策略）
   */
  execute(warpvas: Warpvas) {
    return Warpvas.strategy(warpvas)
  }

  /**
   * 在 `leaferWarpvas.render()` 执行后触发
   * @returns 清理函数，在下次 render 之前执行
   */
  render(leaferWarpvas: LeaferWarpvas): (() => void) | void {
    const { app, warpvasImage } = leaferWarpvas
    if (!app || !warpvasImage) return

    app.add(warpvasImage as any)

    return () => {
      if ((warpvasImage as any).parent) app.remove(warpvasImage as any)
    }
  }

  /**
   * 在 `leaferWarpvas.render(dirty=true)` 时触发（网格结构变化时）
   * @returns 清理函数，在下次 dirtyRender 之前执行
   */
  dirtyRender(_leaferWarpvas: LeaferWarpvas): (() => void) | void {
    return undefined
  }
}
