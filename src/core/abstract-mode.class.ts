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
 *   // 首次进入编辑时调用一次，负责添加 boundary paths 等持久元素
 *   render(lw: LeaferWarpvas) {
 *     // 添加持久元素 ...
 *     return () => {
 *       // 清理持久元素（在 leaveEditing 时执行）
 *     }
 *   }
 *
 *   // dirty=true 时调用，负责创建/重建控制点
 *   dirtyRender(lw: LeaferWarpvas) {
 *     // 创建控制点 ...
 *     return () => {
 *       // 清理控制点（在下次 dirty render 或 leaveEditing 时执行）
 *     }
 *   }
 *
 *   // dirty=false 时调用，只更新已有控制点的位置（无 add/remove）
 *   refreshPositions(lw: LeaferWarpvas) {
 *     // 从 warpvas 读取最新坐标并更新控制点 x/y
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
   * 首次进入编辑时调用一次（在 warpvasImage 加入画布后紧接着调用）。
   * 负责添加 boundary paths 等需要在整个编辑期间保持可见的持久元素。
   * 返回的清理函数在 `leaveEditing()` 时执行。
   *
   * 注意：warpvasImage 的生命周期由 LeaferWarpvas 自身管理，
   * 此方法无需（也不应）调用 `app.add(warpvasImage)`。
   */
  render(_leaferWarpvas: LeaferWarpvas): (() => void) | void {
    return undefined
  }

  /**
   * 在 `render(dirty=true)` 时调用，负责创建/重建控制点等结构性交互元素。
   * 返回的清理函数在下次 dirty render 或 `leaveEditing()` 时执行。
   */
  dirtyRender(_leaferWarpvas: LeaferWarpvas): (() => void) | void {
    return undefined
  }

  /**
   * 在 `render(dirty=false)` 时调用，仅同步控制点位置（不 add/remove 任何元素）。
   * 这是保证拖拽丝滑的关键——频繁渲染时只移动已有元素，不产生闪烁。
   */
  refreshPositions(_leaferWarpvas: LeaferWarpvas): void {
    // 空实现，子类按需 override
  }
}
