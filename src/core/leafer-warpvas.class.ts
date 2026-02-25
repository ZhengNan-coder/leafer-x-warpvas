import type { ILeafer } from '@leafer-ui/interface'
import { Image as LeaferImage } from '@leafer-ui/core'
import { Warpvas } from 'warpvas'
import type { AbstractMode } from './abstract-mode.class'

type WarpState = ReturnType<Warpvas['getWarpState']>

/**
 * LeaferWarpvas 实例配置选项
 */
export type LeaferWarpvasOptions = {
  /** 是否启用变形操作的历史记录 @default false */
  enableHistory: boolean
  /** 历史记录变化时的回调 */
  onHistoryChange: (records: { undo: WarpState[]; redo: WarpState[] }) => void
}

/**
 * Leafer.js 图像变形工具类
 *
 * 为 Leafer.js 的某个图层（Leafer / app.tree）提供交互式图像变形功能，
 * 支持扭曲（Warp）和透视（Perspective）两种模式。
 *
 * @example
 * ```typescript
 * import { App, Image } from 'leafer-ui'
 * import { LeaferWarpvas, Warp } from 'leafer-x-warpvas'
 *
 * const app = new App({ view: 'canvas', tree: {}, sky: {} })
 *
 * const leaferImage = new Image({ x: 100, y: 100, width: 400, height: 300, url: 'image.jpg' })
 * app.tree.add(leaferImage)
 *
 * const leaferWarpvas = new LeaferWarpvas(app.tree)
 *
 * const img = new window.Image()
 * img.onload = () => {
 *   const canvas = document.createElement('canvas')
 *   canvas.width = img.naturalWidth
 *   canvas.height = img.naturalHeight
 *   canvas.getContext('2d')!.drawImage(img, 0, 0)
 *   leaferWarpvas.enterEditing(leaferImage, canvas, new Warp())
 * }
 * img.src = 'image.jpg'
 * ```
 */
export class LeaferWarpvas {
  /** Leafer 图层实例（`App.tree`、`App.sky` 或独立的 `Leafer` 实例均可） */
  app: ILeafer

  /** 实例配置 */
  options: LeaferWarpvasOptions

  /** 底层变形引擎实例 */
  warpvas: Warpvas | null = null

  /** 当前正在编辑的 Leafer Image 元素 */
  target: InstanceType<typeof LeaferImage> | null = null

  /** 变形结果渲染 Canvas */
  renderCanvas: HTMLCanvasElement | null = null

  /** 在 Leafer 画布上显示变形效果的 Image 元素 */
  warpvasImage: InstanceType<typeof LeaferImage> | undefined

  /** 当前激活的变形模式 */
  mode: AbstractMode | null = null

  /**
   * warpvas 坐标 → Leafer 页面坐标的 X 轴比例
   * 公开供 mode 内部使用（用于 totalX/totalY 转换）
   */
  scaleX = 1

  /**
   * warpvas 坐标 → Leafer 页面坐标的 Y 轴比例
   * 公开供 mode 内部使用
   */
  scaleY = 1

  /** warpvasImage 是否已加入画布（避免重复 add） */
  private _warpvasImageOnCanvas = false

  /**
   * mode.render() 的清理回调——仅在 leaveEditing() 时执行，
   * 负责移除 boundary paths 等首次渲染时添加的持久元素
   */
  private _renderReturnCallback?: (() => void) | void

  /**
   * mode.dirtyRender() 的清理回调——在下次 dirty render 或 leaveEditing() 时执行，
   * 负责移除控制点等结构性元素
   */
  private _dirtyRenderReturnCallback?: (() => void) | void

  private _nextFrameRender?: number

  private _records: { undo: WarpState[]; redo: WarpState[] } = {
    undo: [],
    redo: [],
  }

  constructor(app: ILeafer, options: Partial<LeaferWarpvasOptions> = {}) {
    this.app = app
    this.options = {
      enableHistory: false,
      onHistoryChange: () => {},
      ...options,
    }
  }

  // ─── 坐标转换工具 ────────────────────────────────────────────────────────────

  /**
   * 将 warpvas 内部坐标转换为 Leafer 页面坐标
   */
  warpToLeaferPoint(point: { x: number; y: number }): { x: number; y: number } {
    return {
      x: (this.target?.x ?? 0) + point.x * this.scaleX,
      y: (this.target?.y ?? 0) + point.y * this.scaleY,
    }
  }

  /**
   * 将 Leafer 页面坐标转换为 warpvas 内部坐标
   */
  leaferToWarpPoint(point: { x: number; y: number }): { x: number; y: number } {
    return {
      x: (point.x - (this.target?.x ?? 0)) / this.scaleX,
      y: (point.y - (this.target?.y ?? 0)) / this.scaleY,
    }
  }

  /**
   * 将 Leafer 页面坐标增量转换为 warpvas 增量
   */
  pageToWarpDelta(dx: number, dy: number): { x: number; y: number } {
    return {
      x: dx / this.scaleX,
      y: dy / this.scaleY,
    }
  }

  // ─── 核心渲染 ────────────────────────────────────────────────────────────────

  /**
   * 渲染变形效果
   *
   * - dirty=true：重建控制点结构（添加/删除了分割点时使用）
   * - dirty=false：仅更新变形图像和控制点位置（拖拽过程中使用，无闪烁）
   */
  render(dirty = true, options: { skipHistoryRecording?: boolean } = {}) {
    if (!this.warpvas || !this.target) return

    // dirty render 时清理上次创建的控制点（结构性元素）
    if (dirty && this._dirtyRenderReturnCallback) {
      this._dirtyRenderReturnCallback()
      this._dirtyRenderReturnCallback = undefined
    }

    // 执行 warpvas 变形渲染
    const renderCanvas = this.warpvas.render()
    this.renderCanvas = renderCanvas

    // 计算 warpvas → Leafer 的缩放比例
    const displayW = (this.target.width ?? 0) * (this.target.scaleX ?? 1)
    const displayH = (this.target.height ?? 0) * (this.target.scaleY ?? 1)
    this.scaleX = renderCanvas.width > 0 ? displayW / renderCanvas.width : 1
    this.scaleY = renderCanvas.height > 0 ? displayH / renderCanvas.height : 1

    // 更新变形图像的 URL（不 remove/add，避免闪烁）
    const dataUrl = renderCanvas.toDataURL('image/png')
    if (!this.warpvasImage) {
      this.warpvasImage = new LeaferImage({
        x: this.target.x ?? 0,
        y: this.target.y ?? 0,
        width: displayW,
        height: displayH,
        url: dataUrl,
        hitFill: 'none',
        editable: false,
      })
    } else {
      this.warpvasImage.url = dataUrl
      this.warpvasImage.x = this.target.x ?? 0
      this.warpvasImage.y = this.target.y ?? 0
      this.warpvasImage.width = displayW
      this.warpvasImage.height = displayH
    }

    // warpvasImage 只添加一次；paths 等持久元素也只在首次通过 mode.render() 建立
    if (!this._warpvasImageOnCanvas) {
      this.app.add(this.warpvasImage as any)
      this._warpvasImageOnCanvas = true
      // mode.render() 负责添加 boundary paths 等持久元素，返回清理函数在 leaveEditing 时执行
      this._renderReturnCallback = this.mode?.render(this)
    }

    // 记录变形历史
    if (!options.skipHistoryRecording) this.record()

    if (dirty) {
      // dirty render：重建控制点
      this._dirtyRenderReturnCallback = this.mode?.dirtyRender(this)
    } else {
      // non-dirty render：只同步控制点位置（无 remove/add，无闪烁）
      this.mode?.refreshPositions(this)
    }
  }

  /**
   * 请求在下一帧渲染（适用于连续拖拽场景）
   */
  requestRender(
    dirty = true,
    callback?: () => void,
    options: { skipHistoryRecording?: boolean } = {},
  ) {
    if (this._nextFrameRender !== undefined) {
      window.cancelAnimationFrame(this._nextFrameRender)
    }
    this._nextFrameRender = window.requestAnimationFrame(() => {
      this.render(dirty, options)
      callback?.()
      this._nextFrameRender = undefined
    })
  }

  // ─── 编辑状态管理 ─────────────────────────────────────────────────────────────

  /**
   * 进入变形编辑模式
   *
   * @param target - 要变形的 Leafer Image 元素
   * @param sourceCanvas - 源图像 Canvas（null 时尝试从 target.url 加载）
   * @param mode - 变形模式实例（Warp / Perspective / 自定义）
   * @param beforeFirstRender - 首次渲染前的回调，可用于初始化 warpvas 配置
   */
  enterEditing(
    target: InstanceType<typeof LeaferImage>,
    sourceCanvas: HTMLCanvasElement | null,
    mode: AbstractMode,
    beforeFirstRender?: (warpvas: Warpvas) => void,
  ) {
    if (this.target) {
      throw new Error('[LeaferWarpvas] 请先退出当前变形编辑状态，再进入新的变形编辑。')
    }

    this.target = target
    this.mode = mode

    // 隐藏原始元素（变形期间显示变形后的版本）
    target.visible = false

    const setup = (canvas: HTMLCanvasElement) => {
      const warpvas = new Warpvas(canvas)
      warpvas
        .setInputLimitSize({ width: 2000, height: 2000 })
        .setRenderingCanvas(document.createElement('canvas'))
        .setSplitStrategy({
          name: mode.name,
          execute: mode.execute.bind(mode),
        })

      this.warpvas = warpvas
      beforeFirstRender?.(warpvas)
      this.render()
    }

    if (sourceCanvas) {
      setup(sourceCanvas)
      return
    }

    // 从 target.url 加载源图
    const NativeImage = window.Image as unknown as new () => HTMLImageElement
    const img = new NativeImage()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      img.onload = null
      setup(canvas)
    }
    img.onerror = () => {
      console.error('[LeaferWarpvas] 无法加载目标图像，请提供 sourceCanvas 参数。')
      target.visible = true
      this.target = null
      this.mode = null
    }
    img.src = (target as unknown as { url: string }).url || ''

    // 若图像已缓存（data URL 或同域），直接同步处理
    if (img.complete && img.naturalWidth > 0) {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      canvas.getContext('2d')!.drawImage(img, 0, 0)
      img.onload = null
      setup(canvas)
    }
  }

  /**
   * 退出变形编辑模式，恢复原始元素可见性并清理所有资源
   */
  leaveEditing() {
    if (!this.target) return

    // 取消未执行的 rAF
    if (this._nextFrameRender !== undefined) {
      window.cancelAnimationFrame(this._nextFrameRender)
      this._nextFrameRender = undefined
    }

    // 清理结构性控制点
    if (this._dirtyRenderReturnCallback) {
      this._dirtyRenderReturnCallback()
      this._dirtyRenderReturnCallback = undefined
    }

    // 清理 paths 等持久元素（mode.render() 的清理函数）
    if (this._renderReturnCallback) {
      this._renderReturnCallback()
      this._renderReturnCallback = undefined
    }

    // 恢复原始元素可见性
    this.target.visible = true

    // 移除变形图像
    if (this.warpvasImage && (this.warpvasImage as any).parent) {
      this.app.remove(this.warpvasImage as any)
    }

    // 释放资源
    this.mode = null
    this.target = null
    this.warpvas = null
    this.warpvasImage = undefined
    this.renderCanvas = null
    this.scaleX = 1
    this.scaleY = 1
    this._warpvasImageOnCanvas = false
    this._records.undo.length = 0
    this._records.redo.length = 0
  }

  // ─── 历史记录 ─────────────────────────────────────────────────────────────────

  record() {
    if (!this.warpvas || !this.options.enableHistory) return
    this._records.redo.length = 0
    this._records.undo.push(structuredClone(this.warpvas.getWarpState()))
    this.options.onHistoryChange(this._records)
  }

  undo() {
    if (!this.warpvas) return
    const size = this._records.undo.length
    if (size <= 1) return
    this._records.redo.unshift(this._records.undo.pop()!)
    const record = this._records.undo[size - 2]
    this.warpvas.setWarpState(record.splitPoints, record.regionBounds)
    this.render(true, { skipHistoryRecording: true })
    this.options.onHistoryChange(this._records)
  }

  redo() {
    if (!this.warpvas) return
    const record = this._records.redo.shift()
    if (record) {
      this._records.undo.push(record)
      this.warpvas.setWarpState(record.splitPoints, record.regionBounds)
      this.render(true, { skipHistoryRecording: true })
      this.options.onHistoryChange(this._records)
    }
  }

  reset() {
    if (!this.warpvas) return
    this.warpvas.resetWarpState()
    this.render(true)
  }

  getWarpState(): WarpState | null {
    return this.warpvas?.getWarpState() ?? null
  }

  getMode<T extends AbstractMode = AbstractMode>(): T | null {
    return this.mode as T | null
  }
}
