# leafer-x-warpvas

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)

A **Leafer.js** plugin for interactive image warping, inspired by [fabric-warpvas](https://github.com/huanjinliu/fabric-warpvas).

---

### Introduction

`leafer-x-warpvas` brings image warping capabilities to [Leafer.js](https://leaferjs.com/). It wraps the powerful [warpvas](https://www.npmjs.com/package/warpvas) engine and exposes an easy-to-use API on top of Leafer's rendering layer.

Two built-in modes are provided:

- **Warp** — free-form mesh distortion with vertex and Bézier-handle control points
- **Perspective** — four-corner perspective transformation

---

### Installation

```shell
npm install leafer-ui leafer-x-warpvas
# or
pnpm add leafer-ui leafer-x-warpvas
```

> `leafer-ui` is required as a peer dependency (`>=1.0.0`).

---

### Quick Start

```typescript
import { App, Image } from 'leafer-ui'
import { LeaferWarpvas, Warp, Perspective } from 'leafer-x-warpvas'

// 1. Create Leafer App
const app = new App({ view: 'canvas', tree: {}, sky: {} })

// 2. Add the target image
const leaferImage = new Image({ x: 100, y: 100, width: 400, height: 300, url: './photo.jpg' })
app.tree.add(leaferImage)

// 3. Initialize LeaferWarpvas on the tree layer
const lw = new LeaferWarpvas(app.tree, {
  enableHistory: true,               // enable undo / redo
  onHistoryChange: ({ undo, redo }) => {
    console.log(`undo: ${undo.length}, redo: ${redo.length}`)
  },
})

// 4. Load source image as HTMLCanvasElement
const img = new window.Image()
img.onload = () => {
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  canvas.getContext('2d')!.drawImage(img, 0, 0)

  // 5. Enter warp editing mode
  lw.enterEditing(leaferImage, canvas, new Warp())
}
img.src = './photo.jpg'

// 6. Leave editing when done
// lw.leaveEditing()
```

---

### API

#### `new LeaferWarpvas(layer, options?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `layer` | `ILeafer` | Leafer layer to render on (`app.tree`, `app.sky`, or a standalone `Leafer`) |
| `options.enableHistory` | `boolean` | Enable undo/redo stack (default: `false`) |
| `options.onHistoryChange` | `function` | Called whenever the history stack changes |

**Instance methods**

| Method | Description |
|--------|-------------|
| `enterEditing(target, sourceCanvas, mode, beforeFirstRender?)` | Enter warp editing mode |
| `leaveEditing()` | Exit editing mode and restore the original element |
| `render(dirty?, options?)` | Force re-render the current warp state |
| `requestRender(dirty?, callback?, options?)` | Schedule render on next animation frame |
| `undo()` | Undo last warp operation |
| `redo()` | Redo previously undone operation |
| `reset()` | Reset all warping back to original shape |
| `getWarpState()` | Get current warp state (for serialization) |

---

### Built-in Modes

#### Warp

```typescript
import { Warp } from 'leafer-x-warpvas'

const warp = new Warp({ themeColor: '#4A90D9' })

// Customize control-point style
warp.registerStyleSetter('control', (ellipse) => {
  ellipse.fill = 'blue'
  return ellipse
})

lw.enterEditing(image, canvas, warp)
```

**Interactions:**
- Drag vertex control points to distort the image
- Click a vertex to reveal its Bézier handles
- Drag Bézier handles to adjust curve curvature

#### Perspective

```typescript
import { Perspective } from 'leafer-x-warpvas'

const persp = new Perspective({ themeColor: '#FF6B35' })
lw.enterEditing(image, canvas, persp)
```

**Interactions:**
- Drag any of the four corner control points for perspective transformation

---

### Custom Mode

Extend `AbstractMode` to create your own warping effect:

```typescript
import { AbstractMode, LeaferWarpvas } from 'leafer-x-warpvas'
import type { Warpvas } from 'warpvas'

class MyMode extends AbstractMode {
  name = 'my-mode'

  execute(warpvas: Warpvas) {
    return super.execute(warpvas)   // or your own split-point strategy
  }

  render(lw: LeaferWarpvas) {
    const cleanup = super.render(lw)  // adds warped image to canvas
    // ... add custom interactive elements
    return () => {
      cleanup?.()
      // ... remove custom elements
    }
  }

  dirtyRender(lw: LeaferWarpvas) {
    // called when grid structure changes (dirty = true)
    // ... create control points
    return () => { /* cleanup */ }
  }
}
```

---

### Features

- **Warp distortion** — free-form mesh warping with vertex and Bézier-handle controls
- **Perspective transformation** — four-corner perspective with automatic validity checks
- **History management** — undo / redo / reset support
- **Coordinate utilities** — `warpToLeaferPoint`, `leaferToWarpPoint`, `pageToWarpDelta`
- **Style customization** — `registerStyleSetter` for control points, handles, grid lines and warped image
- **Extensible** — `AbstractMode` base class for custom warping modes
- **TypeScript** — full TypeScript support with strict types

---

### Development

```shell
# Install dependencies
npm install

# Start demo dev server
npm run dev        # http://localhost:5174

# Build plugin
npm run build
```

The demo features:
- A gradient test image with grid lines (so distortion is clearly visible)
- Toolbar for switching modes and triggering undo/redo/reset
- Keyboard shortcuts: `Ctrl+Z` undo, `Ctrl+Y` redo, `Esc` exit editing

---

### License

MIT License

---

### Acknowledgements

- [warpvas](https://github.com/huanjinliu/warpvas) — core warping engine
- [warpvas-perspective](https://www.npmjs.com/package/warpvas-perspective) — perspective algorithm
- [fabric-warpvas](https://github.com/huanjinliu/fabric-warpvas) — original Fabric.js implementation this plugin is inspired by
- [Leafer.js](https://leaferjs.com/) — the canvas rendering framework
