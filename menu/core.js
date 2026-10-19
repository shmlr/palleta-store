'use strict';
(function(root,factory){const core=factory();if(typeof module==='object'&&module.exports)module.exports=core;if(root)root.PalletaCore=core;})(typeof window!=='undefined'?window:globalThis,function(){
const MEALS=['breakfast','lunch','dinner'];
const MEAL_NAMES={breakfast:'Завтрак',lunch:'Обед',dinner:'Ужин'};
const DAYS=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const EPS=1e-8;
function fresh(t,mins,now=Date.now()){let d=Date.parse(t||'');return Number.isFinite(d)&&d<=now&&now-d<=mins*60000;}
function availability(p,c,now=Date.now()){
 if(!fresh(p.availability_checked_at,c.stock_freshness_minutes,now))return 'unknown';
 if(p.availability==='out_of_stock'||(p.availability==='in_stock'&&p.stock_quantity===0))return 'out_of_stock';
 if(p.availability==='in_stock'&&Number.isFinite(p.stock_quantity)&&p.stock_quantity>0)return 'in_stock';
 return 'unknown';
}
function priceCurrent(p,c,now=Date.now()){return c.price_policy?.price_type==='Оптовая, RUB'&&c.price_policy?.audience==='club_card'&&p.price_source==='current_club'&&p.price_type==='Оптовая, RUB'&&Number.isFinite(p.price)&&p.price>=0&&fresh(p.price_as_of,c.price_freshness_hours*60,now);}
function validProduct(p,ing){return !!p&&p.compatible_with_recipe!==false&&p.unit===ing.unit&&Number.isFinite(p.pack_size)&&p.pack_size>0&&['by_pack','by_weight'].includes(p.pricing_mode);}
function candidateOptions(ing,c,forced,now){
 const products=c.byProduct;
 const res=(ing.product_ids||[]).map(id=>products[id]).filter(p=>validProduct(p,ing));
 // A product bought elsewhere can be used in a recipe regardless of its UT warehouse state.
 return res.map((p,i)=>({p,i,status:(ing.sold_in_palleta===false||p.sold_in_palleta===false)?'unknown':availability(p,c,now)}))
  .filter(x=>x.status!=='out_of_stock')
  .sort((a,b)=>{
    const pa=forced===a.p.id?0:1,pb=forced===b.p.id?0:1;
    if(pa!==pb)return pa-pb;
    if(a.status!==b.status)return a.status==='in_stock'?-1:1;
    const ca=priceCurrent(a.p,c,now)?a.p.price/(a.p.pricing_mode==='by_pack'?a.p.pack_size:1):Infinity;
    const cb=priceCurrent(b.p,c,now)?b.p.price/(b.p.pricing_mode==='by_pack'?b.p.pack_size:1):Infinity;
    if(ca!==cb)return ca-cb;
    return a.i-b.i;
  });
}
function availabilityCapacity(p,status){
 if(status!=='in_stock')return Infinity;
 const count=p.pricing_mode==='by_pack'?Math.floor(p.stock_quantity+EPS):Math.floor((p.stock_quantity+EPS)/p.pack_size);
 return Math.max(0,count);
}
function allocateIngredient(ing,needed,c,selected={},now=Date.now()){
 let rest=needed,alloc=[];
 for(const o of candidateOptions(ing,c,selected[ing.id],now)){
  if(rest<EPS)break;
  const max=availabilityCapacity(o.p,o.status);
  const packs=Math.min(Math.ceil((rest-EPS)/o.p.pack_size),max);
  if(packs<=0)continue;
  const q=Number((packs*o.p.pack_size).toFixed(5));
  rest=Math.max(0,rest-q);
  const p=o.p;const priceKnown=p.price_source==='current_club'&&p.price_type==='Оптовая, RUB'&&Number.isFinite(p.price)&&p.price>=0;
  alloc.push({ingredient:ing.id,p,quantity:q,packs,stock:o.status,priceKnown,priceCurrent:priceCurrent(p,c,now),cost:priceKnown?Number((p.pricing_mode==='by_pack'?p.price*packs:p.price*q).toFixed(2)):null});
 }
 return {ingredient:ing.id,required:needed,alloc,short:rest>EPS?Number(rest.toFixed(5)):0,unknown:alloc.some(x=>x.stock==='unknown')};
}
function basket(needs,c,selected={},now=Date.now(),homeIngredients=[]){
 const home=new Set(Array.isArray(homeIngredients)?homeIngredients:homeIngredients instanceof Set?[...homeIngredients]:[]);
 let items=[],externalItems=[],homeItems=[],shortages=[],externalShortages=[],unknownIngredients=[];
 for(const [id,qty] of Object.entries(needs)){
  if(qty<=EPS)continue;
  const ing=c.byIngredient[id];if(!ing){shortages.push({id,qty,reason:'unknown_ingredient'});continue;}
  // A product already at home is available for cooking, but never ordered or priced.
  if(home.has(id)){
   const options=(ing.product_ids||[]).map(pid=>c.byProduct[pid]).filter(p=>validProduct(p,ing));
   const product=options.find(p=>p.id===selected[id])||options[0]||null;
   homeItems.push({ingredient:id,ing,p:product,quantity:Number(qty.toFixed(5))});
   continue;
  }
  const a=allocateIngredient(ing,qty,c,selected,now);
  for(const part of a.alloc){
   const data={...part,ing};
   if(ing.sold_in_palleta===false||part.p.sold_in_palleta===false){
    externalItems.push({...data,stock:'unknown',priceKnown:false,priceCurrent:false,cost:null});
   }else items.push(data);
  }
  if(a.short){const missing={id,qty:a.short,name:ing.name};(ing.sold_in_palleta===false?externalShortages:shortages).push(missing);}
  if(a.unknown&&ing.sold_in_palleta!==false)unknownIngredients.push(id);
 }
 items.sort((a,b)=>a.ing.name.localeCompare(b.ing.name,'ru')||a.p.name.localeCompare(b.p.name,'ru'));
 externalItems.sort((a,b)=>a.ing.name.localeCompare(b.ing.name,'ru')||a.p.name.localeCompare(b.p.name,'ru'));
 homeItems.sort((a,b)=>a.ing.name.localeCompare(b.ing.name,'ru'));
 const allCurrent=items.length>0&&items.every(x=>x.priceCurrent);
 const allStock=items.length>0&&items.every(x=>x.stock==='in_stock')&&shortages.length===0;
 const allPriced=items.length>0&&items.every(x=>x.priceKnown);
 return {items,externalItems,homeItems,shortages,externalShortages,unknownIngredients,allStock,allCurrent,allPriced,
  referenceAmount:items.reduce((s,x)=>s+(x.cost||0),0),
  totalCurrent:allCurrent&&allPriced&&shortages.length===0?items.reduce((s,x)=>s+x.cost,0):null,
  confirmedTotal:allCurrent&&allStock&&allPriced?items.reduce((s,x)=>s+x.cost,0):null};
}
function aggregate(menu,people){let need={};for(const r of menu)if(r){for(const [id,q]of Object.entries(r.ingredients_per_person))need[id]=(need[id]||0)+q*people;}return need;}
function peopleForSlot(preferences,key){
 const people=Number.isSafeInteger(preferences.people)&&preferences.people>=1&&preferences.people<=6?preferences.people:1;
 const attendance=preferences.attendance;
 const custom=attendance&&typeof attendance==='object'&&!Array.isArray(attendance)&&Object.prototype.hasOwnProperty.call(attendance,key)?attendance[key]:undefined;
 return custom==='picnic'?0:Number.isInteger(custom)&&custom>=0&&custom<=people?custom:people;
}
function weightedNeeds(picked){
 const need={};
 for(const item of picked)if(item.recipe&&item.people>0){
  for(const [id,q]of Object.entries(item.recipe.ingredients_per_person))need[id]=(need[id]||0)+q*item.people;
 }
 return need;
}
function hash(s){let x=2166136261;for(let i=0;i<s.length;i++){x^=s.charCodeAt(i);x=Math.imul(x,16777619);}return (x>>>0)/4294967296;}
function plan(c,recipes,preferences,opts={}){
 const now=opts.now??Date.now();const fixed=opts.fixed||{},seed=opts.seed||1;
 const meals=opts.meals||MEALS,slots=[],picked=[],use={};
 const days=preferences.days===3?3:7;
 for(let day=0;day<days;day++)for(const meal of meals){
  const key=day+'-'+meal,people=peopleForSlot(preferences,key);
  const slot={key,day,meal,people,mode:preferences.attendance?.[key]==='picnic'?'picnic':'home',recipe:null,reason:''};
  if(people===0){slot.reason=slot.mode==='picnic'?'Пикник: продукты рассчитайте отдельно':'Дома никто не ест';slots.push(slot);continue;}
  const eligible=recipes.filter(r=>r.meal===meal&&r.minutes<=(preferences.time||999)&&!r.tags.some(t=>(preferences.excl||[]).includes(t)));
  if(!eligible.length){slot.reason='Нет рецептов по ограничениям';slots.push(slot);continue;}
  const ranked=eligible.map(r=>{
    const trial=basket(weightedNeeds([...picked,{recipe:r,people}]),c,opts.selected||{},now,opts.atHome||[]);
    let delta=trial.unknownIngredients.length;
    const repeat=(use[r.id]||0)*15;
    const recent=picked.slice(-3).filter(x=>x.recipe?.id===r.id).length*25;
    const forbid=fixed[key]&&fixed[key]!==r.id?1000000:0;
    return {r,trial,score:trial.shortages.length*100000+forbid+delta*4+repeat+recent+hash(r.id+'-'+key+'-'+seed)*4};
  }).filter(x=>x.trial.shortages.length===0&&(fixed[key]==null||x.r.id===fixed[key])).sort((a,b)=>a.score-b.score);
  if(ranked.length){slot.recipe=ranked[0].r;picked.push({recipe:ranked[0].r,people});use[ranked[0].r.id]=(use[ranked[0].r.id]||0)+1;}
  else slot.reason=fixed[key]?'Выбранное блюдо не обеспечено запасами':'Нет блюд из доступных товаров';
  slots.push(slot);
 }
 const b=basket(weightedNeeds(picked),c,opts.selected||{},now,opts.atHome||[]);
 const skipped=slots.filter(x=>x.people===0).length;
 return {slots,basket:b,days,filled:slots.filter(x=>x.recipe).length,
  totalSlots:slots.length,activeSlots:slots.length-skipped,skipped,used:use};
}
function normalize(c){
 if(!Array.isArray(c.products)||!Array.isArray(c.ingredients))throw Error('Некорректный products.json');
 const byProduct=Object.fromEntries(c.products.map(p=>[p.id,p]));
 const byIngredient=Object.fromEntries(c.ingredients.map(i=>[i.id,i]));
 for(const i of c.ingredients)for(const id of i.product_ids)if(!byProduct[id])throw Error('Нет товара: '+id);
 return {...c,byProduct,byIngredient};
}
function checkRecipes(rs,c){for(const r of rs){if(!MEALS.includes(r.meal))throw Error('Неверный приём пищи: '+r.id);for(const [id,q]of Object.entries(r.ingredients_per_person)){if(!c.byIngredient[id])throw Error('Нет ингредиента: '+id);if(!Number.isFinite(q)||q<=0)throw Error('Неверная порция: '+r.id+' '+id);}}}
return {DAYS,MEALS,MEAL_NAMES,fresh,availability,priceCurrent,validProduct,allocateIngredient,basket,aggregate,peopleForSlot,weightedNeeds,plan,normalize,checkRecipes};
});