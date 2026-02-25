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
 * @template T 扩展的样式设置方法
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
 * - 基础渲染逻辑（显示变形贴图 + 网格边界线）
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

  /** 当前渲染的网格路径元素列表 */
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
   *
   * @example
   * ```typescript
   * mode.registerStyleSetter('image', (image) => {
   *   image.opacity = 0.8
   * })
   * ```
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
   * 渲染变形贴图 + 网格边界线到 Leafer 画布
   */
  render(leaferWarpvas: LeaferWarpvas) {
    const { app, warpvas, warpvasImage } = leaferWarpvas
    if (!app || !warpvas || !warpvasImage) return

    // 配置变形图像样式并添加到画布
    this._styleSetters.image?.(warpvasImage)
    app.add(warpvasImage as any)

    // 渲染网格边界路径
    const paths = this._buildBoundaryPaths(leaferWarpvas)
    paths.forEach((p) => app.add(p as any))
    this._pathElements = paths

    return () => {
      // 移除变形图像
      if ((warpvasImage as any)?.parent) app.remove(warpvasImage as any)
      // 移除网格路径
      this._pathElements.forEach((p) => {
        if ((p as any).parent) app.remove(p as any)
      })
      this._pathElements = []
    }
  }

  /**
   * 构建外边界网格路径（SVG 贝塞尔曲线）
   */
  protected _buildBoundaryPaths(leaferWarpvas: LeaferWarpvas): InstanceType<typeof LeaferPath>[] {
    const { warpvas } = leaferWarpvas
    if (!warpvas) return []

    const results: InstanceType<typeof LeaferPath>[] = []
    const seen = new WeakSet()

    warpvas.regionCurves.forEach((row: any[]) => {
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

          const svgPath = this._curveToLeaferPath(curve, leaferWarpvas)
          if (!svgPath) return
          const pathEl = new LeaferPath({
            path: svgPath,
            stroke: this.options.themeColor,
            strokeWidth: 1,
            fill: 'none',
            hitFill: 'none',
            editable: false,
          })
          this._styleSetters.path?.(pathEl)
          results.push(pathEl)
        })
      })
    })

    return results
  }

  /**
   * 将 warpvas Bezier 曲线转换为 Leafer 页面坐标系下的 SVG 路径字符串
   */
  protected _curveToLeaferPath(
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
