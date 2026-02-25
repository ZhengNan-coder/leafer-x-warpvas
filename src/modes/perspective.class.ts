import { Ellipse, Line, DragEvent } from '@leafer-ui/core'
import type { IDragEvent } from '@leafer/interface'
import type { Warpvas } from 'warpvas'
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

/** 每个方向对应的曲线端点配置 */
const DIR_CONFIG: Record<string, { vertexType: VertexType; pointIdx: 0 | 3 }> = {
  top:    { vertexType: VertexType.TOP_LEFT,     pointIdx: 0 },
  right:  { vertexType: VertexType.TOP_RIGHT,    pointIdx: 0 },
  bottom: { vertexType: VertexType.BOTTOM_RIGHT, pointIdx: 3 },
  left:   { vertexType: VertexType.BOTTOM_LEFT,  pointIdx: 3 },
}

/** 顶点类型 → 代表方向（用于反向查找） */
const VERTEX_TO_DIR: Record<VertexType, string> = {
  [VertexType.TOP_LEFT]:     'top',
  [VertexType.TOP_RIGHT]:    'right',
  [VertexType.BOTTOM_RIGHT]: 'bottom',
  [VertexType.BOTTOM_LEFT]:  'left',
}

/** 透视模式配置 */
type PerspectiveOptions = BaseOptions<{
  /** 是否启用拖拽空白区域实现整体变形 @default true */
  enableDragResize?: boolean
}>

type ControlMeta = {
  rowIndex: number
  colIndex: number
  vertexType: VertexType
  /** 代表曲线与端点索引，用于从 warpvas 读回实际坐标 */
  curve: { points: Array<{ x: number; y: number }> }
  pointIdx: 0 | 3
}

/**
 * 透视变形模式
 *
 * 通过拖动四个角控制点实现图像的透视变形效果。
 * - 使用 totalX/totalY 消除控制点漂移
 * - refreshPositions() 在非脏渲染后同步四角坐标和连线
 *
 * @example
 * ```typescript
 * import { LeaferWarpvas, Perspective } from 'leafer-x-warpvas'
 *
 * const lw = new LeaferWarpvas(app.tree)
 * lw.enterEditing(imageElement, sourceCanvas, new Perspective())
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

  // ── 脏渲染：重建四角控制点 ─────────────────────────────────────────────────

  dirtyRender(lw: LeaferWarpvas) {
    const { app, warpvas } = lw
    if (!app || !warpvas) return

    const areaBounds = warpvas.regionBoundaryCurves as any[][]
    if (!areaBounds?.length) return

    this._controlMap.clear()
    this._lines = []

    areaBounds.forEach((row, rowIndex) => {
      row.forEach((col: any, colIndex: number) => {
        Object.entries(DIR_CONFIG).forEach(([direction, { vertexType, pointIdx }]) => {
          const curve = col[direction]
          if (!curve) return

          const warpPt = curve.points[pointIdx] as { x: number; y: number }
          const lp = lw.warpToLeaferPoint(warpPt)

          const ctrl = this._createControl()
          ctrl.x = lp.x
          ctrl.y = lp.y

          app.add(ctrl as any)
          this._controlMap.set(ctrl, { rowIndex, colIndex, vertexType, curve, pointIdx })

          this._registerDrag(lw, ctrl, rowIndex, colIndex, vertexType, curve, pointIdx)
        })
      })
    })

    // 四条边界连线（连接相邻控制点）
    this._buildLines(lw)

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

  // ── 非脏渲染：只更新位置 ───────────────────────────────────────────────────

  /**
   * 从 warpvas curve.points 重新读取四角坐标，更新控制点 x/y 和连线端点（无 add/remove）
   */
  refreshPositions(lw: LeaferWarpvas) {
    super.refreshPositions(lw)
    this._syncControlPositions(lw)
    this._redrawLines()
  }

  // ── 拖拽注册 ──────────────────────────────────────────────────────────────

  private _registerDrag(
    lw: LeaferWarpvas,
    ctrl: InstanceType<typeof Ellipse>,
    rowIndex: number,
    colIndex: number,
    vertexType: VertexType,
    curve: { points: Array<{ x: number; y: number }> },
    pointIdx: 0 | 3,
  ) {
    let startWarpX = 0
    let startWarpY = 0

    ctrl.on(DragEvent.START, () => {
      // 从 warpvas curve.points 读取起始坐标（权威来源）
      startWarpX = curve.points[pointIdx].x
      startWarpY = curve.points[pointIdx].y
    })

    ctrl.on(DragEvent.DRAG, (e: IDragEvent) => {
      if (!lw.warpvas) return

      // 用 totalX/totalY 计算目标 warpvas 坐标（无累积误差）
      const newWarpPos = {
        x: startWarpX + (e.totalX ?? 0) / lw.scaleX,
        y: startWarpY + (e.totalY ?? 0) / lw.scaleY,
      }

      try {
        lw.warpvas.updateVertexCoord(rowIndex, colIndex, vertexType, newWarpPos)

        // 从 warpvas 读回实际坐标（消除漂移）
        const actualWarp = curve.points[pointIdx]
        const actualLp = lw.warpToLeaferPoint(actualWarp)
        ctrl.x = actualLp.x
        ctrl.y = actualLp.y

        lw.requestRender(false, undefined, { skipHistoryRecording: true })
      } catch {
        // 透视无效（四点共线等）：将控制点限制在最近的有效位置
        // 直接从 warpvas 读回上次有效坐标，不做复杂的交点计算
        const lastValidWarp = curve.points[pointIdx]
        const lastValidLp = lw.warpToLeaferPoint(lastValidWarp)
        ctrl.x = lastValidLp.x
        ctrl.y = lastValidLp.y
      }
    })

    ctrl.on(DragEvent.END, () => {
      lw.record()
    })
  }

  // ── 内部辅助 ──────────────────────────────────────────────────────────────

  /**
   * 从 warpvas 读取四角实际坐标并更新控制点位置
   */
  private _syncControlPositions(lw: LeaferWarpvas) {
    if (!lw.warpvas) return

    this._controlMap.forEach((meta, ctrl) => {
      const { curve, pointIdx } = meta
      const pt = curve.points[pointIdx] as { x: number; y: number }
      const lp = lw.warpToLeaferPoint(pt)
      ctrl.x = lp.x
      ctrl.y = lp.y
    })
  }

  /**
   * 构建四条边界连线（按 controlMap 中的顺序依次连接）
   */
  private _buildLines(lw: LeaferWarpvas) {
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
      lw.app.add(line as any)
    }
  }

  /**
   * 根据当前控制点位置重新绘制连线端点（不 remove/add，直接修改属性）
   */
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
