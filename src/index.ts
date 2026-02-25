/**
 * leafer-x-warpvas
 *
 * Leafer.js 图像变形插件，为 Leafer.js 提供扭曲（Warp）和透视（Perspective）两种变形模式。
 *
 * @example
 * ```typescript
 * import { App, Image } from 'leafer-ui'
 * import { LeaferWarpvas, Warp, Perspective } from 'leafer-x-warpvas'
 *
 * const app = new App({ view: 'canvas' })
 * const image = new Image({ x: 100, y: 100, width: 400, height: 300, url: './photo.jpg' })
 * app.add(image)
 *
 * const warpvas = new LeaferWarpvas(app)
 *
 * // 进入扭曲变形模式
 * const canvas = getImageAsCanvas('./photo.jpg')
 * warpvas.enterEditing(image, canvas, new Warp())
 *
 * // 退出变形模式
 * warpvas.leaveEditing()
 * ```
 */

// 核心类
export { LeaferWarpvas } from './core/leafer-warpvas.class'
export type { LeaferWarpvasOptions } from './core/leafer-warpvas.class'
export { AbstractMode } from './core/abstract-mode.class'

// 内置变形模式
export { default as Warp, VertexType as WarpVertexType } from './modes/warp.class'
export { default as Perspective, VertexType as PerspectiveVertexType } from './modes/perspective.class'

// 基类（供自定义模式继承）
export { default as BaseMode } from './modes/base.class'
export type { BaseOptions, BaseStyleSetters } from './modes/base.class'
export { THEME_COLOR, SUB_THEME_COLOR } from './modes/base.class'
