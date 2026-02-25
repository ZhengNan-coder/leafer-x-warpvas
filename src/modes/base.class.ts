import { Image as LeaferImage, Path as LeaferPath } from '@leafer-ui/core'
import type { IUI } from '@leafer-ui/interface'
import type { Warpvas } from 'warpvas'
import { AbstractMode } from '../core/abstract-mode.class'
import type { LeaferWarpvas } from '../core/leafer-warpvas.class'

/** 默认主题色（半透明深灰） */
export const THEME_COLOR = '#33333399'
/** 默认副主题色（深灰） */
export const SUB_THEME_COLOR = '#333333ff'

type StyleFn<T> = (obj: T) => void

/**
 * 样式设置器类型
 */
export type BaseStyleSetters<T = Record<string, StyleFn<IUI>>> = T & {
  /** 配置变形后贴图的样式 */
  image?: StyleFn<InstanceType<typeof LeaferImage>>
  /** 配置网格边界线的样式 */
  path?: StyleFn<InstanceType<typeof LeaferPath>>
}

/** 模式配置选项 */
export type BaseOptions<T = Record<string, unknown>> = T & {
  /** 主题色 @default THEME_COLOR */
  themeColor?: string
  /** 副主题色 @default SUB_THEME_COLOR */
  subThemeColor?: string
}

/**
 * 变形模式基础实现类
 *
 * 提供：
 * - 默认的变形分割策略
 * - 主题色管理
 * - 基础渲染逻辑（网格边界线），warpvasImage 由 LeaferWarpvas 自身管理
 */
class BaseMode<
  Objects = Record<string, StyleFn<IUI>>,
  Options = Record<string, unknown>,
> extends AbstractMode {

  public name = '__base__'

  public options = {
    themeColor: THEME_COLOR,
    subThemeColor: SUB_THEME_COLOR,
  } as Required<BaseOptions<Options>>

  protected _styleSetters: BaseStyleSetters<Partial<Objects>> = {}

  /** 当前渲染的网格路径元素列表（持久，不每帧 remove/add） */
  protected _pathElements: InstanceType<typeof LeaferPath>[] = []

  constructor(options: Partial<BaseOptions<Options>> = {}) {
    super()
    this.options = {
      ...this.options,
      ...options,
    }
  }

  /**
   * 注册样式设置器，自定义变形模式中各元素的外观
   */
  registerStyleSetter<K extends keyof BaseStyleSetters<Objects>>(
    label: K,
    setter: BaseStyleSetters<Objects>[K],
  ) {
    this._styleSetters = {
      ...this._styleSetters,
      [label]: setter,
    } as BaseStyleSetters<Partial<Objects>>
  }

  execute(warpvas: Warpvas) {
    return super.execute(warpvas)
  }

  /**
   * 首次进入编辑时调用一次：构建并添加网格边界路径。
   * 注意：warpvasImage 由 LeaferWarpvas 管理，这里不需要处理。
   */
  render(leaferWarpvas: LeaferWarpvas) {
    const { app, warpvas } = leaferWarpvas
    if (!app || !warpvas) return

    // 构建边界路径并添加到画布
    const paths = this._buildBoundaryPaths(leaferWarpvas)
    paths.forEach((p) => app.add(p as any))
    this._pathElements = paths

    return () => {
      // leaveEditing 时移除所有路径
      this._pathElements.forEach((p) => {
        if ((p as any).parent) app.remove(p as any)
      })
      this._pathElements = []
    }
  }

  /**
   * 非脏渲染时调用：原地更新路径 SVG 字符串，不 remove/re-add（无闪烁）
   */
  refreshPositions(leaferWarpvas: LeaferWarpvas) {
    if (!leaferWarpvas.warpvas || this._pathElements.length === 0) return

    // 重新计算各条曲线的 SVG 路径字符串，直接更新已有元素的 path 属性
    const newSVGs = this._buildBoundarySVGs(leaferWarpvas)

    newSVGs.forEach((svg, i) => {
      const el = this._pathElements[i]
      if (el) {
        ;(el as any).path = svg
      }
    })
  }

  // ── 内部构建方法 ──────────────────────────────────────────────────────────────

  /**
   * 构建边界路径 Path 元素列表
   */
  protected _buildBoundaryPaths(leaferWarpvas: LeaferWarpvas): InstanceType<typeof LeaferPath>[] {
    const { warpvas } = leaferWarpvas
    if (!warpvas) return []

    const svgs = this._buildBoundarySVGs(leaferWarpvas)
    return svgs.map((svg) => {
      const pathEl = new LeaferPath({
        path: svg,
        stroke: this.options.themeColor,
        strokeWidth: 1,
        fill: 'none',
        hitFill: 'none',
        editable: false,
      })
      this._styleSetters.path?.(pathEl)
      return pathEl
    })
  }

  /**
   * 计算所有边界曲线的 SVG 字符串（供 _buildBoundaryPaths 和 refreshPositions 共用）
   */
  protected _buildBoundarySVGs(leaferWarpvas: LeaferWarpvas): string[] {
    const { warpvas } = leaferWarpvas
    if (!warpvas) return []

    const results: string[] = []
    const seen = new WeakSet()

    ;(warpvas.regionCurves as any[][]).forEach((row: any[]) => {
      row.forEach((col: any) => {
        const { horizontal, vertical } = col

        // 只保留边界曲线（第一条和最后一条）
        const renderCurves: any[] = [
          horizontal[0],
          horizontal[horizontal.length - 1],
          vertical[0],
          vertical[vertical.length - 1],
        ].filter(Boolean)

        renderCurves.forEach((curve: any) => {
          if (seen.has(curve)) return
          seen.add(curve)
          const svg = this._curveToSVG(curve, leaferWarpvas)
          if (svg) results.push(svg)
        })
      })
    })

    return results
  }

  /**
   * 将 warpvas Bezier 曲线转换为 Leafer 页面坐标系下的 SVG 路径字符串
   */
  protected _curveToSVG(
    curve: { points: Array<{ x: number; y: number }> },
    leaferWarpvas: LeaferWarpvas,
  ): string {
    const pts = curve.points.map((p) => leaferWarpvas.warpToLeaferPoint(p))
    if (pts.length === 4) {
      return `M ${pts[0].x} ${pts[0].y} C ${pts[1].x} ${pts[1].y} ${pts[2].x} ${pts[2].y} ${pts[3].x} ${pts[3].y}`
    }
    if (pts.length === 2) {
      return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`
    }
    return ''
  }
}

export default BaseMode
