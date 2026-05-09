# WeChat Sticker Pro (微信表情包大师) - Project Instructions

## 概述
这是一个为 Eagle 设计的窗口插件，旨在快速将选中的图片处理为符合微信规范的表情包。

## 技术栈
- **UI**: 原生 HTML/CSS (WeChat Green 风格)。
- **核心库**: [Cropper.js](https://github.com/fengyuanchen/cropperjs) (裁剪)。
- **逻辑**: JavaScript (Canvas API 处理图像，Node.js `fs` 处理文件)。
- **API**: [Eagle Plugin API](https://developer.eagle.cool/plugin-api)。

## 规范与红线
- **语言**: UI、注释和文档必须使用 **中文**。
- **图像尺寸**: 强制导出为 **300x300px**。
- **裁剪比例**: 强制锁定为 **1:1**。
- **依赖**: 优先使用 CDN 链接（目前使用 cdnjs），如需离线化需另行说明。

## 常用命令与路径
- **插件入口**: `index.html`
- **配置文件**: `manifest.json`
- **逻辑脚本**: `script.js`
- **样式表**: `style.css`

## 已知局限
- 目前使用 `file://` 协议加载本地图片，需确保 Eagle 权限允许。
- 批量处理依赖于 `eagle.item.getSelected()` 的初始列表。
