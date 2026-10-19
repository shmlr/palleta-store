'use strict';
(() => {
const $=document.getElementById('app');
const C=window.PalletaCore;
if(!C){$.textContent='Ошибка загрузки расчётного модуля. Обновите страницу.';return;}
const esc=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const money=n=>Number(n).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
const qfmt=n=>Number(Number(n).toFixed(3)).toLocaleString('ru-RU');
const humanDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d||''))?String(d).slice(8,10)+'.'+String(d).slice(5,7)+'.'+String(d).slice(0,4):String(d||'дата неизвестна');
function refClubCost(it){const p=it.p;if(!p||!['manual_club_snapshot','current_club'].includes(p.price_source)||p.price_type!=='Оптовая, RUB'||!p.price_as_of||!Number.isFinite(p.price)||p.price<0)return null;if(!Number.isFinite(it.packs)||it.packs<0||!Number.isFinite(it.quantity)||it.quantity<0)return null;return Number((p.pricing_mode==='by_pack'?p.price*it.packs:p.price*it.quantity).toFixed(2));}
const STATUS={in_stock:'подтверждено по выгрузке',unknown:'остаток уточняется',out_of_stock:'нет по выгрузке'};
let catalog,recipes,step=0,seed=1,fixed={},chosen={},prefs={days:3,people:4,time:60,budget:0,excl:[]},lastPlan;
let view='home',hasSavedPlan=false;
let checkedItems=new Set(),homeIngredients=new Set();
const STORE_KEY='palleta-menu-v1';
const WHATSAPP_NUMBER='79882040001';
function saveState(){
 try{if(!window.localStorage)return;window.localStorage.setItem(STORE_KEY,JSON.stringify({version:2,step,seed,prefs,fixed,chosen,checked:[...checkedItems],home:[...homeIngredients]}));}catch(e){}
}
function loadState(){
 try{
  const s=JSON.parse(window.localStorage?.getItem(STORE_KEY)||'null');if(!s||typeof s!=='object')return;
  const old=s.version!==2;
  if(Number.isInteger(s.step)&&s.step>=0&&s.step<=(old?4:Q.length))
   step=old?(s.step===4?Q.length:s.step+1):s.step;
  hasSavedPlan=step===Q.length;
  if(Number.isSafeInteger(s.seed)&&s.seed>0&&s.seed<1000000)seed=s.seed;
  if(s.prefs&&typeof s.prefs==='object'){
   prefs.days=old?7:([3,7].includes(s.prefs.days)?s.prefs.days:3);
   prefs.people=[1,2,3,4,5,6].includes(s.prefs.people)?s.prefs.people:4;
   prefs.time=[30,45,60,999].includes(s.prefs.time)?s.prefs.time:60;
   prefs.budget=[0,5000,8000,12000].includes(s.prefs.budget)?s.prefs.budget:0;
   prefs.excl=Array.isArray(s.prefs.excl)?s.prefs.excl.filter(x=>['fish','dairy','gluten','eggs'].includes(x)):[];
  }
  const ids=new Set(recipes.map(r=>r.id));
  if(s.fixed&&typeof s.fixed==='object')for(const [k,v]of Object.entries(s.fixed)){
   if(/^[0-6]-(breakfast|lunch|dinner)$/.test(k)&&ids.has(v))fixed[k]=v;
  }
  if(s.chosen&&typeof s.chosen==='object')for(const [k,v]of Object.entries(s.chosen)){
   if(catalog.byIngredient[k]&&catalog.byProduct[v]&&catalog.byIngredient[k].product_ids.includes(v))chosen[k]=v;
  }
  const valid=new Set(catalog.products.map(p=>p.id));
  if(Array.isArray(s.checked))checkedItems=new Set(s.checked.filter(x=>valid.has(x)));
  if(Array.isArray(s.home))homeIngredients=new Set(s.home.filter(id=>catalog.byIngredient[id]&&catalog.byIngredient[id].sold_in_palleta!==false));
 }catch(e){}
}

const Q=[
 {key:'days',name:'На сколько дней составить меню?',choices:[['3 дня',3],['7 дней',7]],cols:true},
 {key:'people',name:'На сколько человек готовим?',choices:[['1',1],['2',2],['3',3],['4',4],['5',5],['6',6]],cols:true},
 {key:'time',name:'Максимальное время на одно блюдо?',choices:[['До 30 минут',30],['До 45 минут',45],['До 60 минут',60],['Без ограничения',999]]},
 {key:'budget',name:'Ориентир бюджета для выбранного меню?',choices:[['До 5 000 ₽',5000],['До 8 000 ₽',8000],['До 12 000 ₽',12000],['Без ограничения',0]]},
 {key:'excl',name:'Что исключить из меню?',choices:[['Рыбу','fish'],['Молочные продукты','dairy'],['Глютенсодержащие ингредиенты','gluten'],['Яйца','eggs']],multi:true}
];
function explainSource(){const latest=[...catalog.products].filter(x=>x.sold_in_palleta!==false&&x.availability_checked_at).map(x=>Date.parse(x.availability_checked_at)).filter(Number.isFinite);const when=latest.length?new Date(Math.max(...latest)).toLocaleString('ru-RU'):'нет подтверждённых выгрузок';return when;}
function renderHome(){
 let h='<div class="home-hero"><span class="pill">Паллета · меню для семьи</span><h1>Что приготовить на этой неделе?</h1><p class="home-lead">Подберите завтраки, обеды и ужины на 3 или 7 дней. Мы соберём продукты в один список покупок.</p><div class="home-stats"><div><b>3 или 7</b><span>дней</span></div><div><b>9 или 21</b><span>блюдо</span></div><div><b>'+recipes.length+'</b><span>рецепта</span></div></div><button class="btn" id="start-menu">Составить меню</button>';
 if(hasSavedPlan)h+='<button class="btn secondary" id="continue-menu">Продолжить сохранённое меню</button>';
 else h+='<button class="btn secondary" id="demo-menu">Посмотреть пример меню</button>';
 h+='</div><div class="panel home-about"><h2>Как это работает</h2><p><b>1.</b> Выберите количество человек, время и ограничения.</p><p><b>2.</b> Получите меню, меняйте блюда и подходящие продукты.</p><p><b>3.</b> Отметьте, что уже есть дома, и отправьте оставшуюся корзину в Паллету.</p></div><p class="muted">Клубные цены показаны справочно с датой. Наличие и итоговую сумму подтвердит магазин.</p>';
 $.innerHTML=h;
 document.getElementById('start-menu').onclick=()=>{step=0;seed=1;fixed={};chosen={};checkedItems.clear();homeIngredients.clear();prefs.days=3;hasSavedPlan=false;view='planner';render();};
 if(hasSavedPlan)document.getElementById('continue-menu').onclick=()=>{step=Q.length;view='planner';render();};
 else document.getElementById('demo-menu').onclick=()=>{step=Q.length;view='planner';render();};
}
function showHome(){view='home';render();if(typeof window.scrollTo==='function')window.scrollTo(0,0);}
function renderQuestion(){
 const q=Q[step];let h=`<div class="bar"><span style="width:${step/Q.length*100}%"></span></div><h1>${esc(q.name)}</h1>`;
 if(q.key==='budget')h+='<p class="muted">Бюджет проверяется по ценам для держателей клубной карты при свежей выгрузке из УТ 11. При неполных данных это пожелание, не гарантированный предел.</p>';
 h+=`<div class="choices${q.cols?' cols':''}">`;
 for(const [label,val] of q.choices){const marked=q.multi?prefs.excl.includes(val):prefs[q.key]===val;h+=`<button class="choice${marked?' selected':''}" data-answer="${esc(val)}" aria-pressed="${marked?'true':'false'}">${esc(label)}</button>`;}
 h+='</div>';
 if(q.multi)h+='<button class="btn" id="next">Собрать '+(prefs.days*3)+' блюд</button>';
 if(step===0)h+='<button class="btn secondary" id="quickstart">Сразу показать пример на 3 дня</button>';
 if(step)h+='<button class="btn secondary" id="back">Назад</button>';
 h+='<button class="btn secondary" id="home-from-questions">На главную</button>';
 $.innerHTML=h;
 $.querySelectorAll('[data-answer]').forEach(b=>b.onclick=()=>{const value=b.dataset.answer;
  if(q.multi){if(prefs.excl.includes(value))prefs.excl=prefs.excl.filter(x=>x!==value);else prefs.excl.push(value);} else {prefs[q.key]=Number(value);step++;}
  fixed={};render();
 });
 if(q.multi)document.getElementById('next').onclick=()=>{step=Q.length;render()};
 if(step===0)document.getElementById('quickstart').onclick=()=>{step=Q.length;render()};
 if(step)document.getElementById('back').onclick=()=>{step--;render()};
 document.getElementById('home-from-questions').onclick=showHome;
}
function renderRecipeDetails(r){return `<details><summary class="small">Как готовить и состав на порцию</summary><p class="small">${Object.entries(r.ingredients_per_person).map(([id,v])=>`${esc(catalog.byIngredient[id].name)} ${qfmt(v)} ${esc(catalog.byIngredient[id].unit)}`).join(' · ')}</p><ol>${r.steps.map(t=>`<li class="small">${esc(t)}</li>`).join('')}</ol><p class="small">${esc(r.pantry_note)}</p></details>`;}
function alternativesFor(slot){
 const recipesForMeal=recipes.filter(r=>r.meal===slot.meal&&r.minutes<=prefs.time&&!r.tags.some(t=>prefs.excl.includes(t)));
 // Availability across the entire selected week's cart is checked by the planner when a user chooses an alternative.
 return recipesForMeal.filter(r=>r.id!==slot.recipe?.id).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
}
function basketText(result){
 let t=`Паллета. Заявка на проверку корзины\nКЛУБНЫЕ ЦЕНЫ: только по карте Паллеты.\n${prefs.days===3?'3 дня':'7 дней'}, завтрак / обед / ужин, на ${prefs.people} чел.\n`;
 for(const slot of result.slots)t+=`${C.DAYS[slot.day]} ${C.MEAL_NAMES[slot.meal]}: ${slot.recipe?slot.recipe.name:'НЕ ПОДОБРАНО'}\n`;
 t+='\nКупить в Паллете (предварительная заявка):\n';
 for(const it of result.basket.items){const ref=refClubCost(it);
  const qty=it.p.pricing_mode==='by_weight'?`${qfmt(it.quantity)} ${it.p.unit}`:`${it.packs} уп. по ${qfmt(it.p.pack_size)} ${it.p.unit}`;
  t+=`• ${it.p.name} — ${qty}${it.p.sku_code?' [код '+it.p.sku_code+']':''}; наличие ${STATUS[it.stock]}; ${it.priceCurrent?'клубная стоимость '+money(it.cost):ref!==null?'справочная стоимость '+money(ref)+' по клубным ценам от '+humanDate(it.p.price_as_of):'клубная цена неизвестна'}\n`;
 }
 if(result.basket.homeItems.length){
  t+='\nУже есть дома (не заказывать в Паллете):\n';
  for(const it of result.basket.homeItems)t+='• '+it.ing.name+' — '+qfmt(it.quantity)+' '+it.ing.unit+'\n';
 }
 if(result.basket.externalItems.length){
  t+='\nДома / купить отдельно (не для заказа в Паллете):\n';
  for(const it of result.basket.externalItems){
   const qty=it.p.pricing_mode==='by_weight'?qfmt(it.quantity)+' '+it.p.unit:it.packs+' уп. по '+qfmt(it.p.pack_size)+' '+it.p.unit;
   t+='• '+it.p.name+' — '+qty+'\n';
  }
 }
 if(result.basket.shortages.length)t+='\nНЕ ХВАТАЕТ: '+result.basket.shortages.map(x=>x.name||x.id).join(', ')+'\n';
 t+='\nПожалуйста, проверьте цены, фактические остатки, возможные замены и условия доставки. Сумма не является подтверждённым заказом.';
 return t;
}
function whatsappOrderText(result){
 const lines=['Здравствуйте! Прошу проверить наличие и собрать продукты в «Паллете» по меню на неделю.',
  'На '+prefs.people+' чел. · '+prefs.days+' дн. · '+result.filled+' из '+result.totalSlots+' блюд.',
  'Список покупок:'];
 for(const it of result.basket.items){
  const quantity=it.p.pricing_mode==='by_weight'?qfmt(it.quantity)+' '+it.p.unit:it.packs+' уп. по '+qfmt(it.p.pack_size)+' '+it.p.unit;
  lines.push('• '+it.p.name+' — '+quantity);
 }
 if(result.basket.shortages.length)lines.push('Не подобраны: '+result.basket.shortages.map(i=>i.name||i.id).join(', '));
 lines.push('Прошу подтвердить фактическое наличие, клубные цены, возможные замены и итоговую сумму.');
 lines.push('Заявка предварительная. До подтверждения магазином заказ не оформлен.');
 return lines.join('\n');
}
function whatsappHref(result){return 'https://wa.me/'+WHATSAPP_NUMBER+'?text='+encodeURIComponent(whatsappOrderText(result));}
function renderResult(message=''){
 hasSavedPlan=true;
 lastPlan=C.plan(catalog,recipes,prefs,{seed,fixed,selected:chosen,atHome:[...homeIngredients]});
 const p=lastPlan,b=p.basket;
 let h='<button class="home-link" id="home-from-result">← На главную</button><div class="bar"><span style="width:100%"></span></div><h1>Семейное меню на '+prefs.days+' '+(prefs.days===3?'дня':'дней')+'</h1><p class="pill">Клубные цены по карте Паллеты</p><div class="note">Цена «Оптовая, RUB» применяется для держателей клубной карты Паллеты. Без карты цена по клубному тарифу не гарантируется. Итоговый чек подтверждается на кассе.</div>';
 h+=`<p class="muted">${prefs.people} чел. · завтрак, обед и ужин · ${p.filled} из ${p.totalSlots} блюд подобрано · ${recipes.length} редакционных рецептов</p>`;
 if(message)h+=`<div class="note">${esc(message)}</div>`;
 const inStock=catalog.products.filter(x=>x.sold_in_palleta!==false&&C.availability(x,catalog)==='in_stock').length;
 h+=`<div class="note"><b>${inStock?'Часть остатков подтверждена':'Данных 1С о текущих остатках пока нет'}.</b> Каталог автоматически подхватывается из products.json при открытии сайта. Последняя сверка: ${esc(explainSource())}. ${inStock?'Товары с устаревшими отметками показываются как неизвестные.':'Выбор предварительный: «остаток уточняется» не означает отсутствие товара в магазине.'}</div>`;
 let day=-1;
 for(const slot of p.slots){
   if(slot.day!==day){day=slot.day;h+=`<div class="panel"><h2 class="dayheading">${C.DAYS[day]} · день ${day+1}</h2>`;}
   h+=`<div class="slot"><div class="slot-head"><strong>${C.MEAL_NAMES[slot.meal]}</strong><span>${slot.recipe?esc(slot.recipe.name):'<span class="error">Блюдо не подобрано</span>'}</span></div>`;
   if(slot.recipe){h+=`<div class="small">${slot.recipe.minutes} мин · редакционный рецепт</div>`;h+=renderRecipeDetails(slot.recipe);}else h+=`<p class="small warning">${esc(slot.reason)}. Обновите остатки или снимите ограничения.</p>`;
   const options=alternativesFor(slot);
   if(options.length){h+=`<div class="grid-actions"><select class="slotselect" aria-label="Заменить ${C.MEAL_NAMES[slot.meal].toLowerCase()} дня ${slot.day+1}" data-slot="${esc(slot.key)}"><option value="">Заменить блюдо…</option>`;
     for(const x of options)h+=`<option value="${esc(x.id)}">${esc(x.name)} · ${x.minutes} мин</option>`;
     h+='</select></div>';
   }
   h+='</div>';
   if((p.slots.indexOf(slot)+1)%3===0)h+='</div>';
 }
 h+='<div class="panel" id="shopping"><h2>Купить в Паллете</h2><p class="small">В сумму и заявку входят только товары Паллеты, которых нет дома. Мясо учитывается отдельно.</p>';
 const currentConfirm=b.confirmedTotal!==null;
 h+=`<div class="value">${currentConfirm?money(b.confirmedTotal):'Полный итог пока неизвестен'}</div>`;
 h+=`<p class="muted">${currentConfirm?'Все позиции покрыты свежими остатками и клубными ценами из УТ 11. Расчёт действует при предъявлении карты; чек подтвердит магазин.':'Клубный итог пока неизвестен: нужны свежие подтверждённые цены по карте и остатки. Исторические розничные цены не учитываются.'}</p>`;
 h+=`<p class="small">Позиции: ${b.items.length} · Без свежего остатка: ${b.items.filter(x=>x.stock!=='in_stock').length} · Без свежей цены: ${b.items.filter(x=>!x.priceCurrent).length} · Нехватка: ${b.shortages.length}</p>`;
 const known=b.items.filter(it=>refClubCost(it)!==null&&!it.priceCurrent);
 if(known.length){const estimate=known.reduce((sum,it)=>sum+refClubCost(it),0);h+=`<div class="note"><b>Справочная сумма по ${known.length} из ${b.items.length} позиций: ≈ ${money(estimate)}</b><p class="small">Только товары с известной клубной ценой на дату выгрузки. Это не полная стоимость корзины и не подтверждённый заказ.</p></div>`;}
 if(p.filled<p.totalSlots)h+=`<p class="error">${p.totalSlots-p.filled} блюд не подобрано: в каталоге нет подтверждённых подходящих сочетаний при ваших ограничениях.</p>`;
 if(prefs.budget){h+=`<p class="small">Бюджет: ${money(prefs.budget)}. ${currentConfirm?b.confirmedTotal<=prefs.budget?'Собранная корзина укладывается в бюджет по данным последней выгрузки.':'Внимание: корзина превышает выбранный бюджет.':'Проверка бюджета заблокирована неполными данными.'}</p>`;}
 h+='</div><div class="panel"><h2>Список покупок в Паллете <span class="pill" id="check-count">'+b.items.filter(x=>checkedItems.has(x.p.id)).length+' / '+b.items.length+' отмечено</span></h2><p class="muted">Отмечайте купленное. Галочки сохраняются на устройстве. Нажмите «Уже есть дома», чтобы убрать продукт из заявки. Значок ≈ — справочная цена.</p>';
 for(const it of b.items){const opts=(it.ing.product_ids||[]).map(id=>catalog.byProduct[id]).filter(x=>C.validProduct(x,it.ing)&&C.availability(x,catalog)!=='out_of_stock');
 const ref=refClubCost(it);
 h+=`<div class="product"><div class="product-head"><label class="check-row"><input class="shopping-check" type="checkbox" data-check="${esc(it.p.id)}" ${checkedItems.has(it.p.id)?'checked':''} aria-label="Куплено: ${esc(it.p.name)}"><span class="basket-name">${esc(it.ing.name)}</span></label><span class="amount">${it.priceCurrent?money(it.cost):ref!==null?'≈ '+money(ref):'цену уточнить'}</span></div>`;
 const qty=it.p.pricing_mode==='by_pack'?`${it.packs} уп. по ${qfmt(it.p.pack_size)} ${esc(it.p.unit)} · всего ${qfmt(it.quantity)} ${esc(it.p.unit)}`:`${qfmt(it.quantity)} ${esc(it.p.unit)}`;
 h+=`<p class="small">${esc(it.p.name)} · ${qty} · ${esc(STATUS[it.stock])}${it.p.sku_code?' · код '+esc(it.p.sku_code):''}</p>`;
 h+=`<label class="small home-checkbox"><input type="checkbox" data-home="${esc(it.ing.id)}"> Уже есть дома — убрать из заявки</label>`;
 if(it.ing.source_group==='Рынок 2')h+='<p class="small success">Учтена в группе «Рынок 2» УТ 11. Вид, фасовку и актуальное наличие уточнят при сборке.</p>';
 if(it.priceKnown&&!it.priceCurrent)h+=`<p class="small">Последняя известная клубная стоимость ${money(it.cost)} · не текущая цена</p>`;
 if(ref!==null&&!it.priceCurrent){h+=`<p class="small">Клубная цена на ${esc(humanDate(it.p.price_as_of))}: ${money(it.p.price)} за ${it.p.pricing_mode==='by_pack'?'упаковку':esc(it.p.unit)}. Справочно, не текущая цена.</p>`;}
 if(opts.length>1){h+=`<label class="small" for="select-${esc(it.ingredient)}">Заменить на аналог или другую фасовку</label><select id="select-${esc(it.ingredient)}" data-ingredient="${esc(it.ingredient)}">`;
 for(const op of opts)h+=`<option value="${esc(op.id)}" ${op.id===it.p.id?'selected':''}>${esc(op.name)} · ${esc(STATUS[C.availability(op,catalog)])}</option>`;
 h+='</select>';
 }
 h+='</div>';
 }
 if(!b.items.length)h+='<p class="small">По этому меню нет товаров для покупки в Паллете.</p>';
 h+='</div>';
 if(b.homeItems.length){
  h+='<div class="panel" id="at-home"><h2>Уже есть дома</h2><p class="small">Продукты остаются в рецептах, но не входят в заявку и стоимость. Снимите галочку, чтобы вернуть в покупки.</p>';
  for(const it of b.homeItems)h+='<div class="product"><label class="home-checkbox"><input type="checkbox" data-home="'+esc(it.ingredient)+'" checked> '+esc(it.ing.name)+'</label><p class="small">Нужно для меню: '+qfmt(it.quantity)+' '+esc(it.ing.unit)+'</p></div>';
  h+='</div>';
 }
 if(b.externalItems.length){
  h+='<div class="panel" id="outside-store"><h2>Дома или купить отдельно</h2><p class="muted">Мясо пока не продаётся в Паллете. Эти продукты нужны для приготовления, но не входят в клубную стоимость и WhatsApp-заявку магазину.</p>';
  for(const it of b.externalItems){
   const qty=it.p.pricing_mode==='by_weight'?qfmt(it.quantity)+' '+esc(it.p.unit):it.packs+' уп. по '+qfmt(it.p.pack_size)+' '+esc(it.p.unit);
   h+='<div class="product"><b>'+esc(it.ing.name)+'</b><p class="small">'+esc(it.p.name)+' · '+qty+'</p>';
   const options=(it.ing.product_ids||[]).map(id=>catalog.byProduct[id]).filter(x=>C.validProduct(x,it.ing));
   if(options.length>1){
    h+='<label class="small" for="outside-'+esc(it.ing.id)+'">Что будете использовать</label><select id="outside-'+esc(it.ing.id)+'" data-ingredient="'+esc(it.ing.id)+'">';
    for(const alt of options)h+='<option value="'+esc(alt.id)+'" '+(alt.id===it.p.id?'selected':'')+'>'+esc(alt.name)+'</option>';
    h+='</select>';
   }
   h+='</div>';
  }
  h+='</div>';
 }
 h+='<div class="panel"><h2>Какие SKU стоит проверить</h2><p class="small">Это рекомендации для сверки в 1С, а не утверждение, что товаров нет в магазине.</p>';
 const uncovered=catalog.ingredients.filter(i=>i.sold_in_palleta!==false&&i.source_group!=='Рынок 2'&&!(i.product_ids||[]).some(id=>{const pr=catalog.byProduct[id];return C.validProduct(pr,i)&&C.availability(pr,catalog)==='in_stock';}));
 const important=uncovered.slice(0,10);
 for(const i of important)h+=`<div class="product"><b>${esc(i.name)}</b><div class="small">${esc(i.substitution_hint||'Проверить подходящий SKU и актуальное наличие')}</div></div>`;
 h+='<p class="small">Идеи завтраков из публичного демо berbena.pro, ещё не сопоставленные с ассортиментом: овсяные хлопья, бананы, семена чиа, кокосовое молоко. Они не включены в заказ.</p></div>';
 h+='<button class="btn" id="copy">Скопировать меню и список продуктов</button><button class="btn secondary" id="share">Поделиться списком</button><button class="btn secondary" id="print">Распечатать или сохранить PDF</button><button class="btn secondary" id="clearchecks">Снять отметки с покупок</button><button class="btn secondary" id="shuffle">Другое сочетание блюд</button><button class="btn secondary" id="restart">Изменить условия</button>';
 h+='<div class="panel wa-section"><h2>Готово! Отправьте заявку в Паллету</h2><p class="small">В заявке только товары магазина, без мяса из домашних запасов. Магазин уточнит клубные цены, наличие и возможные замены.</p><a class="btn wa-link" id="whatsapp" href="'+esc(whatsappHref(lastPlan))+'" target="_blank" rel="noopener noreferrer">Отправить список в WhatsApp ↗</a><p class="small">Получатель: +7 988 204-00-01. WhatsApp откроет готовое сообщение: проверьте его и нажмите «Отправить». Без подтверждения магазина заказ ещё не оформлен.</p></div>';
if(prefs.time<90)h+='<p class="small">Для блюд из куриных потрохов выберите «Без ограничения» по времени: им требуется больше времени, чем куриному филе.</p>';
h+='<p class="muted">* Соль, вода и специи для многих рецептов не включены в продуктовую корзину; порции носят редакционный характер. Аллергенная безопасность не проверена, фильтры не заменяют изучение состава товара.</p>';
 $.innerHTML=h;
 saveState();
 document.getElementById('home-from-result').onclick=showHome;
 $.querySelectorAll('[data-home]').forEach(el=>el.onchange=()=>{
  if(el.checked)homeIngredients.add(el.dataset.home);else homeIngredients.delete(el.dataset.home);
  renderResult(el.checked?'Продукт уже есть дома, поэтому исключён из заявки.':'Продукт возвращён в покупки.');
 });
 $.querySelectorAll('[data-check]').forEach(el=>el.onchange=()=>{
  if(el.checked)checkedItems.add(el.dataset.check);else checkedItems.delete(el.dataset.check);
  saveState();
  const count=document.getElementById('check-count');
  if(count)count.textContent=b.items.filter(x=>checkedItems.has(x.p.id)).length+' / '+b.items.length+' отмечено';
 });
 $.querySelectorAll('[data-slot]').forEach(sel=>sel.onchange=()=>{if(!sel.value)return;const orig=fixed[sel.dataset.slot];fixed[sel.dataset.slot]=sel.value;const check=C.plan(catalog,recipes,prefs,{seed,fixed,selected:chosen,atHome:[...homeIngredients]});
  const target=check.slots.find(s=>s.key===sel.dataset.slot);
  if(!target?.recipe){if(orig===undefined)delete fixed[sel.dataset.slot];else fixed[sel.dataset.slot]=orig;renderResult('Выбранное блюдо не удаётся обеспечить в рамках доступных запасов. Предложите другую замену.');}
  else renderResult('Блюдо заменено. Корзина пересчитана; при ограниченных остатках другие блюда тоже могут измениться.');
 });
 $.querySelectorAll('[data-ingredient]').forEach(sel=>sel.onchange=()=>{chosen[sel.dataset.ingredient]=sel.value;renderResult('Товар заменён. Итог и остатки пересчитаны для всей недели.');});
 document.getElementById('copy').onclick=async()=>{const t=basketText(lastPlan),btn=document.getElementById('copy');try{await navigator.clipboard.writeText(t);btn.textContent='Список скопирован';}catch(e){const ta=document.createElement('textarea');ta.value=t;document.body.appendChild(ta);ta.select();if(document.execCommand('copy'))btn.textContent='Список скопирован';else window.prompt('Скопируйте список:',t);ta.remove();}};
 document.getElementById('share').onclick=async()=>{const t=basketText(lastPlan);if(navigator.share){try{await navigator.share({title:'Паллета: меню на неделю',text:t});return;}catch(e){if(e.name==='AbortError')return;}}
  try{await navigator.clipboard.writeText(t);document.getElementById('share').textContent='Список скопирован';}catch(e){window.prompt('Скопируйте список:',t);}
 };
 document.getElementById('print').onclick=()=>{window.print?.();};
 document.getElementById('clearchecks').onclick=()=>{checkedItems.clear();renderResult('Отметки покупок сняты.');};
 document.getElementById('shuffle').onclick=()=>{seed++;fixed={};window.scrollTo(0,0);renderResult();};
 document.getElementById('restart').onclick=()=>{step=0;fixed={};chosen={};window.scrollTo(0,0);render();};
}
function render(){if(view==='home')renderHome();else if(step<Q.length)renderQuestion();else renderResult();saveState();}
async function init(){
 try{
  if(!window.fetch)throw Error('Браузер не поддерживает загрузку каталога');
  const [p,r]=await Promise.all(['products.json','recipes.json'].map(async f=>{const ans=await fetch('./'+f+'?v=11',{cache:'no-store'});if(!ans.ok)throw Error(f+': HTTP '+ans.status);return ans.json();}));
  catalog=C.normalize(p);recipes=r.recipes;C.checkRecipes(recipes,catalog);if(recipes.length===0)throw Error('Нет рецептов');loadState();render();
 }catch(e){$.innerHTML=`<div class="note"><b>Не удалось загрузить каталог.</b><div class="small">${esc(e.message)}</div></div><button class="btn" id="retry">Повторить</button>`;document.getElementById('retry').onclick=init;}
}
if(typeof navigator!=='undefined'&&'serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
init();
})();