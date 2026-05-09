# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

微信表情包大师 (WeChat Sticker Pro) — an Eagle plugin that batch-processes images into WeChat-compliant stickers (300x300px, 1:1 crop). No build system; plain HTML/CSS/JS loaded directly by Eagle.

## Architecture

- `manifest.json` — Eagle plugin config (entry point, window size, plugin ID)
- `index.html` — UI shell; loads Cropper.js from cdnjs CDN
- `script.js` — all logic: Eagle API integration, Cropper.js lifecycle, Canvas-based image processing, batch queue, localStorage settings persistence
- `style.css` — WeChat-green themed UI

The flow: Eagle launches plugin → `eagle.onPluginCreate` grabs selected items → user crops each image with Cropper.js (locked 1:1) → `getCroppedCanvas` renders to 300x300 → buffer written to temp file → `eagle.item.addFromPath` imports back into Eagle.

## Key Technical Details

- **Eagle Plugin API**: `eagle.onPluginCreate` for init, `eagle.item.getSelected()` for batch input, `eagle.item.addFromPath()` for save, `eagle.item.moveToTrash()` for optional delete
- **Image loading**: uses `file://` protocol on `item.filePath` — requires Eagle permission
- **Cropper.js**: locked `aspectRatio: 1/1`, `viewMode: 1`, `autoCropArea: 1`. Also uses `rotate()`, `scaleX()` for flip, and `crop` event for live preview
- **Output**: always 300x300px; JPG at quality 0.8 or PNG lossless
- **Settings persistence**: `localStorage` key `wechat_sticker_settings` (format, tags, folder ID, delete-original, text content/size/color/position/stroke)
- **Text overlay**: rendered via Canvas `fillText`/`strokeText` after cropping, before export. Font: bold Microsoft YaHei/PingFang SC
- **Settings panel**: hides after first use (checks localStorage); toggle button (⚙) in header to show/hide. Only settings scroll area hides — action buttons always visible

## Constraints

- UI text, comments, and docs must be in **中文**
- Image output is hardcoded to **300x300px** — do not change
- Crop aspect ratio is hardcoded to **1:1** — do not change
- External dependency (Cropper.js 1.5.13) loaded via CDN — no package manager
- No build, lint, or test commands exist; changes are live-reloaded by Eagle

## Release Workflow

发布新版本时，使用 `gh release create` 创建 GitHub Release，将以下插件必需文件打包为 zip 附件：

```
manifest.json
index.html
logo.png
script.js
style.css
```

发布命令示例：
```bash
# 打包插件文件
zip -j wechat-sticker-pro-vX.Y.Z.zip manifest.json index.html logo.png script.js style.css

# 创建 release 并上传附件
gh release create vX.Y.Z wechat-sticker-pro-vX.Y.Z.zip \
  --title "vX.Y.Z" \
  --notes "版本说明"
```
