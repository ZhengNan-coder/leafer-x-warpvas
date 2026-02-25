import { Ellipse, Line, DragEvent } from '@leafer-ui/core'
import type { IDragEvent } from '@leafer/interface'
import type { Warpvas } from 'warpvas'
import { utils } from 'warpvas'
import perspective from 'warpvas-perspective'
import BaseMode, { BaseOptions, SUB_THEME_COLOR, THEME_COLOR } from './base.class'
import type { LeaferWarpvas } from '../core/leafer-warpvas.class'

/**
 * 变形区域的顶点类型枚举
 */
export enum VertexType {
  TOP_LEFT = 'tl',
  TOP_RIGHT = 'tr',
  BOTTOM_LEFT = 'bl',
  BOTTOM_RIGHT = 'br',
}

/** 透视模式配置 */
type PerspectiveOptions = BaseOptions<{
  /** 是否启用拖拽空白区域实现整体变形 @default true */
  enableDragResize?: boolean
  /** 空白区域拖拽的最小触发区域（像素） @default 50 */
  minimumDragThreshold?: number
}>

type ControlMeta = {
  rowIndex: number
  colIndex: number
  vertexType: VertexType
}

/**
 * 透视变形模式
 *
 * 通过拖动四个角控制点实现图像的透视变形效果。
 *
 * @example
 * ```typescript
 * import { LeaferWarpvas, Perspective } from 'leafer-x-warpvas'
 *
 * const leaferWarpvas = new LeaferWarpvas(app.tree)
 * leaferWarpvas.enterEditing(imageElement, sourceCanvas, new Perspective())
 * ```
 */
class Perspective extends BaseMode<
  { control: (obj: InstanceType<typeof Ellipse>) => InstanceType<typeof Ellipse> },
  PerspectiveOptions
> {
  public name = 'perspective'

  public options: Required<PerspectiveOptions> = {
    themeColor: THEME_COLOR,
    subThemeColor: SUB_THEME_COLOR,
    enableDragResize: true,
    minimumDragThreshold: 50,
  }

  private _controlMap = new Map<InstanceType<typeof Ellipse>, ControlMeta>()
  private _lines: InstanceType<typeof Line>[] = []

  constructor(options: Partial<PerspectiveOptions> = {}) {
    super(options)
    this.options = { ...this.options, ...options }
  }

  static execute(warpvas: Warpvas) {
    return perspective.execute(warpvas)
  }

  execute(warpvas: Warpvas) {
    return Perspective.execute(warpvas)
  }

  get controlObjects(): InstanceType<typeof Ellipse>[] {
    return Array.from(this._controlMap.keys())
  }

  /**
   * 脏渲染：创建四角控制点和边界连线
   */
  dirtyRender(leaferWarpvas: LeaferWarpvas) {
    const { app, warpvas } = leaferWarpvas
    if (!app || !warpvas) return

    const areaBounds = warpvas.regionBoundaryCurves as any[][]
    if (!areaBounds?.length) return

    this._controlMap.clear()
    this._lines = []

    // 方向 → 顶点类型 & 曲线端点索引
    const config: Record<string, { vertexType: VertexType; pointIdx: 0 | 3 }> = {
      top:    { vertexType: VertexType.TOP_LEFT,     pointIdx: 0 },
      right:  { vertexType: VertexType.TOP_RIGHT,    pointIdx: 0 },
      bottom: { vertexType: VertexType.BOTTOM_RIGHT, pointIdx: 3 },
      left:   { vertexType: VertexType.BOTTOM_LEFT,  pointIdx: 3 },
    }

    areaBounds.forEach((row, rowIndex) => {
      row.forEach((col: any, colIndex: number) => {
        Object.entries(config).forEach(([direction, { vertexType, pointIdx }]) => {
          const curve = col[direction]
          if (!curve) return

          const warpPoint = curve.points[pointIdx] as { x: number; y: number }
          const leaferPoint = leaferWarpvas.warpToLeaferPoint(warpPoint)

          const control = this._createControl()
          control.x = leaferPoint.x
          control.y = leaferPoint.y

          app.add(control as any)
          this._controlMap.set(control, { rowIndex, colIndex, vertexType })

          this._registerDrag(leaferWarpvas, control, rowIndex, colIndex, vertexType)
        })
      })
    })

    // 绘制四条边界连线
    this._drawLines(leaferWarpvas)

    return () => {
      this._controlMap.forEach((_, el) => {
        if ((el as any).parent) app.remove(el as any)
      })
      this._controlMap.clear()

      this._lines.forEach((line) => {
        if ((line as any).parent) app.remove(line as any)
      })
      this._lines = []
    }
  }

  private _registerDrag(
    leaferWarpvas: LeaferWarpvas,
    control: InstanceType<typeof Ellipse>,
    rowIndex: number,
    colIndex: number,
    vertexType: VertexType,
  ) {
    const { warpvas } = leaferWarpvas

    control.on(DragEvent.DRAG, (e: IDragEvent) => {
      if (!warpvas) return
      const { moveX, moveY } = e

      control.x = (control.x ?? 0) + moveX
      control.y = (control.y ?? 0) + moveY

      const newWarpPos = leaferWarpvas.leaferToWarpPoint({ x: control.x, y: control.y })

      try {
        warpvas.updateVertexCoord(rowIndex, colIndex, vertexType, newWarpPos)
        leaferWarpvas.requestRender(false, () => {
          this._syncControlPositions(leaferWarpvas)
          this._redrawLines()
        }, { skipHistoryRecording: true })
      } catch {
        this._handleInvalidPerspective(leaferWarpvas, control, vertexType, rowIndex, colIndex)
      }
    })

    control.on(DragEvent.END, () => {
      leaferWarpvas.record()
    })
  }

  private _handleInvalidPerspective(
    leaferWarpvas: LeaferWarpvas,
    control: InstanceType<typeof Ellipse>,
    vertexType: VertexType,
    rowIndex: number,
    colIndex: number,
  ) {
    const { warpvas } = leaferWarpvas
    if (!warpvas) return

    // 找出其余三个控制点，沿拖拽方向找最近的有效交点
    const others = this.controlObjects.filter((c) => c !== control)
    const targetX = control.x ?? 0
    const targetY = control.y ?? 0

    // 取最近的其他控制点连线上的交点作为安全位置
    let safePt: { x: number; y: number } | null = null
    for (let i = 0; i < others.length; i++) {
      const c1 = others[i]
      const c2 = others[(i + 1) % others.length]
      const pt = utils.calcIntersection(
        { x: c1.x ?? 0, y: c1.y ?? 0 },
        { x: c2.x ?? 0, y: c2.y ?? 0 },
        { x: targetX, y: targetY },
        leaferWarpvas.warpToLeaferPoint(
          warpvas.regionBoundaryCurves[rowIndex]?.[colIndex]?.[
            vertexType === VertexType.TOP_LEFT    ? 'top'    :
            vertexType === VertexType.TOP_RIGHT   ? 'right'  :
            vertexType === VertexType.BOTTOM_RIGHT? 'bottom' : 'left'
          ]?.points?.[vertexType === VertexType.BOTTOM_RIGHT || vertexType === VertexType.BOTTOM_LEFT ? 3 : 0] ??
          { x: 0, y: 0 },
        ),
      )
      if (pt) { safePt = pt; break }
    }

    if (safePt) {
      const safeRelative = utils.calcRelativeCoord(safePt, { x: targetX, y: targetY }, 1)
      try {
        warpvas.updateVertexCoord(
          rowIndex, colIndex, vertexType,
          leaferWarpvas.leaferToWarpPoint(safeRelative),
        )
        control.x = safeRelative.x
        control.y = safeRelative.y
      } catch { /* 仍失败则位置不变 */ }
    } else {
      // 无有效交点，恢复上一个有效点
      const originalWarpPt = warpvas.regionBoundaryCurves[rowIndex]?.[colIndex]?.[
        vertexType === VertexType.TOP_LEFT    ? 'top'    :
        vertexType === VertexType.TOP_RIGHT   ? 'right'  :
        vertexType === VertexType.BOTTOM_RIGHT? 'bottom' : 'left'
      ]?.points?.[vertexType === VertexType.BOTTOM_RIGHT || vertexType === VertexType.BOTTOM_LEFT ? 3 : 0]
      if (originalWarpPt) {
        const lp = leaferWarpvas.warpToLeaferPoint(originalWarpPt)
        control.x = lp.x
        control.y = lp.y
      }
    }

    leaferWarpvas.requestRender(false, undefined, { skipHistoryRecording: true })
  }

  private _syncControlPositions(leaferWarpvas: LeaferWarpvas) {
    const { warpvas } = leaferWarpvas
    if (!warpvas) return

    const dirMap: Record<VertexType, { dir: string; pointIdx: 0 | 3 }> = {
      [VertexType.TOP_LEFT]:     { dir: 'top',    pointIdx: 0 },
      [VertexType.TOP_RIGHT]:    { dir: 'right',  pointIdx: 0 },
      [VertexType.BOTTOM_RIGHT]: { dir: 'bottom', pointIdx: 3 },
      [VertexType.BOTTOM_LEFT]:  { dir: 'left',   pointIdx: 3 },
    }

    this._controlMap.forEach((meta, ctrl) => {
      const { rowIndex, colIndex, vertexType } = meta
      const { dir, pointIdx } = dirMap[vertexType]
      const curve = (warpvas.regionBoundaryCurves as any[][])[rowIndex]?.[colIndex]?.[dir]
      if (!curve) return
      const pt = curve.points[pointIdx] as { x: number; y: number }
      const lp = leaferWarpvas.warpToLeaferPoint(pt)
      ctrl.x = lp.x
      ctrl.y = lp.y
    })
  }

  private _drawLines(leaferWarpvas: LeaferWarpvas) {
    const controls = this.controlObjects
    if (controls.length < 4) return

    for (let i = 0; i < 4; i++) {
      const c1 = controls[i]
      const c2 = controls[(i + 1) % 4]
      const line = new Line({
        x1: c1.x ?? 0,
        y1: c1.y ?? 0,
        x2: c2.x ?? 0,
        y2: c2.y ?? 0,
        stroke: this.options.themeColor,
        strokeWidth: 1,
        opacity: 0.7,
        hitFill: 'none',
        editable: false,
      })
      this._lines.push(line)
      leaferWarpvas.app.add(line as any)
    }
  }

  private _redrawLines() {
    const controls = this.controlObjects
    this._lines.forEach((line: any, i) => {
      const c1 = controls[i]
      const c2 = controls[(i + 1) % 4]
      if (!c1 || !c2) return
      line.x1 = c1.x ?? 0
      line.y1 = c1.y ?? 0
      line.x2 = c2.x ?? 0
      line.y2 = c2.y ?? 0
    })
  }

  private _createControl(): InstanceType<typeof Ellipse> {
    const ctrl = new Ellipse({
      width: 14,
      height: 14,
      fill: this.options.themeColor,
      stroke: '#ffffff',
      strokeWidth: 2,
      around: 'center',
      cursor: 'pointer',
    })
    return (this._styleSetters as any).control?.(ctrl) ?? ctrl
  }
}

export default Perspective
