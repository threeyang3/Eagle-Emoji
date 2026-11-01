const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const errors = [];
function assert(condition, message) { if (!condition) errors.push(message); }

let manifest;
try { manifest = JSON.parse(read('manifest.json')); }
catch (error) { errors.push('manifest.json 不是有效 JSON：' + error.message); }

try {
  new vm.Script(read('script.js'), { filename: 'script.js' });
  new vm.Script(read('vendor/cropperjs/cropper.min.js'), { filename: 'cropper.min.js' });
} catch (error) { errors.push('JavaScript 语法错误：' + error.message); }

const html = read('index.html');
const js = read('script.js');
const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
const referencedIds = [...js.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]);
for (const id of referencedIds) assert(ids.has(id), 'script.js 引用了不存在的 DOM id：' + id);

assert(manifest && manifest.version === '1.3.0', 'manifest 版本应为 1.3.0');
assert(manifest && manifest.main && manifest.main.url === 'index.html', 'manifest 主入口应为 index.html');
assert(html.includes('vendor/cropperjs/cropper.min.css'), 'HTML 应加载本地 Cropper.js CSS');
assert(html.includes('vendor/cropperjs/cropper.min.js'), 'HTML 应加载本地 Cropper.js JS');
assert(fs.existsSync(path.join(root, 'vendor/cropperjs/cropper.min.css')), '缺少 Cropper.js CSS');
assert(fs.existsSync(path.join(root, 'vendor/cropperjs/cropper.min.js')), '缺少 Cropper.js JS');
assert(fs.existsSync(path.join(root, 'vendor/cropperjs/LICENSE')), '缺少 Cropper.js MIT License');
assert(!/cdnjs|jsdelivr|unpkg/.test(html), '运行界面不应依赖外部 CDN');
assert(js.includes('const OUTPUT_SIZE = 300'), '导出尺寸必须保持 300 × 300');
assert(js.includes('aspectRatio:1'), '裁剪比例必须保持 1:1');
assert(js.includes('function addTextLayer'), '缺少多文字图层功能');
assert(js.includes('function saveCurrentTemplate'), '缺少文字样式模板保存功能');
assert(js.includes('function applySelectedTemplate'), '缺少文字样式模板应用功能');
assert(js.includes('encodeWithSizeLimit'), '缺少导出文件大小限制');
assert(html.includes('id="max-file-size"'), '缺少最大文件大小设置控件');
assert(js.includes('await eagle.item.addFromPath(tempFilePath,options)'), '缺少 Eagle 导入流程');
assert(js.indexOf('await eagle.item.addFromPath(tempFilePath,options)') < js.indexOf('await eagle.item.moveToTrash([originalItem.id])'), '原图回收站操作必须在导入成功之后');

if (errors.length) {
  console.error('检查失败：');
  errors.forEach((error) => console.error(' - ' + error));
  process.exitCode = 1;
} else {
  console.log('检查通过：manifest、JS 语法、DOM 引用、本地依赖、多文字图层、模板、文件大小限制及原图保护约束均符合预期。');
}
