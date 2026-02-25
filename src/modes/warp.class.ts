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
  /** 对应的 warpvas 曲线（直接持有引用，curve.points 是权威数据源） */
  curve: { points: Coord[] }
  /** 曲线上的点索引（1 = P1 句柄, 2 = P2 句柄） */
  pointIdx: 1 | 2
}

type ControlData = {
  major: InstanceType<typeof Ellipse>
  vertexType: VertexType
  rowIndex: number
  colIndex: number
  handles: HandleData[]
  /**
   * 该顶点对应的"代表曲线"与端点索引，用于从 warpvas 读回实际坐标。
   * 格式：{ curve, pointIdx } 其中 pointIdx 为 0 或 3。
   */
  repr: { curve: { points: Coord[] }; pointIdx: 0 | 3 }
}

/**
 * 扭曲（Warp）变形模式
 *
 * 提供网格化扭曲变形功能：
 * - 拖动四角顶点控制点修改整体形状（使用 totalX/totalY 无漂移）
 * - 点击顶点控制点后出现贝塞尔句柄，拖动句柄精确调整曲线弧度
 * - refreshPositions() 在每次非脏渲染后同步所有控制点位置
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

  // ── 脏渲染：重建全部控制点 ─────────────────────────────────────────────────

  dirtyRender(leaferWarpvas: LeaferWarpvas) {
    const { app, warpvas } = leaferWarpvas
    if (!app || !warpvas) return

    const areaBounds = warpvas.regionBoundaryCurves as any[][]
    if (!areaBounds?.length) return

    this._positionControlMap.clear()
    this._activeControl = null

    // ── 方向 → 端点顶点类型映射 ─────────────────────────────────────────────
    // top:    P0=TOP_LEFT,    P3=TOP_RIGHT
    // right:  P0=TOP_RIGHT,   P3=BOTTOM_RIGHT
    // bottom: P0=BOTTOM_LEFT, P3=BOTTOM_RIGHT
    // left:   P0=TOP_LEFT,    P3=BOTTOM_LEFT
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

          // P0 端点 → vtP0，其贝塞尔句柄索引为 1（P1）
          this._ensureVertex(leaferWarpvas, rowIndex, colIndex, vtP0, pts[0], curve, 0, 1)
          // P3 端点 → vtP3，其贝塞尔句柄索引为 2（P2）
          this._ensureVertex(leaferWarpvas, rowIndex, colIndex, vtP3, pts[3], curve, 3, 2)
        })
      })
    })

    // 全局 PointerEvent.DOWN 事件取消激活（用于点击空白区域关闭句柄）
    const handleAppDown = () => { this._deactivateControl() }
    app.on(PointerEvent.DOWN, handleAppDown)

    return () => {
      app.off(PointerEvent.DOWN, handleAppDown)

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

  // ── 非脏渲染：只更新已有控制点的位置 ─────────────────────────────────────

  /**
   * 从 warpvas curve.points 重新读取每个顶点和句柄的坐标，
   * 直接更新 Ellipse 和 Line 的 x/y，不 add/remove 任何元素（无闪烁）。
   */
  refreshPositions(leaferWarpvas: LeaferWarpvas) {
    // 先更新 boundary paths
    super.refreshPositions(leaferWarpvas)

    this._positionControlMap.forEach((data) => {
      // 从 warpvas 权威数据源读回顶点位置
      const actualWarpPt = data.repr.curve.points[data.repr.pointIdx]
      const lp = leaferWarpvas.warpToLeaferPoint(actualWarpPt)
      data.major.x = lp.x
      data.major.y = lp.y

      // 同步所有句柄位置和连线
      this._syncHandles(leaferWarpvas, data)
    })
  }

  // ── 私有辅助方法 ───────────────────────────────────────────────────────────

  /**
   * 确保指定顶点位置的控制点已创建，同时注册其贝塞尔句柄
   *
   * @param reprPointIdx - 代表曲线上的端点索引（0 或 3），用于读回实际坐标
   * @param handleIdx   - 该端点归属的句柄索引（1 = P1, 2 = P2）
   */
  private _ensureVertex(
    lw: LeaferWarpvas,
    rowIndex: number,
    colIndex: number,
    vertexType: VertexType,
    warpPoint: Coord,
    curve: { points: Coord[] },
    reprPointIdx: 0 | 3,
    handleIdx: 1 | 2,
  ) {
    const { app } = lw
    const id = `${rowIndex}-${colIndex}-${vertexType}`

    let data = this._positionControlMap.get(id)
    if (!data) {
      const lp = lw.warpToLeaferPoint(warpPoint)
      const major = this._createMajorControl(lp.x, lp.y)
      app.add(major as any)

      data = {
        major,
        vertexType,
        rowIndex,
        colIndex,
        handles: [],
        repr: { curve, pointIdx: reprPointIdx },
      }
      this._positionControlMap.set(id, data)

      this._registerVertexDrag(lw, major, data)

      // 点击顶点：切换句柄的显示/隐藏
      major.on(PointerEvent.CLICK, (e: any) => {
        e.stopPropagation?.()
        if (this._activeControl === major) {
          this._deactivateControl()
        } else {
          this._activateControl(major, data!)
        }
      })
    }

    // 检查此句柄是否已注册
    const exists = data.handles.some((h) => h.curve === curve && h.pointIdx === handleIdx)
    if (exists) return

    const handleWarpPt = curve.points[handleIdx]
    const hlp = lw.warpToLeaferPoint(handleWarpPt)

    const handleEl = this._createHandleControl(hlp.x, hlp.y)
    const lineEl = this._createHandleLine(data.major.x ?? 0, data.major.y ?? 0, hlp.x, hlp.y)

    handleEl.visible = false
    lineEl.visible = false

    app.add(lineEl as any)
    app.add(handleEl as any)

    data.handles.push({ ellipse: handleEl, line: lineEl, curve, pointIdx: handleIdx })
    this._registerHandleDrag(lw, handleEl, data, curve, handleIdx)
  }

  /**
   * 注册顶点控制点的拖拽事件。
   * 使用 DragEvent.START 记录起始 warpvas 坐标，
   * 使用 totalX/totalY 计算新坐标，再从 warpvas 读回实际坐标（消除漂移）。
   */
  private _registerVertexDrag(lw: LeaferWarpvas, major: InstanceType<typeof Ellipse>, data: ControlData) {
    let startWarpX = 0
    let startWarpY = 0

    major.on(DragEvent.START, () => {
      // 从 warpvas curve.points 读取起始坐标（权威来源）
      const pt = data.repr.curve.points[data.repr.pointIdx]
      startWarpX = pt.x
      startWarpY = pt.y
    })

    major.on(DragEvent.DRAG, (e: IDragEvent) => {
      if (!lw.warpvas) return

      // 用 totalX/totalY 计算新 warpvas 坐标（无累积误差）
      const newWarpPos = {
        x: startWarpX + (e.totalX ?? 0) / lw.scaleX,
        y: startWarpY + (e.totalY ?? 0) / lw.scaleY,
      }

      try {
        lw.warpvas.updateVertexCoord(data.rowIndex, data.colIndex, data.vertexType, newWarpPos)
      } catch {
        // updateVertexCoord 失败（越界等），忽略本次更新
      }

      // 从 warpvas 读回实际坐标（可能被内部约束），消除漂移
      const actualWarp = data.repr.curve.points[data.repr.pointIdx]
      const actualLp = lw.warpToLeaferPoint(actualWarp)
      major.x = actualLp.x
      major.y = actualLp.y

      // 同步句柄位置和连线
      this._syncHandles(lw, data)

      lw.requestRender(false, undefined, { skipHistoryRecording: true })
    })

    major.on(DragEvent.END, () => {
      lw.record()
    })
  }

  /**
   * 注册贝塞尔句柄的拖拽事件。
   * 同样使用 totalX/totalY + 从 curve.points 读回，无漂移。
   */
  private _registerHandleDrag(
    lw: LeaferWarpvas,
    handle: InstanceType<typeof Ellipse>,
    data: ControlData,
    curve: { points: Coord[] },
    pointIdx: 1 | 2,
  ) {
    let startWarpX = 0
    let startWarpY = 0

    handle.on(DragEvent.START, () => {
      startWarpX = curve.points[pointIdx].x
      startWarpY = curve.points[pointIdx].y
    })

    handle.on(DragEvent.DRAG, (e: IDragEvent) => {
      // 直接修改 curve.points（贝塞尔句柄无约束）
      curve.points[pointIdx].x = startWarpX + (e.totalX ?? 0) / lw.scaleX
      curve.points[pointIdx].y = startWarpY + (e.totalY ?? 0) / lw.scaleY

      // 从 curve.points 读回，同步句柄显示位置
      const lp = lw.warpToLeaferPoint(curve.points[pointIdx])
      handle.x = lp.x
      handle.y = lp.y

      // 更新连线端点（连线终点跟随句柄）
      const hData = data.handles.find((h) => h.ellipse === handle)
      if (hData) {
        ;(hData.line as any).x2 = handle.x
        ;(hData.line as any).y2 = handle.y
      }

      lw.requestRender(false, undefined, { skipHistoryRecording: true })
    })

    handle.on(DragEvent.END, () => {
      lw.record()
    })
  }

  /**
   * 同步指定顶点的所有句柄位置和连线（从 curve.points 读取）
   */
  private _syncHandles(lw: LeaferWarpvas, data: ControlData) {
    const majorX = data.major.x ?? 0
    const majorY = data.major.y ?? 0

    data.handles.forEach(({ ellipse, line, curve, pointIdx }) => {
      const warpPt = curve.points[pointIdx]
      const lp = lw.warpToLeaferPoint(warpPt)
      ellipse.x = lp.x
      ellipse.y = lp.y

      // 更新连线：起点 = 顶点，终点 = 句柄
      ;(line as any).x1 = majorX
      ;(line as any).y1 = majorY
      ;(line as any).x2 = lp.x
      ;(line as any).y2 = lp.y
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

  private _createHandleLine(x1: number, y1: number, x2: number, y2: number): InstanceType<typeof Line> {
    return new Line({ x1, y1, x2, y2, stroke: 'rgba(200,200,200,0.8)', strokeWidth: 1, hitFill: 'none', editable: false })
  }
}

export default Warp
