import { Ellipse, Line, DragEvent, PointerEvent } from '@leafer-ui/core'
import type { IDragEvent } from '@leafer/interface'
import type { Warpvas } from 'warpvas'
import BaseMode, { BaseOptions, SUB_THEME_COLOR, THEME_COLOR } from './base.class'
import type { LeaferWarpvas } from '../core/leafer-warpvas.class'

/** 顶点类型枚举 */
export enum VertexType {
  TOP_LEFT = 'tl',
  TOP_RIGHT = 'tr',
  BOTTOM_LEFT = 'bl',
  BOTTOM_RIGHT = 'br',
}

type Coord = { x: number; y: number }

/** 扭曲变形模式配置 */
type WarpOptions = BaseOptions<{
  /** 是否启用网格分割 @default true */
  enableGridSplit?: boolean
}>

type HandleData = {
  ellipse: InstanceType<typeof Ellipse>
  line: InstanceType<typeof Line>
  curve: { points: Coord[] }
  pointIdx: 1 | 2
}

type ControlData = {
  major: InstanceType<typeof Ellipse>
  vertexType: VertexType
  rowIndex: number
  colIndex: number
  handles: HandleData[]
}

/**
 * 扭曲（Warp）变形模式
 *
 * 提供网格化扭曲变形功能：
 * - 拖动四角顶点控制点修改整体形状
 * - 点击顶点控制点后出现贝塞尔句柄，拖动句柄调整曲线弧度
 *
 * @example
 * ```typescript
 * import { LeaferWarpvas, Warp } from 'leafer-x-warpvas'
 *
 * const leaferWarpvas = new LeaferWarpvas(app.tree)
 * leaferWarpvas.enterEditing(imageElement, sourceCanvas, new Warp())
 * ```
 */
class Warp extends BaseMode<
  {
    control: (obj: InstanceType<typeof Ellipse>) => InstanceType<typeof Ellipse>
    curveControl: (obj: InstanceType<typeof Ellipse>) => InstanceType<typeof Ellipse>
  },
  WarpOptions
> {
  public name = 'warp'

  public options: Required<WarpOptions> = {
    themeColor: THEME_COLOR,
    subThemeColor: SUB_THEME_COLOR,
    enableGridSplit: true,
  }

  private _positionControlMap = new Map<string, ControlData>()
  private _activeControl: InstanceType<typeof Ellipse> | null = null

  constructor(options: Partial<WarpOptions> = {}) {
    super(options)
    this.options = { ...this.options, ...options }
  }

  /**
   * 根据 warpvas 区域曲线计算分割点
   */
  static execute(warpvas: Warpvas): Coord[][][] {
    const splitPoints: Coord[][][] = []
    const areaBounds = warpvas.regionBoundaryCurves as any[][]

    areaBounds.forEach((row, rowIndex) => {
      const _row: Coord[][] = []
      row.forEach((_col: any, colIndex: number) => {
        const _pts: Coord[] = []
        const { horizontal, vertical } = (warpvas.regionCurves as any[][])[rowIndex][colIndex]
        for (let h = 0; h < horizontal.length; h++) {
          for (let v = 0; v < vertical.length; v++) {
            const p1 = vertical[v].get(h / (horizontal.length - 1))
            const p2 = horizontal[h].get(v / (vertical.length - 1))
            _pts.push({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 })
          }
        }
        _row.push(_pts)
      })
      splitPoints.push(_row)
    })

    return splitPoints
  }

  execute(warpvas: Warpvas) {
    return Warp.execute(warpvas)
  }

  get controlObjects(): InstanceType<typeof Ellipse>[] {
    return Array.from(this._positionControlMap.values()).map((d) => d.major)
  }

  get handleObjects(): InstanceType<typeof Ellipse>[] {
    return Array.from(this._positionControlMap.values()).flatMap((d) =>
      d.handles.map((h) => h.ellipse),
    )
  }

  dirtyRender(leaferWarpvas: LeaferWarpvas) {
    const { app, warpvas } = leaferWarpvas
    if (!app || !warpvas) return

    const areaBounds = warpvas.regionBoundaryCurves as any[][]
    if (!areaBounds?.length) return

    this._positionControlMap.clear()
    this._activeControl = null

    // ── 方向 → 端点顶点类型映射 ────────────────────────────────────────
    // top:    P0 = TOP_LEFT,    P3 = TOP_RIGHT
    // right:  P0 = TOP_RIGHT,   P3 = BOTTOM_RIGHT
    // bottom: P0 = BOTTOM_LEFT, P3 = BOTTOM_RIGHT
    // left:   P0 = TOP_LEFT,    P3 = BOTTOM_LEFT
    // ─────────────────────────────────────────────────────────────────
    const directionVertexMap: Record<string, [VertexType, VertexType]> = {
      top:    [VertexType.TOP_LEFT,    VertexType.TOP_RIGHT],
      right:  [VertexType.TOP_RIGHT,   VertexType.BOTTOM_RIGHT],
      bottom: [VertexType.BOTTOM_LEFT, VertexType.BOTTOM_RIGHT],
      left:   [VertexType.TOP_LEFT,    VertexType.BOTTOM_LEFT],
    }

    areaBounds.forEach((row, rowIndex) => {
      row.forEach((col: any, colIndex: number) => {
        Object.entries(directionVertexMap).forEach(([direction, [vtP0, vtP3]]) => {
          const curve = col[direction]
          if (!curve) return
          const pts = curve.points as Coord[]

          // P0 端点（句柄索引 1）
          this._ensureVertex(leaferWarpvas, rowIndex, colIndex, vtP0, pts[0], curve, 1)
          // P3 端点（句柄索引 2）
          this._ensureVertex(leaferWarpvas, rowIndex, colIndex, vtP3, pts[3], curve, 2)
        })
      })
    })

    const handleAppPointerDown = () => {
      this._deactivateControl()
    }
    app.on(PointerEvent.DOWN, handleAppPointerDown)

    return () => {
      app.off(PointerEvent.DOWN, handleAppPointerDown)

      this._positionControlMap.forEach((data) => {
        if ((data.major as any).parent) app.remove(data.major as any)
        data.handles.forEach(({ ellipse, line }) => {
          if ((ellipse as any).parent) app.remove(ellipse as any)
          if ((line as any).parent) app.remove(line as any)
        })
      })
      this._positionControlMap.clear()
      this._activeControl = null
    }
  }

  // ── 私有方法 ───────────────────────────────────────────────────────────────

  private _ensureVertex(
    leaferWarpvas: LeaferWarpvas,
    rowIndex: number,
    colIndex: number,
    vertexType: VertexType,
    warpPoint: Coord,
    curve: { points: Coord[] },
    handleIdx: 1 | 2,
  ) {
    const { app } = leaferWarpvas
    const id = `${rowIndex}-${colIndex}-${vertexType}`

    let data = this._positionControlMap.get(id)
    if (!data) {
      const lp = leaferWarpvas.warpToLeaferPoint(warpPoint)
      const major = this._createMajorControl(lp.x, lp.y)
      app.add(major as any)

      data = { major, vertexType, rowIndex, colIndex, handles: [] }
      this._positionControlMap.set(id, data)

      this._registerVertexDrag(leaferWarpvas, major, data)

      major.on(PointerEvent.CLICK, (e: any) => {
        e.stopPropagation?.()
        if (this._activeControl === major) {
          this._deactivateControl()
        } else {
          this._activateControl(major, data!)
        }
      })
    }

    // 检查此句柄是否已被注册
    const exists = data.handles.some((h) => h.curve === curve && h.pointIdx === handleIdx)
    if (exists) return

    // 创建贝塞尔句柄
    const handleWarpPt = curve.points[handleIdx]
    const hlp = leaferWarpvas.warpToLeaferPoint(handleWarpPt)

    const handleEl = this._createHandleControl(hlp.x, hlp.y)
    const lineEl = this._createHandleLine(
      data.major.x ?? 0, data.major.y ?? 0,
      hlp.x, hlp.y,
    )

    handleEl.visible = false
    lineEl.visible = false

    app.add(lineEl as any)
    app.add(handleEl as any)

    data.handles.push({ ellipse: handleEl, line: lineEl, curve, pointIdx: handleIdx })

    this._registerHandleDrag(leaferWarpvas, handleEl, data, curve, handleIdx)
  }

  private _registerVertexDrag(
    leaferWarpvas: LeaferWarpvas,
    major: InstanceType<typeof Ellipse>,
    data: ControlData,
  ) {
    const { warpvas } = leaferWarpvas

    major.on(DragEvent.DRAG, (e: IDragEvent) => {
      if (!warpvas) return
      major.x = (major.x ?? 0) + e.moveX
      major.y = (major.y ?? 0) + e.moveY

      const newWarpPos = leaferWarpvas.leaferToWarpPoint({ x: major.x, y: major.y })
      try {
        warpvas.updateVertexCoord(data.rowIndex, data.colIndex, data.vertexType, newWarpPos)
      } catch { /* ignore */ }

      // 同步句柄连线起点
      data.handles.forEach(({ line }: any) => {
        line.x1 = major.x
        line.y1 = major.y
      })

      leaferWarpvas.requestRender(false, undefined, { skipHistoryRecording: true })
    })

    major.on(DragEvent.END, () => {
      leaferWarpvas.record()
    })
  }

  private _registerHandleDrag(
    leaferWarpvas: LeaferWarpvas,
    handle: InstanceType<typeof Ellipse>,
    data: ControlData,
    curve: { points: Coord[] },
    pointIdx: 1 | 2,
  ) {
    handle.on(DragEvent.DRAG, (e: IDragEvent) => {
      handle.x = (handle.x ?? 0) + e.moveX
      handle.y = (handle.y ?? 0) + e.moveY

      const delta = leaferWarpvas.pageToWarpDelta(e.moveX, e.moveY)
      curve.points[pointIdx].x += delta.x
      curve.points[pointIdx].y += delta.y

      const hData = data.handles.find((h) => h.ellipse === handle)
      if (hData) {
        ;(hData.line as any).x2 = handle.x
        ;(hData.line as any).y2 = handle.y
      }

      leaferWarpvas.requestRender(false, undefined, { skipHistoryRecording: true })
    })

    handle.on(DragEvent.END, () => {
      leaferWarpvas.record()
    })
  }

  private _activateControl(major: InstanceType<typeof Ellipse>, data: ControlData) {
    if (this._activeControl && this._activeControl !== major) {
      const old = this._findControlData(this._activeControl)
      old?.handles.forEach(({ ellipse, line }) => {
        ellipse.visible = false
        line.visible = false
      })
    }
    this._activeControl = major
    data.handles.forEach(({ ellipse, line }) => {
      ellipse.visible = true
      line.visible = true
    })
  }

  private _deactivateControl() {
    if (!this._activeControl) return
    const data = this._findControlData(this._activeControl)
    data?.handles.forEach(({ ellipse, line }) => {
      ellipse.visible = false
      line.visible = false
    })
    this._activeControl = null
  }

  private _findControlData(major: InstanceType<typeof Ellipse>): ControlData | undefined {
    for (const data of this._positionControlMap.values()) {
      if (data.major === major) return data
    }
    return undefined
  }

  private _createMajorControl(x: number, y: number): InstanceType<typeof Ellipse> {
    const ctrl = new Ellipse({
      x, y,
      width: 14, height: 14,
      fill: this.options.themeColor,
      stroke: '#ffffff',
      strokeWidth: 2,
      around: 'center',
      cursor: 'pointer',
    })
    return (this._styleSetters as any).control?.(ctrl) ?? ctrl
  }

  private _createHandleControl(x: number, y: number): InstanceType<typeof Ellipse> {
    const ctrl = new Ellipse({
      x, y,
      width: 9, height: 9,
      fill: this.options.subThemeColor,
      stroke: '#ffffff',
      strokeWidth: 1.5,
      around: 'center',
      cursor: 'crosshair',
    })
    return (this._styleSetters as any).curveControl?.(ctrl) ?? ctrl
  }

  private _createHandleLine(
    x1: number, y1: number,
    x2: number, y2: number,
  ): InstanceType<typeof Line> {
    return new Line({
      x1, y1, x2, y2,
      stroke: 'rgba(200,200,200,0.8)',
      strokeWidth: 1,
      hitFill: 'none',
      editable: false,
    })
  }
}

export default Warp
