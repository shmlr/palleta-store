/* Palleta Photo v0.3: local scanner fallback and preview. No photos are uploaded. */
'use strict';
(function(){
  const root=document.getElementById('scannerModal');
  const video=document.getElementById('scanVideo');
  const error=document.getElementById('scannerError');
  const opts=document.createElement('div');
  opts.className='scanner-fallbacks';
  opts.innerHTML='<p style="font-size:13px;color:#53687d">Наведите камеру на штрихкод. Если камера не откроется, сфотографируйте штрихкод отдельно.</p><div class="scanner-choices"><button type="button" class="primary" id="scanCapture">Снять штрихкод</button><button type="button" class="secondary" id="scanGallery">Из галереи</button></div><input type="file" id="scanPhotoFile" accept="image/*" capture="environment" hidden><input type="file" id="scanGalleryFile" accept="image/*" hidden><label class="fieldlabel">Или введите код<input id="scanManualCode" inputmode="numeric" autocomplete="off" placeholder="Цифры штрихкода" style="display:block;width:100%;min-height:44px;border:1px solid #dbe5ed;border-radius:11px;padding:10px;margin-top:8px;font-size:16px"></label><button type="button" class="secondary full" id="scanManualSearch">Найти по коду</button>';
  video.insertAdjacentElement('afterend',opts);
  const scanCapture=document.getElementById('scanCapture'),scanGallery=document.getElementById('scanGallery');
  const captureInput=document.getElementById('scanPhotoFile'),galleryInput=document.getElementById('scanGalleryFile');
  const manual=document.getElementById('scanManualCode');
  let zxingControls=null,loading=null,sequence=0;
  const scriptURL='https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js';
  function loadDecoder(){
    if(window.ZXingBrowser?.BrowserMultiFormatReader)return Promise.resolve(window.ZXingBrowser);
    if(loading)return loading;
    loading=new Promise((resolve,reject)=>{
      const tag=document.createElement('script');tag.src=scriptURL;tag.async=true;
      tag.onload=()=>window.ZXingBrowser?.BrowserMultiFormatReader?resolve(window.ZXingBrowser):reject(new Error('Библиотека распознавания недоступна'));
      tag.onerror=()=>reject(new Error('Не удалось загрузить модуль распознавания. Проверьте интернет.'));
      document.head.appendChild(tag);
    }).catch(e=>{loading=null;throw e});
    return loading;
  }
  function hint(message){error.hidden=false;error.textContent=message}
  const originalStop=stopScanner;
  stopScanner=async function(){
    sequence++;
    if(zxingControls){try{zxingControls.stop()}catch(e){}zxingControls=null}
    await originalStop();
    video.hidden=false;
  };
  function foundBarcode(value){
    const code=String(value||'').replace(/\s/g,'').trim();
    if(!code)return;
    stopScanner();
    document.getElementById('search').value=code;
    document.getElementById('groupFilter').value='';
    document.getElementById('statusFilter').value='';
    renderList();
    const matches=state.products.some(p=>(p.barcodes||[]).some(b=>String(b)===code)||String(p.id)===code);
    notify(matches?'Штрихкод считан: '+code:'Код '+code+' распознан, но товара нет в загруженном каталоге');
    document.getElementById('search').scrollIntoView({block:'center'});
  }
  const oldScan=scan;
  scan=async function(){
    error.hidden=true;
    root.hidden=false;
    video.hidden=false;
    manual.value='';
    const generation=++sequence;
    if(!navigator.mediaDevices?.getUserMedia){
      video.hidden=true;hint('Камера сканера в этом браузере недоступна. Нажмите «Снять штрихкод», затем сфотографируйте его обычной камерой телефона.');return;
    }
    if('BarcodeDetector' in window){
      try{
        const formats=await BarcodeDetector.getSupportedFormats();
        if(formats.some(f=>['ean_13','ean_8','code_128','upc_a'].includes(f))){
          return await oldScan();
        }
      }catch(e){}
    }
    hint('Подключаем распознавание штрихкодов…');
    try{
      const Z=await loadDecoder();if(generation!==sequence||root.hidden)return;
      const reader=new Z.BrowserMultiFormatReader();
      error.hidden=true;
      zxingControls=await reader.decodeFromConstraints({video:{facingMode:{ideal:'environment'}},audio:false},video,(result)=>{
        if(result&&generation===sequence)foundBarcode(result.getText());
      });
      if(generation!==sequence&&zxingControls){zxingControls.stop();zxingControls=null}
    }catch(e){
      if(generation!==sequence)return;
      video.hidden=true;
      hint('Онлайн-сканер не запустился: '+(e?.message||'недоступно')+'. Используйте «Снять штрихкод» или введите код вручную.');
    }
  };
  document.getElementById('scanBtn').onclick=scan;
  document.getElementById('closeScanner').onclick=stopScanner;
  document.getElementById('stopScanner').onclick=stopScanner;
  scanCapture.onclick=()=>captureInput.click();
  scanGallery.onclick=()=>galleryInput.click();
  const fromFile=async input=>{
    const file=input.files?.[0];input.value='';if(!file)return;
    hint('Распознаём штрихкод на фотографии…');
    let uri;
    try{
      const Z=await loadDecoder();
      uri=URL.createObjectURL(file);
      const reader=new Z.BrowserMultiFormatReader();
      const res=await reader.decodeFromImageUrl(uri);
      foundBarcode(res.getText());
    }catch(e){
      hint('Не удалось распознать код на фото. Снимайте этикетку крупно, ровно и при хорошем освещении. Можно ввести цифры вручную.');
    }finally{if(uri)URL.revokeObjectURL(uri)}
  };
  captureInput.onchange=()=>fromFile(captureInput);
  galleryInput.onchange=()=>fromFile(galleryInput);
  document.getElementById('scanManualSearch').onclick=()=>foundBarcode(manual.value);
  manual.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();foundBarcode(manual.value)}});

  /* View saved photos in the app instead of forcing an iOS download prompt. */
  const history=document.getElementById('history');
  history.addEventListener('click',function(e){
    const link=e.target.closest('a[data-get]');
    if(!link)return;
    e.preventDefault();e.stopPropagation();
    const entry=state.photos.find(p=>p.id===link.dataset.get);
    if(!entry)return;
    modal('Фото товара','');
    const panel=document.getElementById('modalContent');
    const img=document.createElement('img');
    const url=URL.createObjectURL(entry.web);
    img.src=url;img.alt='Сохранённое фото '+entry.productName;img.style.cssText='width:100%;aspect-ratio:1;object-fit:contain;background:#f5f7f9;border-radius:12px';
    panel.appendChild(img);
    const note=document.createElement('p');note.textContent='Фотография сохранена в приложении. Скачивание нужно только для передачи файла.';panel.appendChild(note);
    const save=document.createElement('button');save.className='secondary full';save.textContent='Сохранить файл на телефон';
    save.onclick=()=>{
      const ext=entry.web.type==='image/png'?'png':entry.web.type==='image/jpeg'?'jpg':'webp';
      const date=(entry.createdAt||'').slice(0,10).replace(/-/g,'');
      download(entry.web,entry.sku+'-'+date+'.'+ext);
    };
    panel.appendChild(save);
    const release=()=>{URL.revokeObjectURL(url);history.removeEventListener('click',release,true)};
    document.getElementById('closeModal').addEventListener('click',release,{once:true});
  },true);
  document.getElementById('sendReviewBtn').textContent='В локальную очередь проверки';
  const st=document.createElement('style');st.textContent='.scanner-choices{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.scanner-choices button{font-size:12px;padding:12px 6px}.history-row a{min-width:85px;text-align:right}#scanVideo[hidden]{display:none}.scanner-fallbacks{margin-top:14px}@media(max-width:390px){.scanner-choices{grid-template-columns:1fr 1fr}.scanner-choices button{font-size:11px}}';document.head.appendChild(st);
})();