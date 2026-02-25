import { App, Image, Rect } from 'leafer-ui'
import { LeaferWarpvas, Warp, Perspective } from 'leafer-x-warpvas'

// ─── 常量配置 ────────────────────────────────────────────────────────────────

const CANVAS_WIDTH = 720
const CANVAS_HEIGHT = 480
const IMAGE_URL = createDemoImageDataURL()

// ─── 初始化 Leafer App ────────────────────────────────────────────────────────

const app = new App({
  view: 'leafer-canvas',
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  fill: '#2a2a3e',
  tree: {},
  sky: {},
})

// 棋盘格背景（用于显示透明区域）
addCheckerboard()

// ─── 创建目标图像 ─────────────────────────────────────────────────────────────

const targetImage = new Image({
  x: 160,
  y: 90,
  width: 400,
  height: 300,
  url: IMAGE_URL,
})

app.tree.add(targetImage)

// ─── 初始化 LeaferWarpvas（绑定到 app.tree 图层）────────────────────────────

const leaferWarpvas = new LeaferWarpvas(app.tree as any, {
  enableHistory: true,
  onHistoryChange: (records: { undo: any[]; redo: any[] }) => {
    undoBtn.disabled = records.undo.length <= 1
    redoBtn.disabled = records.redo.length === 0
    statusHistory.textContent = `${records.undo.length} 步`
  },
})

// 预加载图像为 HTMLCanvasElement
let sourceCanvas: HTMLCanvasElement | null = null

const NativeImage = window.Image as unknown as new () => HTMLImageElement
const img = new NativeImage()
img.onload = () => {
  sourceCanvas = document.createElement('canvas')
  sourceCanvas.width = img.naturalWidth
  sourceCanvas.height = img.naturalHeight
  sourceCanvas.getContext('2d')!.drawImage(img, 0, 0)
  warpBtn.disabled = false
  perspectiveBtn.disabled = false
}
img.src = IMAGE_URL

// ─── UI 元素引用 ───────────────────────────────────────────────────────────────

const warpBtn        = document.getElementById('btn-warp')        as HTMLButtonElement
const perspectiveBtn = document.getElementById('btn-perspective') as HTMLButtonElement
const leaveBtn       = document.getElementById('btn-leave')       as HTMLButtonElement
const undoBtn        = document.getElementById('btn-undo')        as HTMLButtonElement
const redoBtn        = document.getElementById('btn-redo')        as HTMLButtonElement
const resetBtn       = document.getElementById('btn-reset')       as HTMLButtonElement
const hint           = document.getElementById('hint')            as HTMLDivElement
const statusMode     = document.getElementById('status-mode')     as HTMLSpanElement
const statusEditing  = document.getElementById('status-editing')  as HTMLSpanElement
const statusHistory  = document.getElementById('status-history')  as HTMLSpanElement

// 初始状态：禁用按钮（等待图像加载）
warpBtn.disabled = true
perspectiveBtn.disabled = true

// ─── 状态管理 ──────────────────────────────────────────────────────────────────

type Mode = 'warp' | 'perspective' | null
let currentMode: Mode = null

function setEditingState(mode: Mode) {
  currentMode = mode

  warpBtn.disabled        = mode !== null || !sourceCanvas
  perspectiveBtn.disabled = mode !== null || !sourceCanvas
  leaveBtn.disabled       = mode === null
  undoBtn.disabled        = mode === null
  redoBtn.disabled        = mode === null
  resetBtn.disabled       = mode === null

  warpBtn.classList.toggle('active', mode === 'warp')
  perspectiveBtn.classList.toggle('active', mode === 'perspective')

  if (mode === 'warp') {
    statusMode.textContent    = 'Warp 扭曲'
    hint.textContent = '拖动控制点调整形状 · 点击顶点显示贝塞尔句柄 · Esc 退出'
  } else if (mode === 'perspective') {
    statusMode.textContent    = 'Perspective 透视'
    hint.textContent = '拖动四角控制点实现透视变换 · Esc 退出'
  } else {
    statusMode.textContent    = '—'
    hint.textContent = '选择左侧变形模式以开始'
  }

  statusEditing.textContent = mode !== null ? '是' : '否'
  statusEditing.className   = mode !== null ? 'value active' : 'value'
}

// ─── 按钮事件绑定 ─────────────────────────────────────────────────────────────

warpBtn.addEventListener('click', () => {
  if (!sourceCanvas) return
  leaferWarpvas.enterEditing(targetImage as any, cloneCanvas(sourceCanvas), new Warp())
  setEditingState('warp')
})

perspectiveBtn.addEventListener('click', () => {
  if (!sourceCanvas) return
  leaferWarpvas.enterEditing(targetImage as any, cloneCanvas(sourceCanvas), new Perspective())
  setEditingState('perspective')
})

leaveBtn.addEventListener('click', () => {
  leaferWarpvas.leaveEditing()
  setEditingState(null)
  statusHistory.textContent = '0 步'
})

undoBtn.addEventListener('click',  () => leaferWarpvas.undo())
redoBtn.addEventListener('click',  () => leaferWarpvas.redo())
resetBtn.addEventListener('click', () => leaferWarpvas.reset())

// ─── 键盘快捷键 ───────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && currentMode !== null) {
    leaferWarpvas.leaveEditing()
    setEditingState(null)
    statusHistory.textContent = '0 步'
    return
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (currentMode !== null) leaferWarpvas.undo()
    return
  }
  if (
    (e.ctrlKey || e.metaKey) &&
    (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))
  ) {
    e.preventDefault()
    if (currentMode !== null) leaferWarpvas.redo()
    return
  }
})

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function cloneCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const dst = document.createElement('canvas')
  dst.width = src.width
  dst.height = src.height
  dst.getContext('2d')!.drawImage(src, 0, 0)
  return dst
}

/**
 * 生成带有网格线和文字的演示图像（data URL）
 */
function createDemoImageDataURL(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 400
  canvas.height = 300
  const ctx = canvas.getContext('2d')!

  // 渐变背景
  const grad = ctx.createLinearGradient(0, 0, 400, 300)
  grad.addColorStop(0,   '#667eea')
  grad.addColorStop(0.5, '#764ba2')
  grad.addColorStop(1,   '#f093fb')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 400, 300)

  // 装饰圆形
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.beginPath(); ctx.arc(80, 80, 60, 0, Math.PI * 2); ctx.fill()

  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.beginPath(); ctx.arc(320, 220, 80, 0, Math.PI * 2); ctx.fill()

  // 网格线（帮助观察变形效果）
  ctx.strokeStyle = 'rgba(255,255,255,0.2)'
  ctx.lineWidth = 1
  for (let x = 50; x < 400; x += 50) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 300); ctx.stroke()
  }
  for (let y = 50; y < 300; y += 50) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(400, y); ctx.stroke()
  }

  // 主文字
  ctx.font = 'bold 24px -apple-system, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.92)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('leafer-x-warpvas', 200, 128)

  ctx.font = '14px -apple-system, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.fillText('拖动控制点体验变形效果', 200, 162)

  // 四角圆点标记
  const corners: [number, number][] = [[12, 12], [388, 12], [12, 288], [388, 288]]
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  corners.forEach(([cx, cy]) => {
    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill()
  })

  return canvas.toDataURL('image/png')
}

/**
 * 添加棋盘格背景
 */
function addCheckerboard() {
  const size = 20
  const cols = Math.ceil(CANVAS_WIDTH / size)
  const rows = Math.ceil(CANVAS_HEIGHT / size)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rect = new Rect({
        x: c * size,
        y: r * size,
        width: size,
        height: size,
        fill: (r + c) % 2 === 0 ? '#333344' : '#2a2a3e',
        hitFill: 'none',
        editable: false,
      })
      app.tree.add(rect)
    }
  }
}
