# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

微信表情包大师 (WeChat Sticker Pro) — an Eagle plugin that batch-processes images into WeChat-compliant stickers (300x300px, 1:1 crop). No build system; plain HTML/CSS/JS loaded directly by Eagle.

## Architecture

- `manifest.json` — Eagle plugin config (entry point, window size, plugin ID)
- `index.html` — UI shell; loads Cropper.js from cdnjs CDN
- `script.js` — all logic: Eagle API integration, Cropper.js lifecycle, Canvas-based image processing, batch queue, localStorage settings persistence
- `style.css` — Eagle native style (light grays, blue accent `#4a90d9`)
- `logo.png` — plugin icon (referenced by `manifest.json`)

The flow: Eagle launches plugin → `eagle.onPluginCreate` grabs selected items → renders thumbnail list on the left → user crops each image with Cropper.js (locked 1:1) → draggable text overlay for positioning → `getCroppedCanvas` renders to 300x300 → text drawn via Canvas → buffer written to temp file → `eagle.item.addFromPath` imports back into Eagle → `closeAndFocus()` focuses Eagle main window and opens target folder.

## Key Technical Details

- **Eagle Plugin API**: `eagle.onPluginCreate` for init, `eagle.item.getSelected()` for batch input, `eagle.item.addFromPath()` for save, `eagle.item.moveToTrash()` for optional delete, `eagle.mainWindow.focus()` + `eagle.folder.open()` for post-save focus
- **Image loading**: uses `file://` protocol on `item.filePath` — requires Eagle permission
- **Cropper.js**: locked `aspectRatio: 1/1`, `viewMode: 1`, `autoCropArea: 1`. Also uses `rotate()`, `scaleX()` for flip, and `crop` event for live preview
- **Output**: always 300x300px; JPG at quality 0.8 or PNG lossless
- **Settings persistence**: `localStorage` key `wechat_sticker_settings` (format, tags, folder ID, delete-original, text content/size/color/position/stroke)
- **Text overlay**: draggable `<div>` positioned via `textPos` relative coordinates (0–1); synced to crop box via `positionOverlay()`. Rendered via Canvas `fillText`/`strokeText` on export. Font: bold Microsoft YaHei/PingFang SC. Style (size, color, stroke) synced in real-time from controls.
- **Thumbnail list**: 80px left sidebar showing all selected items. Click to navigate. Completed items get a checkmark (`.done` class).
- **Settings panel**: export settings section hides after first use (checks localStorage); toggle button (⚙) in header to show/hide. Text settings + preview in `.controls-fixed` are always visible. Action buttons always visible at bottom.

## Constraints

- UI text, comments, and docs must be in **中文**
- Image output is hardcoded to **300x300px** — do not change
- Crop aspect ratio is hardcoded to **1:1** — do not change
- External dependency (Cropper.js 1.5.13) loaded via CDN — no package manager
- No build, lint, or test commands exist; changes are live-reloaded by Eagle

## Release Workflow

发布新版本的完整流程：

1. **提交代码** — 确保所有改动已 commit 并 push 到 GitHub
   ```bash
   git add -A
   git commit -m "vX.Y.Z: 版本说明"
   git push
   ```

2. **打包插件文件** — 将以下 5 个必需文件打成 zip：
   - `manifest.json`、`index.html`、`logo.png`、`script.js`、`style.css`
   ```bash
   zip -j wechat-sticker-pro-vX.Y.Z.zip manifest.json index.html logo.png script.js style.css
   ```

3. **创建 Release** — 使用 `gh release create` 发布并上传附件
   ```bash
   gh release create vX.Y.Z wechat-sticker-pro-vX.Y.Z.zip \
     --title "vX.Y.Z" \
     --notes "版本说明"
   ```
