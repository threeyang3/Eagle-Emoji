const fs = require('fs');
const path = require('path');
const os = require('os');

let cropper = null;
let selectedItems = [];
let currentIndex = 0;
let textPos = { x: 0.5, y: 0.5 };
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

const elements = {
    image: document.getElementById('image-to-crop'),
    currentIndex: document.getElementById('current-index'),
    totalCount: document.getElementById('total-count'),
    format: document.getElementById('export-format'),
    deleteOriginal: document.getElementById('delete-original'),
    tags: document.getElementById('tags'),
    folderId: document.getElementById('folder-id'),
    prevBtn: document.getElementById('prev-btn'),
    nextBtn: document.getElementById('next-btn'),
    skipBtn: document.getElementById('skip-btn'),
    loadingOverlay: document.getElementById('loading-overlay'),
    settingsScroll: document.getElementById('settings-scroll'),
    settingsToggle: document.getElementById('settings-toggle'),
    rotateLeft: document.getElementById('rotate-left'),
    rotateRight: document.getElementById('rotate-right'),
    flipH: document.getElementById('flip-h'),
    previewImg: document.getElementById('preview-img'),
    textContent: document.getElementById('text-content'),
    textSize: document.getElementById('text-size'),
    textSizeValue: document.getElementById('text-size-value'),
    textColor: document.getElementById('text-color'),
    textStroke: document.getElementById('text-stroke'),
    textOverlay: document.getElementById('text-overlay'),
    thumbList: document.getElementById('thumb-list')
};

// 插件初始化
eagle.onPluginCreate(async (plugin) => {
    console.log('微信表情包大师插件已启动');

    const hasExistingSettings = loadSettings();

    if (hasExistingSettings) {
        elements.settingsScroll.classList.add('hidden-sidebar');
    }

    elements.settingsToggle.addEventListener('click', () => {
        elements.settingsScroll.classList.toggle('hidden-sidebar');
    });

    // 字号滑块实时显示数值 + 同步浮层样式
    elements.textSize.addEventListener('input', () => {
        elements.textSizeValue.textContent = elements.textSize.value;
        syncOverlayStyle();
    });

    // 颜色/描边变更时同步浮层样式
    elements.textColor.addEventListener('input', syncOverlayStyle);
    elements.textStroke.addEventListener('change', syncOverlayStyle);

    // 文字内容变更时更新浮层文字
    elements.textContent.addEventListener('input', () => {
        updateOverlayContent();
    });

    // 初始化拖拽
    initDrag();

    // 获取选中的项目
    selectedItems = await eagle.item.getSelected();

    if (selectedItems.length === 0) {
        alert('请先在 Eagle 中选择至少一张图片。');
        closeAndFocus();
        return;
    }

    elements.totalCount.textContent = selectedItems.length;
    renderThumbList();
    showItem(0);
});

// 显示指定索引的图片
function showItem(index) {
    if (index < 0 || index >= selectedItems.length) return;

    currentIndex = index;
    const item = selectedItems[currentIndex];

    elements.currentIndex.textContent = currentIndex + 1;
    elements.prevBtn.disabled = currentIndex === 0;
    elements.nextBtn.textContent = currentIndex === selectedItems.length - 1 ? '保存并完成' : '保存并下一个';

    updateThumbActive();

    if (cropper) {
        cropper.destroy();
    }

    const filePath = item.filePath.replace(/\\/g, '/');
    elements.image.src = `file:///${filePath.startsWith('/') ? '' : '/'}${filePath}`;

    elements.image.onload = () => {
        cropper = new Cropper(elements.image, {
            aspectRatio: 1 / 1,
            viewMode: 1,
            autoCropArea: 1,
            responsive: true,
            ready() {
                bindImageTools();
                syncOverlayStyle();
                updateOverlayContent();
                positionOverlay();
                updatePreview();
            },
            crop() {
                positionOverlay();
                updatePreview();
            }
        });
    };
}

// ===== 缩略图列表 =====

function renderThumbList() {
    const list = elements.thumbList;
    list.innerHTML = '';

    selectedItems.forEach((item, i) => {
        const div = document.createElement('div');
        div.className = 'thumb-item';
        div.dataset.index = i;

        const filePath = item.filePath.replace(/\\/g, '/');
        div.innerHTML = `
            <img src="file:///${filePath.startsWith('/') ? '' : '/'}${filePath}" alt="">
            <span class="thumb-index">${i + 1}</span>
        `;

        div.addEventListener('click', () => showItem(i));
        list.appendChild(div);
    });
}

function updateThumbActive() {
    const items = elements.thumbList.querySelectorAll('.thumb-item');
    items.forEach((el, i) => {
        el.classList.toggle('active', i === currentIndex);
    });
}

function markThumbDone(index) {
    const items = elements.thumbList.querySelectorAll('.thumb-item');
    if (items[index]) {
        items[index].classList.add('done');
    }
}

// "下一步"按钮点击处理
elements.nextBtn.onclick = async () => {
    showLoading(true);
    try {
        await processAndSave();

        if (currentIndex < selectedItems.length - 1) {
            showItem(currentIndex + 1);
        } else {
            alert('所有表情包处理完成！');
            await closeAndFocus();
        }
    } catch (err) {
        console.error(err);
        alert('处理图片时出错: ' + err.message);
    } finally {
        showLoading(false);
    }
};

// "上一步"按钮点击处理
elements.prevBtn.onclick = () => {
    showItem(currentIndex - 1);
};

// "跳过"按钮点击处理
elements.skipBtn.onclick = () => {
    if (currentIndex < selectedItems.length - 1) {
        showItem(currentIndex + 1);
    } else {
        closeAndFocus();
    }
};

// 处理并保存当前图片
async function processAndSave() {
    if (!cropper) return;

    const canvas = cropper.getCroppedCanvas({
        width: 300,
        height: 300,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
    });

    drawTextOnCanvas(canvas);

    const format = elements.format.value;
    const extension = format === 'image/png' ? 'png' : 'jpg';
    const quality = format === 'image/jpeg' ? 0.8 : undefined;

    const dataUrl = canvas.toDataURL(format, quality);
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');

    const tempFileName = `sticker_${Date.now()}.${extension}`;
    const tempFilePath = path.join(os.tmpdir(), tempFileName);
    fs.writeFileSync(tempFilePath, buffer);

    const tagsInput = elements.tags.value.split(',').map(t => t.trim()).filter(t => t);
    const folderId = elements.folderId.value.trim();
    const originalItem = selectedItems[currentIndex];

    const options = {
        name: originalItem.name + "_表情包",
        tags: tagsInput,
    };

    if (folderId) {
        options.folderId = folderId;
    }

    await eagle.item.addFromPath(tempFilePath, options);

    try { fs.unlinkSync(tempFilePath); } catch {}

    if (elements.deleteOriginal.checked) {
        await eagle.item.moveToTrash([originalItem.id]);
    }

    saveSettings();
    markThumbDone(currentIndex);
}

// 绑定旋转/翻转按钮事件
function bindImageTools() {
    elements.rotateLeft.onclick = () => cropper.rotate(-90);
    elements.rotateRight.onclick = () => cropper.rotate(90);
    elements.flipH.onclick = () => {
        const data = cropper.getData();
        cropper.scaleX(data.scaleX === -1 ? 1 : -1);
    };
}

// 在 Canvas 上绘制文字
function drawTextOnCanvas(canvas) {
    const text = elements.textContent.value.trim();
    if (!text) return;

    const ctx = canvas.getContext('2d');
    const fontSize = parseInt(elements.textSize.value, 10);
    const color = elements.textColor.value;
    const stroke = elements.textStroke.checked;

    ctx.font = `bold ${fontSize}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const x = textPos.x * canvas.width;
    const y = textPos.y * canvas.height;

    if (stroke) {
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#000';
        ctx.strokeText(text, x, y);
    }

    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
}

// 更新输出预览（防抖）
let previewTimer = null;
function updatePreview() {
    if (!cropper) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
        const canvas = cropper.getCroppedCanvas({
            width: 300,
            height: 300,
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
        });
        drawTextOnCanvas(canvas);
        elements.previewImg.src = canvas.toDataURL('image/png');
    }, 80);
}

// 显示/隐藏加载遮罩
function showLoading(show) {
    if (show) {
        elements.loadingOverlay.classList.remove('hidden');
    } else {
        elements.loadingOverlay.classList.add('hidden');
    }
}

// 保存用户偏好设置到本地存储
function saveSettings() {
    const settings = {
        format: elements.format.value,
        deleteOriginal: elements.deleteOriginal.checked,
        tags: elements.tags.value,
        folderId: elements.folderId.value,
        textContent: elements.textContent.value,
        textSize: elements.textSize.value,
        textColor: elements.textColor.value,
        textStroke: elements.textStroke.checked,
        textPos: { x: textPos.x, y: textPos.y }
    };
    localStorage.setItem('wechat_sticker_settings', JSON.stringify(settings));
}

// 从本地存储加载设置，返回是否有已保存的设置
function loadSettings() {
    const saved = localStorage.getItem('wechat_sticker_settings');
    if (!saved) return false;

    try {
        const settings = JSON.parse(saved);
        elements.format.value = settings.format || 'image/png';
        elements.deleteOriginal.checked = settings.deleteOriginal || false;
        elements.tags.value = settings.tags || '';
        elements.folderId.value = settings.folderId || '';
        elements.textContent.value = settings.textContent || '';
        elements.textSize.value = settings.textSize || 28;
        elements.textSizeValue.textContent = elements.textSize.value;
        elements.textColor.value = settings.textColor || '#ffffff';
        elements.textStroke.checked = settings.textStroke !== undefined ? settings.textStroke : true;
        if (settings.textPos) {
            textPos.x = settings.textPos.x;
            textPos.y = settings.textPos.y;
        }
        return true;
    } catch {
        return false;
    }
}

// ===== 可拖拽文字浮层 =====

function initDrag() {
    const overlay = elements.textOverlay;
    const panel = document.querySelector('.image-panel');

    overlay.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;
        const rect = overlay.getBoundingClientRect();
        dragOffset.x = e.clientX - rect.left - rect.width / 2;
        dragOffset.y = e.clientY - rect.top - rect.height / 2;
        overlay.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const panelRect = panel.getBoundingClientRect();
        let x = e.clientX - panelRect.left;
        let y = e.clientY - panelRect.top;

        // 约束在面板范围内
        x = Math.max(0, Math.min(panelRect.width, x));
        y = Math.max(0, Math.min(panelRect.height, y));

        // 转换为相对坐标 0~1
        textPos.x = x / panelRect.width;
        textPos.y = y / panelRect.height;

        overlay.style.left = x + 'px';
        overlay.style.top = y + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (isDragging) {
            isDragging = false;
            elements.textOverlay.style.cursor = 'move';
        }
    });
}

// 根据 textPos 和裁剪区域定位浮层
function positionOverlay() {
    const overlay = elements.textOverlay;
    const text = elements.textContent.value.trim();

    if (!text || !cropper) {
        overlay.classList.add('hidden');
        return;
    }

    overlay.classList.remove('hidden');

    const panel = document.querySelector('.image-panel');
    const panelRect = panel.getBoundingClientRect();
    const cropBox = cropper.getCropBoxData();

    // 裁剪框相对于面板的位置
    const cropLeft = cropBox.left;
    const cropTop = cropBox.top;
    const cropWidth = cropBox.width;
    const cropHeight = cropBox.height;

    // 浮层位置 = 裁剪框左上角 + 相对坐标 * 裁剪框尺寸
    const x = cropLeft + textPos.x * cropWidth;
    const y = cropTop + textPos.y * cropHeight;

    overlay.style.left = x + 'px';
    overlay.style.top = y + 'px';
}

// 同步浮层样式（字号、颜色、描边）
function syncOverlayStyle() {
    const overlay = elements.textOverlay;
    const fontSize = elements.textSize.value;
    const color = elements.textColor.value;
    const stroke = elements.textStroke.checked;

    overlay.style.fontSize = fontSize + 'px';
    overlay.style.color = color;

    if (stroke) {
        overlay.style.textShadow = '2px 2px 4px rgba(0,0,0,0.8)';
    } else {
        overlay.style.textShadow = 'none';
    }
}

// 更新浮层文字内容
function updateOverlayContent() {
    const overlay = elements.textOverlay;
    const text = elements.textContent.value.trim();

    if (text) {
        overlay.textContent = text;
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }
}

// ===== 窗口关闭聚焦 =====

async function closeAndFocus() {
    try {
        if (eagle.mainWindow && eagle.mainWindow.focus) {
            eagle.mainWindow.focus();
        }
        const folderId = elements.folderId.value.trim();
        if (folderId && eagle.folder && eagle.folder.open) {
            await eagle.folder.open(folderId);
        }
    } catch (e) {
        console.warn('聚焦 Eagle 失败:', e);
    }
    window.close();
}
