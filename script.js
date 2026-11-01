const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const SETTINGS_KEY = 'wechat_sticker_settings';
const DEFAULT_TEXT_LAYER = {text:'',x:0.5,y:0.82,size:28,color:'#ffffff',fontFamily:'Microsoft YaHei',stroke:true,strokeWidth:3,background:false,backgroundColor:'#000000'};
const OUTPUT_SIZE = 300;
let cropper = null, selectedItems = [], currentIndex = 0;
let textPos = { x: 0.5, y: 0.82 }, isDragging = false, dragPointerId = null;
let dragOffset = { x: 0, y: 0 }, previewTimer = null, loadToken = 0, isProcessing = false;
const completedIndexes = new Set();
const itemEdits = new Map();
let activeItemIndex = -1;
let textLayers = [];
let activeLayerId = null;
let templates = [];
let dragLayerId = null;
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
 jpegQuality:$('jpeg-quality'), jpegQualityValue:$('jpeg-quality-value'), qualityGroup:$('quality-group'), maxFileSize:$('max-file-size'), maxFileSizeValue:$('max-file-size-value'),
 layerList:$('text-layer-list'), addLayer:$('add-text-layer'), deleteLayer:$('delete-text-layer'),
 templateSelect:$('text-template'), saveTemplate:$('save-template'), applyTemplate:$('apply-template'), deleteTemplate:$('delete-template')
};

eagle.onPluginCreate(async () => {
 try {
  loadSettings(); loadTemplates(); bindControls(); initDrag();
  renderLayerList(); syncLayerControls();
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
 elements.addLayer.addEventListener('click', addTextLayer);
 elements.deleteLayer.addEventListener('click', deleteActiveLayer);
 elements.saveTemplate.addEventListener('click', saveCurrentTemplate);
 elements.applyTemplate.addEventListener('click', applySelectedTemplate);
 elements.deleteTemplate.addEventListener('click', deleteSelectedTemplate);
 elements.maxFileSize.addEventListener('input', () => { elements.maxFileSizeValue.textContent=elements.maxFileSize.value; saveSettings(); });
 elements.textSize.addEventListener('input', () => {
  elements.textSizeValue.textContent = elements.textSize.value;
  readStyleControls(); syncOverlayStyle(); updatePreview(); saveSettings();
 });
 [elements.textColor,elements.textStroke,elements.fontFamily,elements.strokeWidth,elements.textBackground,elements.textBackgroundColor,elements.jpegQuality].forEach(el => {
  el.addEventListener('input', () => { readStyleControls(); syncOverlayStyle(); updatePreview(); saveSettings(); });
  el.addEventListener('change', saveSettings);
 });
 elements.strokeWidth.addEventListener('input', () => { elements.strokeWidthValue.textContent=elements.strokeWidth.value; readStyleControls(); syncOverlayStyle(); updatePreview(); saveSettings(); });
 elements.jpegQuality.addEventListener('input', () => { elements.jpegQualityValue.textContent=elements.jpegQuality.value; updatePreview(); saveSettings(); });
 elements.format.addEventListener('change', updateQualityVisibility);
 updateQualityVisibility();
 elements.textContent.addEventListener('input', () => {
  const layer=getActiveLayer(); if(!layer)return; layer.text=elements.textContent.value;
  updateOverlayContent(); renderLayerList(); updatePreview(); saveSettings();
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


function getActiveLayer() { return textLayers.find(layer=>layer.id===activeLayerId)||null; }
function createLayerId() { return 'layer-'+Date.now()+'-'+Math.random().toString(36).slice(2,7); }
function addTextLayer() {
 const layer={id:createLayerId(),text:'新文字',x:0.5,y:0.5,size:28,color:'#ffffff',fontFamily:'Microsoft YaHei',stroke:true,strokeWidth:3,background:false,backgroundColor:'#000000'};
 textLayers.push(layer);activeLayerId=layer.id;renderLayerList();syncLayerControls();positionOverlay();updatePreview();saveSettings();
}
function deleteActiveLayer() {
 if(!activeLayerId)return;textLayers=textLayers.filter(layer=>layer.id!==activeLayerId);
 activeLayerId=textLayers.length?textLayers[textLayers.length-1].id:null;
 renderLayerList();syncLayerControls();positionOverlay();updatePreview();saveSettings();
}
function selectLayer(id) {
 if(!textLayers.some(layer=>layer.id===id))return;activeLayerId=id;renderLayerList();syncLayerControls();positionOverlay();
}
function renderLayerList() {
 elements.layerList.replaceChildren();
 textLayers.forEach((layer,index)=>{
  const button=document.createElement('button');button.type='button';
  button.className='layer-list-item'+(layer.id===activeLayerId?' active':'');
  button.textContent=(index+1)+'. '+(layer.text.trim()||'（空文字图层）');
  button.addEventListener('click',()=>selectLayer(layer.id));elements.layerList.appendChild(button);
 });
 elements.deleteLayer.disabled=!activeLayerId||isProcessing;
}
function syncLayerControls() {
 const layer=getActiveLayer();
 [elements.textContent,elements.textSize,elements.textColor,elements.textStroke,elements.fontFamily,elements.strokeWidth,elements.textBackground,elements.textBackgroundColor].forEach(el=>el.disabled=!layer||isProcessing);
 if(!layer){elements.textContent.value='';return;}
 elements.textContent.value=layer.text;elements.textSize.value=layer.size;elements.textSizeValue.textContent=layer.size;
 elements.textColor.value=layer.color;elements.textStroke.checked=layer.stroke;elements.fontFamily.value=layer.fontFamily;
 elements.strokeWidth.value=layer.strokeWidth;elements.strokeWidthValue.textContent=layer.strokeWidth;
 elements.textBackground.checked=layer.background;elements.textBackgroundColor.value=layer.backgroundColor;
}
function readStyleControls() {
 const layer=getActiveLayer();if(!layer)return;
 layer.size=clamp(Number(elements.textSize.value)||28,12,96);layer.color=elements.textColor.value;
 layer.stroke=elements.textStroke.checked;layer.fontFamily=['Microsoft YaHei','Arial','serif','sans-serif'].includes(elements.fontFamily.value)?elements.fontFamily.value:'Microsoft YaHei';
 layer.strokeWidth=clamp(Number(elements.strokeWidth.value)||0,0,12);layer.background=elements.textBackground.checked;
 layer.backgroundColor=elements.textBackgroundColor.value;
}
function saveCurrentTemplate() {
 const layer=getActiveLayer();if(!layer){alert('请先添加或选择一个文字图层。');return;}
 const name=prompt('为当前文字样式模板命名：');if(!name||!name.trim())return;
 templates.push({id:createLayerId(),name:name.trim(),style:{size:layer.size,color:layer.color,fontFamily:layer.fontFamily,stroke:layer.stroke,strokeWidth:layer.strokeWidth,background:layer.background,backgroundColor:layer.backgroundColor}});
 persistTemplates();renderTemplateOptions();
}
function deleteSelectedTemplate() {
 const id=elements.templateSelect.value;if(!id)return;
 templates=templates.filter(template=>template.id!==id);persistTemplates();renderTemplateOptions();
}
function applySelectedTemplate() {
 const template=templates.find(item=>item.id===elements.templateSelect.value),layer=getActiveLayer();
 if(!template||!layer){alert('请选择模板并选中一个文字图层。');return;}
 Object.assign(layer,template.style);syncLayerControls();positionOverlay();updatePreview();saveSettings();
}
function loadTemplates() {
 try{const saved=JSON.parse(localStorage.getItem('wechat_sticker_templates')||'[]');templates=Array.isArray(saved)?saved.filter(item=>item&&item.id&&item.name&&item.style):[];}
 catch(error){templates=[];console.warn('读取文字模板失败：',error);}
 renderTemplateOptions();
}
function persistTemplates() {
 try{localStorage.setItem('wechat_sticker_templates',JSON.stringify(templates));}
 catch(error){alert('模板保存失败：'+getErrorMessage(error));}
}
function renderTemplateOptions() {
 const selected=elements.templateSelect.value;elements.templateSelect.replaceChildren();
 const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='选择样式模板';elements.templateSelect.appendChild(placeholder);
 templates.forEach(template=>{const option=document.createElement('option');option.value=template.id;option.textContent=template.name;elements.templateSelect.appendChild(option);});
 if(templates.some(item=>item.id===selected))elements.templateSelect.value=selected;
}

async function showItem(index, allowProcessing = false) {
 if ((isProcessing && !allowProcessing) || index<0 || index>=selectedItems.length) return;
 if(cropper && activeItemIndex>=0){try{itemEdits.set(activeItemIndex,cropper.getData());}catch(error){console.warn('保存当前裁剪状态失败：',error);}}
 currentIndex=index; const token=++loadToken; destroyCropper();
 elements.nextBtn.disabled=true;
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
   ready(){if(token!==loadToken)return;const savedEdit=itemEdits.get(index);if(savedEdit)cropper.setData(savedEdit);activeItemIndex=index;elements.nextBtn.disabled=isProcessing;syncLayerControls();renderLayerList();positionOverlay();updatePreview();},
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
 const format=elements.format.value==='image/jpeg'?'image/jpeg':'image/png';
 drawTextOnCanvas(canvas,format==='image/jpeg'?'#ffffff':null);
 const extension=format==='image/jpeg'?'jpg':'png';
 const maxBytes=Number(elements.maxFileSize.value)*1024;
 const encoded=await encodeWithSizeLimit(canvas,format,maxBytes);
 const buffer=encoded.buffer;
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
async function encodeWithSizeLimit(canvas,format,maxBytes) {
 let quality=Number(elements.jpegQuality.value)/100;
 let buffer=await canvasToBuffer(canvas,format,format==='image/jpeg'?quality:undefined);
 while(format==='image/jpeg'&&buffer.length>maxBytes&&quality>0.4){
  quality=Math.max(0.4,Math.round((quality-0.05)*100)/100);
  buffer=await canvasToBuffer(canvas,format,quality);
 }
 if(buffer.length>maxBytes){
  const actual=(buffer.length/1024).toFixed(1),limit=(maxBytes/1024).toFixed(0);
  throw new Error('导出文件为 '+actual+' KB，超过设定上限 '+limit+' KB。请提高文件大小上限、降低 JPG 质量或更换格式。');
 }
 return {buffer,quality};
}
function canvasToBuffer(canvas,format,quality) {
 return new Promise((resolve,reject)=>{
  canvas.toBlob(blob=>{
   if(!blob)return reject(new Error('图片编码失败，请尝试更换导出格式。'));
   blob.arrayBuffer().then(data=>resolve(Buffer.from(data))).catch(reject);
  },format,quality);
 });
}
function drawTextOnCanvas(canvas, matteColor=null) {
 const ctx=canvas.getContext('2d');
 if(matteColor){ctx.save();ctx.fillStyle=matteColor;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.restore();}
 textLayers.forEach(layer=>{
  if(!layer.text.trim())return;
  const size=Number(layer.size)||28,font=layer.fontFamily||'Microsoft YaHei';
  const family=['serif','sans-serif'].includes(font)?font:'"'+font+'"';
  ctx.save();ctx.font='bold '+size+'px '+family+', "PingFang SC", sans-serif';
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
  const x=clamp(layer.x,0,1)*canvas.width,y=clamp(layer.y,0,1)*canvas.height;
  const lines=wrapCanvasText(ctx,layer.text,OUTPUT_SIZE-24,size);
  const lineHeight=size*1.2,startY=y-((lines.length-1)*lineHeight)/2;
  const widths=lines.map(line=>ctx.measureText(line).width),padding=size*0.28;
  if(layer.background){
   const width=Math.min(OUTPUT_SIZE-8,Math.max(...widths)+padding*2);
   const height=lines.length*lineHeight+padding*2;
   ctx.fillStyle=layer.backgroundColor;ctx.fillRect(x-width/2,y-height/2,width,height);
  }
  lines.forEach((line,index)=>{
   const lineY=startY+index*lineHeight;
   if(layer.stroke&&Number(layer.strokeWidth)>0){
    ctx.lineWidth=Number(layer.strokeWidth);ctx.strokeStyle='#000000';ctx.strokeText(line,x,lineY);
   }
   ctx.fillStyle=layer.color;ctx.fillText(line,x,lineY);
  });
  ctx.restore();
 });
}
function wrapCanvasText(ctx,text,maxWidth,fontSize=28) {
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
   if(!canvas)return;drawTextOnCanvas(canvas,elements.format.value==='image/jpeg'?'#ffffff':null);elements.previewImg.src=canvas.toDataURL('image/png');
  }catch(error){console.warn('预览更新失败：',error);}
 },80);
}
function setProcessing(processing) {
 isProcessing=processing;elements.loadingOverlay.classList.toggle('hidden',!processing);
 elements.nextBtn.disabled=processing||!cropper;elements.prevBtn.disabled=processing||currentIndex===0;
 elements.skipBtn.disabled=processing;elements.settingsToggle.disabled=processing;
 elements.thumbList.querySelectorAll('button').forEach(button=>button.disabled=processing);
 [elements.addLayer,elements.saveTemplate,elements.applyTemplate,elements.deleteTemplate].forEach(button=>{if(button)button.disabled=processing;});
 elements.deleteLayer.disabled=processing||!activeLayerId;
 [elements.textContent,elements.textSize,elements.textColor,elements.textStroke,elements.fontFamily,elements.strokeWidth,elements.textBackground,elements.textBackgroundColor].forEach(input=>{if(input)input.disabled=processing||!getActiveLayer();});
}
function saveSettings() {
 const settings={
  format:elements.format.value,deleteOriginal:elements.deleteOriginal.checked,tags:elements.tags.value,
  folderId:elements.folderId.value,jpegQuality:elements.jpegQuality.value,maxFileSize:elements.maxFileSize.value,
  textLayers,activeLayerId,settingsVisible:!elements.settingsScroll.classList.contains('hidden-sidebar')
 };
 try{localStorage.setItem(SETTINGS_KEY,JSON.stringify(settings));}
 catch(error){console.warn('保存设置失败：',error);}
}
function loadSettings() {
 try {
  const raw=localStorage.getItem(SETTINGS_KEY);
  if(!raw){textLayers=[{...DEFAULT_TEXT_LAYER,id:createLayerId()}];activeLayerId=textLayers[0].id;return;}
  const s=JSON.parse(raw);
  elements.format.value=s.format==='image/jpeg'?'image/jpeg':'image/png';
  elements.deleteOriginal.checked=s.deleteOriginal===true;elements.tags.value=s.tags||'';
  elements.folderId.value=s.folderId||'';
  elements.jpegQuality.value=String(clamp(Number(s.jpegQuality)||90,40,100));
  elements.jpegQualityValue.textContent=elements.jpegQuality.value;
  elements.maxFileSize.value=String(clamp(Number(s.maxFileSize)||500,50,2048));
  elements.maxFileSizeValue.textContent=elements.maxFileSize.value;
  if(Array.isArray(s.textLayers)){
   textLayers=s.textLayers.filter(layer=>layer&&typeof layer.text==='string').map(layer=>({...DEFAULT_TEXT_LAYER,...layer,id:layer.id||createLayerId()}));
  } else if(typeof s.textContent==='string'&&s.textContent.trim()){
   textLayers=[{...DEFAULT_TEXT_LAYER,id:createLayerId(),text:s.textContent,
    size:clamp(Number(s.textSize)||28,12,96),color:s.textColor||'#ffffff',
    fontFamily:s.fontFamily||'Microsoft YaHei',stroke:s.textStroke!==false,
    strokeWidth:clamp(Number(s.strokeWidth??3),0,12),
    background:s.textBackground===true,backgroundColor:s.textBackgroundColor||'#000000',
    x:s.textPos?.x??0.5,y:s.textPos?.y??0.82}];
  } else textLayers=[];
  activeLayerId=textLayers.some(layer=>layer.id===s.activeLayerId)?s.activeLayerId:(textLayers[0]?.id||null);
  elements.settingsScroll.classList.toggle('hidden-sidebar',s.settingsVisible!==true);
 } catch(error) {
  console.warn('读取设置失败，将使用默认设置：',error);
  textLayers=[{...DEFAULT_TEXT_LAYER,id:createLayerId()}];activeLayerId=textLayers[0].id;
 }
}
function initDrag() {
 const host=elements.textOverlay,panel=document.querySelector('.image-panel');
 host.addEventListener('pointerdown',event=>{
  const node=event.target.closest('.text-layer-overlay');
  if(!node||!cropper||isProcessing)return;
  event.preventDefault();activeLayerId=node.dataset.layerId;dragLayerId=activeLayerId;
  renderLayerList();syncLayerControls();node.setPointerCapture(event.pointerId);
  const rect=node.getBoundingClientRect();
  dragOffset={x:event.clientX-(rect.left+rect.width/2),y:event.clientY-(rect.top+rect.height/2)};
  node.classList.add('dragging');
 });
 host.addEventListener('pointermove',event=>{
  if(!dragLayerId||!cropper)return;
  const layer=textLayers.find(item=>item.id===dragLayerId);if(!layer)return;
  const box=getCropBoxInPanel(panel),panelRect=panel.getBoundingClientRect();
  const cx=event.clientX-panelRect.left-dragOffset.x,cy=event.clientY-panelRect.top-dragOffset.y;
  layer.x=clamp((cx-box.left)/box.width,0,1);layer.y=clamp((cy-box.top)/box.height,0,1);
  updateLayerOverlayPosition(layer);updatePreview();
 });
 const stop=()=>{if(!dragLayerId)return;dragLayerId=null;saveSettings();};
 host.addEventListener('pointerup',stop);host.addEventListener('pointercancel',stop);
 host.addEventListener('lostpointercapture',stop);
}
function getCropBoxInPanel(panel) {
 const box=cropper.getCropBoxData();
 const containerRect=elements.image.parentElement.getBoundingClientRect();
 const panelRect=panel.getBoundingClientRect();
 return {left:containerRect.left-panelRect.left+box.left,top:containerRect.top-panelRect.top+box.top,width:box.width,height:box.height};
}
function updateLayerOverlayPosition(layer) {
 const node=elements.textOverlay.querySelector('[data-layer-id="'+layer.id+'"]');
 if(!node||!cropper)return;
 const box=getCropBoxInPanel(document.querySelector('.image-panel'));
 node.style.left=(box.left+layer.x*box.width)+'px';
 node.style.top=(box.top+layer.y*box.height)+'px';
}
function positionOverlay() {
 const host=elements.textOverlay;
 host.replaceChildren();
 if(!cropper)return;
 const panel=document.querySelector('.image-panel'),box=getCropBoxInPanel(panel),scale=box.width/OUTPUT_SIZE;
 textLayers.forEach(layer=>{
  if(!layer.text.trim())return;
  const node=document.createElement('div');
  node.className='text-layer-overlay'+(layer.id===activeLayerId?' active':'');
  node.dataset.layerId=layer.id;
  node.textContent=layer.text;
  node.style.left=(box.left+layer.x*box.width)+'px';
  node.style.top=(box.top+layer.y*box.height)+'px';
  node.style.fontSize=(layer.size*scale)+'px';
  node.style.lineHeight='1.2';
  node.style.fontFamily=layer.fontFamily;
  node.style.color=layer.color;
  node.style.webkitTextStroke=layer.stroke?(layer.strokeWidth*scale+'px #000'):'0 transparent';
  node.style.background=layer.background?layer.backgroundColor:'transparent';
  node.style.padding=(layer.size*0.28*scale)+'px';
  node.style.maxWidth=(box.width*0.92)+'px';
  host.appendChild(node);
 });
}
function syncOverlayStyle() {
 readStyleControls();
 positionOverlay();
}
function updateOverlayContent() {
 const layer=getActiveLayer();
 if(layer)layer.text=elements.textContent.value;
 renderLayerList();
 positionOverlay();
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
