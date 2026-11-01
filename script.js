const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const SETTINGS_KEY = 'wechat_sticker_settings';
const OUTPUT_SIZE = 300;
let cropper = null, selectedItems = [], currentIndex = 0;
let textPos = { x: 0.5, y: 0.82 }, isDragging = false, dragPointerId = null;
let dragOffset = { x: 0, y: 0 }, previewTimer = null, loadToken = 0, isProcessing = false;
const completedIndexes = new Set();
const itemEdits = new Map();
let activeItemIndex = -1;
const $ = (id) => document.getElementById(id);
const elements = {
 image:$('image-to-crop'), currentIndex:$('current-index'), totalCount:$('total-count'),
 format:$('export-format'), deleteOriginal:$('delete-original'), tags:$('tags'), folderId:$('folder-id'),
 prevBtn:$('prev-btn'), nextBtn:$('next-btn'), skipBtn:$('skip-btn'), loadingOverlay:$('loading-overlay'),
 settingsScroll:$('settings-scroll'), settingsToggle:$('settings-toggle'), rotateLeft:$('rotate-left'),
 rotateRight:$('rotate-right'), flipH:$('flip-h'), previewImg:$('preview-img'), textContent:$('text-content'),
 textSize:$('text-size'), textSizeValue:$('text-size-value'), textColor:$('text-color'),
 textStroke:$('text-stroke'), textOverlay:$('text-overlay'), thumbList:$('thumb-list'),
 fontFamily:$('font-family'), strokeWidth:$('stroke-width'), strokeWidthValue:$('stroke-width-value'),
 textBackground:$('text-background'), textBackgroundColor:$('text-background-color'),
 jpegQuality:$('jpeg-quality'), jpegQualityValue:$('jpeg-quality-value'), qualityGroup:$('quality-group')
};

eagle.onPluginCreate(async () => {
 try {
  loadSettings(); bindControls(); initDrag();
  selectedItems = await eagle.item.getSelected();
  if (!Array.isArray(selectedItems) || !selectedItems.length) {
   alert('请先在 Eagle 中选择至少一张图片。'); await closeAndFocus(); return;
  }
  elements.totalCount.textContent = String(selectedItems.length);
  renderThumbList(); await showItem(0);
 } catch (error) {
  console.error('插件初始化失败：', error);
  alert('插件初始化失败：' + getErrorMessage(error));
 }
});

function bindControls() {
 elements.settingsToggle.addEventListener('click', () => { elements.settingsScroll.classList.toggle('hidden-sidebar'); saveSettings(); });
 elements.textSize.addEventListener('input', () => {
  elements.textSizeValue.textContent = elements.textSize.value;
  syncOverlayStyle(); updatePreview(); saveSettings();
 });
 [elements.textColor,elements.textStroke,elements.fontFamily,elements.strokeWidth,elements.textBackground,elements.textBackgroundColor,elements.jpegQuality].forEach(el => {
  el.addEventListener('input', () => { syncOverlayStyle(); updatePreview(); saveSettings(); });
  el.addEventListener('change', saveSettings);
 });
 elements.strokeWidth.addEventListener('input', () => { elements.strokeWidthValue.textContent=elements.strokeWidth.value; syncOverlayStyle(); updatePreview(); saveSettings(); });
 elements.jpegQuality.addEventListener('input', () => { elements.jpegQualityValue.textContent=elements.jpegQuality.value; updatePreview(); saveSettings(); });
 elements.format.addEventListener('change', updateQualityVisibility);
 updateQualityVisibility();
 elements.textContent.addEventListener('input', () => {
  updateOverlayContent(); positionOverlay(); updatePreview(); saveSettings();
 });
 [elements.format,elements.deleteOriginal,elements.tags,elements.folderId].forEach(el => {
  el.addEventListener('change', saveSettings); el.addEventListener('input', saveSettings);
 });
 elements.nextBtn.addEventListener('click', handleSaveAndNext);
 elements.prevBtn.addEventListener('click', () => showItem(currentIndex-1));
 elements.skipBtn.addEventListener('click', handleSkip);
 elements.rotateLeft.addEventListener('click', () => cropper && cropper.rotate(-90));
 elements.rotateRight.addEventListener('click', () => cropper && cropper.rotate(90));
 elements.flipH.addEventListener('click', () => {
  if (!cropper) return; const data=cropper.getData(); cropper.scaleX(data.scaleX===-1?1:-1);
 });
}

async function showItem(index, allowProcessing = false) {
 if ((isProcessing && !allowProcessing) || index<0 || index>=selectedItems.length) return;
 if(cropper && activeItemIndex>=0){try{itemEdits.set(activeItemIndex,cropper.getData());}catch(error){console.warn('保存当前裁剪状态失败：',error);}}
 currentIndex=index; const token=++loadToken; destroyCropper();
 elements.currentIndex.textContent=String(index+1);
 elements.prevBtn.disabled=index===0;
 elements.nextBtn.textContent=index===selectedItems.length-1?'保存并完成':'保存并下一个';
 updateThumbState();
 const item=selectedItems[index];
 if (!item || !item.filePath) throw new Error('无法读取当前图片的文件路径。');
 elements.image.onload=null; elements.image.onerror=null;
 const imageReady=waitForImage(elements.image, pathToFileURL(path.resolve(item.filePath)).href);
 try {
  await imageReady; if (token!==loadToken) return;
  cropper=new Cropper(elements.image,{
   aspectRatio:1,viewMode:1,autoCropArea:1,responsive:true,background:false,
   ready(){if(token!==loadToken)return;const savedEdit=itemEdits.get(index);if(savedEdit)cropper.setData(savedEdit);activeItemIndex=index;syncOverlayStyle();updateOverlayContent();positionOverlay();updatePreview();},
   crop(){if(token!==loadToken)return;positionOverlay();updatePreview();}
  });
 } catch(error) {
  if(token!==loadToken)return; console.error('图片加载失败：',error);
  alert('图片加载失败：'+getErrorMessage(error));
 }
}
function waitForImage(img, src) {
 return new Promise((resolve,reject)=>{
  img.onload=()=>{img.onload=null;img.onerror=null;resolve();};
  img.onerror=()=>{img.onload=null;img.onerror=null;reject(new Error('无法打开图片文件，请检查文件是否存在或可访问。'));};
  img.src=src;
  if(img.complete&&img.naturalWidth>0){img.onload=null;img.onerror=null;resolve();}
 });
}
function destroyCropper() {
 clearTimeout(previewTimer); if(cropper){cropper.destroy();cropper=null;}
 elements.previewImg.removeAttribute('src');
}
function renderThumbList() {
 elements.thumbList.replaceChildren();
 selectedItems.forEach((item,index)=>{
  const button=document.createElement('button'); button.type='button'; button.className='thumb-item';
  button.title=item.name||('图片 '+(index+1));
  const image=document.createElement('img'); image.alt=''; image.loading='lazy';
  image.src=pathToFileURL(path.resolve(item.filePath)).href;
  const label=document.createElement('span'); label.className='thumb-index'; label.textContent=String(index+1);
  button.append(image,label); button.addEventListener('click',()=>showItem(index)); elements.thumbList.appendChild(button);
 });
 updateThumbState();
}
function updateThumbState() {
 elements.thumbList.querySelectorAll('.thumb-item').forEach((item,index)=>{
  item.classList.toggle('active',index===currentIndex);
  item.classList.toggle('done',completedIndexes.has(index));
  item.setAttribute('aria-current',index===currentIndex?'true':'false');
 });
}
async function handleSaveAndNext() {
 if(isProcessing||!cropper)return; setProcessing(true);
 try {
  const saveResult=await processAndSave(); completedIndexes.add(currentIndex); updateThumbState();
  if(saveResult&&saveResult.warning)alert('表情包已成功导入，但原图未能移入回收站：'+saveResult.warning);
  if(currentIndex<selectedItems.length-1){await showItem(currentIndex+1,true);}
  else {alert('全部处理完成！成功处理 '+completedIndexes.size+' 张图片。');await closeAndFocus();}
 } catch(error) {
  console.error('保存失败：',error); alert('保存失败，原图未删除。\n'+getErrorMessage(error));
 } finally {setProcessing(false);}
}
async function handleSkip() {
 if(isProcessing)return;
 if(currentIndex<selectedItems.length-1)await showItem(currentIndex+1); else await closeAndFocus();
}
async function processAndSave() {
 if(!cropper)throw new Error('图片尚未准备好，请稍后重试。');
 const canvas=cropper.getCroppedCanvas({width:OUTPUT_SIZE,height:OUTPUT_SIZE,imageSmoothingEnabled:true,imageSmoothingQuality:'high'});
 if(!canvas)throw new Error('无法生成裁剪结果。');
 drawTextOnCanvas(canvas);
 const format=elements.format.value==='image/jpeg'?'image/jpeg':'image/png';
 const extension=format==='image/jpeg'?'jpg':'png';
 const buffer=await canvasToBuffer(canvas,format,format==='image/jpeg'?Number(elements.jpegQuality.value)/100:undefined);
 const tempFilePath=path.join(os.tmpdir(),'eagle-sticker-'+Date.now()+'-'+Math.random().toString(36).slice(2)+'.'+extension);
 const originalItem=selectedItems[currentIndex];
 try {
  await fs.promises.writeFile(tempFilePath,buffer);
  const options={name:(originalItem.name||'图片')+'_表情包',tags:elements.tags.value.split(/[,，]/).map(t=>t.trim()).filter(Boolean)};
  const folderId=elements.folderId.value.trim(); if(folderId)options.folderId=folderId;
  await eagle.item.addFromPath(tempFilePath,options);
  // addFromPath 成功完成后才允许将原图移入回收站。
  let warning=null;
  if(elements.deleteOriginal.checked){
   try{await eagle.item.moveToTrash([originalItem.id]);}
   catch(error){warning=getErrorMessage(error);console.warn('表情包已导入，但原图移入回收站失败：',error);}
  }
  saveSettings();
  return {warning};
 } finally {
  try{await fs.promises.unlink(tempFilePath);}catch(error){console.warn('临时文件清理失败：',error);}
 }
}
function canvasToBuffer(canvas,format,quality) {
 return new Promise((resolve,reject)=>{
  canvas.toBlob(blob=>{
   if(!blob)return reject(new Error('图片编码失败，请尝试更换导出格式。'));
   blob.arrayBuffer().then(data=>resolve(Buffer.from(data))).catch(reject);
  },format,quality);
 });
}
function drawTextOnCanvas(canvas) {
 const text=elements.textContent.value.trim(); if(!text)return;
 const ctx=canvas.getContext('2d'),fontSize=Number(elements.textSize.value)||28;
 const font=elements.fontFamily.value||'Microsoft YaHei';
 ctx.save();ctx.font='bold '+fontSize+'px "'+font+'", "PingFang SC", sans-serif';
 ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
 const x=clamp(textPos.x,0,1)*canvas.width,y=clamp(textPos.y,0,1)*canvas.height;
 const lines=wrapCanvasText(ctx,text,OUTPUT_SIZE-24),lineHeight=fontSize*1.2,startY=y-((lines.length-1)*lineHeight)/2;
 const metrics=lines.map(line=>ctx.measureText(line).width),padding=fontSize*0.28;
 if(elements.textBackground.checked){
  const boxWidth=Math.max(...metrics)+padding*2,boxHeight=lines.length*lineHeight+padding*2;
  ctx.fillStyle=elements.textBackgroundColor.value;
  ctx.fillRect(x-boxWidth/2,y-boxHeight/2,boxWidth,boxHeight);
 }
 lines.forEach((line,index)=>{
  const lineY=startY+index*lineHeight;
  if(elements.textStroke.checked&&Number(elements.strokeWidth.value)>0){ctx.lineWidth=Number(elements.strokeWidth.value);ctx.strokeStyle='#000';ctx.strokeText(line,x,lineY);}
  ctx.fillStyle=elements.textColor.value;ctx.fillText(line,x,lineY);
 });
 ctx.restore();
}
function wrapCanvasText(ctx,text,maxWidth) {
 const result=[];
 text.split(/\r?\n/).forEach(paragraph=>{
  if(!paragraph){result.push('');return;}
  let line='';
  for(const character of Array.from(paragraph)){
   const candidate=line+character;
   if(line&&ctx.measureText(candidate).width>maxWidth){result.push(line);line=character;}
   else line=candidate;
  }
  result.push(line);
 });
 return result;
}
function updatePreview() {
 if(!cropper)return;clearTimeout(previewTimer);
 previewTimer=setTimeout(()=>{
  if(!cropper)return;
  try{
   const canvas=cropper.getCroppedCanvas({width:OUTPUT_SIZE,height:OUTPUT_SIZE,imageSmoothingEnabled:true,imageSmoothingQuality:'high'});
   if(!canvas)return;drawTextOnCanvas(canvas);elements.previewImg.src=canvas.toDataURL('image/png');
  }catch(error){console.warn('预览更新失败：',error);}
 },80);
}
function setProcessing(processing) {
 isProcessing=processing;elements.loadingOverlay.classList.toggle('hidden',!processing);
 elements.nextBtn.disabled=processing;elements.prevBtn.disabled=processing||currentIndex===0;
 elements.skipBtn.disabled=processing;elements.settingsToggle.disabled=processing;
 elements.thumbList.querySelectorAll('button').forEach(button=>button.disabled=processing);
}
function saveSettings() {
 const settings={
  format:elements.format.value,deleteOriginal:elements.deleteOriginal.checked,tags:elements.tags.value,
  folderId:elements.folderId.value,textContent:elements.textContent.value,textSize:elements.textSize.value,
  textColor:elements.textColor.value,textStroke:elements.textStroke.checked,
  fontFamily:elements.fontFamily.value,strokeWidth:elements.strokeWidth.value,
  textBackground:elements.textBackground.checked,textBackgroundColor:elements.textBackgroundColor.value,
  jpegQuality:elements.jpegQuality.value,
  textPos:{x:textPos.x,y:textPos.y},settingsVisible:!elements.settingsScroll.classList.contains('hidden-sidebar')
 };
 try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}catch(error){console.warn('保存设置失败：',error);}
}
function loadSettings() {
 try{
  const raw=localStorage.getItem(SETTINGS_KEY);if(!raw)return;const s=JSON.parse(raw);
  elements.format.value=s.format==='image/jpeg'?'image/jpeg':'image/png';
  elements.deleteOriginal.checked=s.deleteOriginal===true;elements.tags.value=s.tags||'';
  elements.folderId.value=s.folderId||'';elements.textContent.value=s.textContent||'';
  elements.textSize.value=String(clamp(Number(s.textSize)||28,12,72));elements.textSizeValue.textContent=elements.textSize.value;
  elements.textColor.value=/^#[0-9a-f]{6}$/i.test(s.textColor||'')?s.textColor:'#ffffff';
  elements.textStroke.checked=s.textStroke!==false;
  elements.fontFamily.value=['Microsoft YaHei','Arial','serif','sans-serif'].includes(s.fontFamily)?s.fontFamily:'Microsoft YaHei';
  elements.strokeWidth.value=String(clamp(Number(s.strokeWidth??3),0,12));elements.strokeWidthValue.textContent=elements.strokeWidth.value;
  elements.textBackground.checked=s.textBackground===true;
  elements.textBackgroundColor.value=/^#[0-9a-f]{6}$/i.test(s.textBackgroundColor||'')?s.textBackgroundColor:'#000000';
  elements.jpegQuality.value=String(clamp(Number(s.jpegQuality)||90,40,100));elements.jpegQualityValue.textContent=elements.jpegQuality.value;
  if(s.textPos&&Number.isFinite(s.textPos.x)&&Number.isFinite(s.textPos.y))
   textPos={x:clamp(s.textPos.x,0,1),y:clamp(s.textPos.y,0,1)};
  elements.settingsScroll.classList.toggle('hidden-sidebar',s.settingsVisible!==true);
 }catch(error){console.warn('读取设置失败，将使用默认设置：',error);}
}
function initDrag() {
 const overlay=elements.textOverlay,panel=document.querySelector('.image-panel');
 overlay.addEventListener('pointerdown',event=>{
  if(!cropper)return;event.preventDefault();isDragging=true;dragPointerId=event.pointerId;
  overlay.setPointerCapture(event.pointerId);const rect=overlay.getBoundingClientRect();
  dragOffset={x:event.clientX-(rect.left+rect.width/2),y:event.clientY-(rect.top+rect.height/2)};
  overlay.style.cursor='grabbing';
 });
 overlay.addEventListener('pointermove',event=>{
  if(!isDragging||event.pointerId!==dragPointerId||!cropper)return;
  const panelRect=panel.getBoundingClientRect(),box=getCropBoxInPanel(panel);
  const cx=event.clientX-panelRect.left-dragOffset.x,cy=event.clientY-panelRect.top-dragOffset.y;
  textPos={x:clamp((cx-box.left)/box.width,0,1),y:clamp((cy-box.top)/box.height,0,1)};
  positionOverlay();updatePreview();
 });
 const stop=event=>{
  if(!isDragging||(event&&event.pointerId!==dragPointerId))return;
  isDragging=false;dragPointerId=null;overlay.style.cursor='move';saveSettings();
 };
 overlay.addEventListener('pointerup',stop);overlay.addEventListener('pointercancel',stop);
 overlay.addEventListener('lostpointercapture',stop);
}
function getCropBoxInPanel(panel) {
 const box=cropper.getCropBoxData();
 const containerRect=elements.image.parentElement.getBoundingClientRect();
 const panelRect=panel.getBoundingClientRect();
 return {left:containerRect.left-panelRect.left+box.left,top:containerRect.top-panelRect.top+box.top,width:box.width,height:box.height};
}
function positionOverlay() {
 const overlay=elements.textOverlay;
 if(!elements.textContent.value.trim()||!cropper){overlay.classList.add('hidden');return;}
 const panel=document.querySelector('.image-panel'),box=getCropBoxInPanel(panel);
 overlay.classList.remove('hidden');
 overlay.style.left=(box.left+textPos.x*box.width)+'px';
 overlay.style.top=(box.top+textPos.y*box.height)+'px';
 const scale=box.width/OUTPUT_SIZE;
 overlay.style.fontSize=(Number(elements.textSize.value)*scale)+'px';
 overlay.style.padding=(Number(elements.textSize.value)*0.28*scale)+'px '+(Number(elements.textSize.value)*0.28*scale)+'px';
 overlay.style.maxWidth=(box.width*0.92)+'px';
 overlay.style.webkitTextStroke=elements.textStroke.checked?(Number(elements.strokeWidth.value)*scale+'px #000'):'0 transparent';
}
function syncOverlayStyle() {
 elements.textOverlay.style.color=elements.textColor.value;
 elements.textOverlay.style.fontFamily=elements.fontFamily.value;
 elements.textOverlay.style.webkitTextStroke=elements.textStroke.checked?(Number(elements.strokeWidth.value)+'px #000'):'0 transparent';
 elements.textOverlay.style.background=elements.textBackground.checked?elements.textBackgroundColor.value:'transparent';
 elements.textOverlay.style.textShadow='none';
 positionOverlay();
}
function updateOverlayContent() {
 const text=elements.textContent.value.trim();elements.textOverlay.textContent=text;
 elements.textOverlay.classList.toggle('hidden',!text);
}
function updateQualityVisibility(){elements.qualityGroup.classList.toggle('hidden-control',elements.format.value!=='image/jpeg');}
function clamp(value,min,max){return Math.min(max,Math.max(min,value));}
function getErrorMessage(error){return error&&error.message?error.message:String(error||'未知错误');}
async function closeAndFocus() {
 try{
  if(eagle.mainWindow&&typeof eagle.mainWindow.focus==='function')eagle.mainWindow.focus();
  const folderId=elements.folderId.value.trim();
  if(folderId&&eagle.folder&&typeof eagle.folder.open==='function')await eagle.folder.open(folderId);
 }catch(error){console.warn('聚焦 Eagle 或打开文件夹失败：',error);}
 window.close();
}
