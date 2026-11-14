import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const db = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});
const $ = id => document.getElementById(id);
const coilTypesBySystem = {
  PCM: [
    ["CABINE_400","Cabine 400",608],["CABINE_480","Cabine 480",667],
    ["CABINE_680","Cabine 680",718],["CABINE_CF_255","Cabine CF 255",779],
    ["CABINE_CF_100","Cabine CF 100",779],["CABINE_300","Cabine 300",576.5],
    ["CABINE_138","Cabine 138",516.5]
  ],
  PRINTING: [
    ["PORTE_400","Porte 400",737],["PORTE_480","Porte 480",825.6],
    ["PORTE_680","Porte 680",894.4],["PORTE_CF_255","Porte CF 255",685.5],
    ["PORTE_CF_100","Porte CF 100",562],["PORTE_300","Porte 300",616],
    ["PORTE_138","Porte 138",553]
  ],
  VCM: [
    ["CABINE_CF_255","Cabine CF 255",779],
    ["PORTE_400","Porte 400",737],["PORTE_480","Porte 480",825.6],
    ["PORTE_680","Porte 680",894.4],["PORTE_CF_255","Porte CF 255",685.5],
    ["PORTE_CF_100","Porte CF 100",562],["PORTE_300","Porte 300",616],
    ["PORTE_138","Porte 138",553]
  ]
};
let coilTypes = coilTypesBySystem.PCM;
const layersBySystem = {
  PCM: {BACK:.0028, PRIMER:.008, FINISH:.011},
  PRINTING: {BACK:.0028, PRIMER:.011, FINISH:.009, INK:.003},
  VCM: {BACK:.0028, FINISH:.011}
};
const layerNames = {BACK:"Back",PRIMER:"Primer",FINISH:"Finish",INK:"Ink"};
const paintCatalog = {
 PCM:{BACK:["Modifier epoxy paint (EP-3189)"],PRIMER:["CR Free HP Primer"],FINISH:["Flexible Polyester White","Fle Polyester Bleu Midnight","IBA-002 (YL-36836)","Inox Matt","RAL-7005","RAL-7009"]},
 PRINTING:{BACK:["Modifier epoxy paint (EP-3189)"],PRIMER:["MEA-590 (Grey)","MEA-588 (Basalet)","MEA-695 (White)","MEA-636 (Inox)","Silver Metalic Matt (Space Grey)","Bleu Metalic Matt (Bleu Midnight)","NC ASP (B-01-HM) H/L = MEA-590","NC ASP (B-02-HM) ZINC = MEA-588"],FINISH:["Pearlesent","Hight gloss varnish","Silver Matt Clear (Space Grey)","Bleu Matt Clear (Bleu Midnight)","NC ASP (C-01-HU) = Hight gloss varnish"],INK:["ME-421 (White)","ME-467 (Inox)","BL-326 (Basalet)","NC ASP (I-02-HS) ZINC = BL-326","BL-327 (Grey)","NC ASP (I-01-HS) H/L = BL-327"]},
 VCM:{BACK:["Modifier Epoxy Paint (EP-3189)"],FINISH:["GLUE P-811 W","Adhesive","Adhesive (NAV-200)"]}
};
const peFilmWidths={PCM:{CABINE_138:366.5,CABINE_CF_100:774,CABINE_CF_255:774,CABINE_300:426.5,CABINE_400:528,CABINE_480:587,CABINE_680:638,CABINE_410:541,CABINE_420:591},PRINTING:{PORTE_138:548,PORTE_CF_100:557,PORTE_CF_255:680.5,PORTE_300:611,PORTE_400:733,PORTE_410:708,PORTE_420:708,PORTE_480:822,PORTE_680:892},VCM:{PORTE_CF_255:774,PORTE_400:733,PORTE_480:822,PORTE_680:892}};
const vcmFilmWidths={CABINE_CF_255:830,PORTE_400:780,PORTE_480:870,PORTE_680:940};
let session = null, profile = null, recordsChannel = null, recordsCache = [];
let editingDailyConsumptionId = null;

function notify(message) {
  $("toast").textContent = message; $("toast").classList.add("show");
  setTimeout(()=>$("toast").classList.remove("show"),2600);
}
function setConnection(ok) {
  $("connection").textContent = ok ? "● Connecté" : "● Hors ligne";
  $("connection").style.color = ok ? "#a9e5c0" : "#f2c4a7";
}
function fmt(n,d=3){return Number(n).toLocaleString("fr-FR",{minimumFractionDigits:d,maximumFractionDigits:d});}
async function fetchAllRows(queryFactory,pageSize=1000){
  const rows=[];let from=0;
  while(true){
    const {data,error}=await queryFactory().range(from,from+pageSize-1);
    if(error)throw error;
    const page=data||[];rows.push(...page);
    if(page.length<pageSize)break;
    from+=pageSize;
  }
  return rows;
}
function materialStatusLabel(status){return ({CONFORME:'Conforme — Utilisable',NON_CONFORME:'Non conforme — Non utilisable',A_VERIFIER:'À vérifier'})[status]||'À vérifier';}
function localDate(){const d=new Date();d.setMinutes(d.getMinutes()-d.getTimezoneOffset());return d.toISOString().slice(0,10);}
function activeCoil(){return coilTypes.find(x=>x[0]===$("coilType").value)||coilTypes[0];}
function updateCoilOptions(preserve=false){
  const previous=preserve?$("coilType").value:null;
  coilTypes=coilTypesBySystem[$("system").value]||coilTypesBySystem.PCM;
  $("coilType").innerHTML=coilTypes.map(([code,name])=>`<option value="${code}">${name}</option>`).join("");
  if(previous&&coilTypes.some(x=>x[0]===previous)) $("coilType").value=previous;
}
function baseWeight(){
  const [, , width]=activeCoil(), t=Number($("thickness").value), l=Number($("length").value);
  if(!(t>0&&l>0)) return 0;
  return Number((width/1000*t/1000*l*7850).toFixed(3));
}
function productionWeight(){
  const layersTotal=[...document.querySelectorAll('#layers input[data-layer]')]
    .filter(x=>Object.hasOwn(layersBySystem[$("system").value]||{},x.dataset.layer))
    .reduce((sum,x)=>sum+Math.max(0,Number(x.value)||0),0);
  return Number((baseWeight()+Math.max(0,Number($("preWeight").value)||0)+layersTotal).toFixed(3));
}
function updateWeight(){
  const [,name,width]=activeCoil(), base=baseWeight(), total=productionWeight();
  $("widthDisplay").textContent=`${fmt(width,1)} mm`;
  $("baseWeight").textContent=base?`${fmt(base)} kg`:"— kg";
  $("productionWeight").textContent=base?`${fmt(total)} kg`:"— kg";
  if($("afterWeight")) $("afterWeight").value=base?total.toFixed(3):"";
  const ready=base>0; $("calcStatus").textContent=ready?`Prêt · dénominateur ${fmt(total)} kg`:"Complétez les dimensions";
  document.querySelectorAll(".layer-card").forEach(card=>{
    const input=card.querySelector("input"), out=card.querySelector(".coefficient");
    const c=Number(input.value);
    out.textContent=ready&&input.value!==""?`Coefficient : ${fmt(c/total,6)}`:"Coefficient : —";
  });
}
function renderLayers(){
  const sys=$("system").value;
  $("layers").innerHTML=Object.entries(layersBySystem[sys]).map(([code,ref])=>`
    <div class="layer-card"><h3>${layerNames[code]}</h3>
    <label for="paint-${code}">Type de peinture</label><div class="paint-choice-row"><select id="paint-${code}" data-paint="${code}"><option value="">Choisir une peinture</option></select><button type="button" class="ghost add-paint" data-add-paint="${code}" title="Ajouter une peinture">+</button></div>
    <label for="layer-${code}">Consommation (kg)</label>
    <input id="layer-${code}" data-layer="${code}" type="number" min="0" step="0.001" placeholder="0.000">
    <select id="barrel-${code}" data-barrel="${code}" class="auto-barrel" aria-hidden="true" tabindex="-1" hidden><option value="">Sélection automatique du baril</option></select>
    <div class="coefficient">Coefficient : —</div><div class="muted">Référence : ${ref.toFixed(4)}</div></div>`).join("");
  $("layers").querySelectorAll("input[data-layer]").forEach(x=>{
    x.addEventListener("input",updateWeight);
    x.addEventListener("change",()=>loadPaintBarrels());
  });
  $("layers").querySelectorAll("select[data-paint]").forEach(x=>x.addEventListener("change",()=>loadPaintBarrels()));
  $("layers").querySelectorAll("[data-add-paint]").forEach(x=>x.addEventListener("click",()=>addPaintType(x.dataset.addPaint)));
  updateWeight();
  updateFilmOptions();
  if(profile) loadPaintBarrels();
}
function updateFilmOptions(){
  const sys=$("system").value, coil=activeCoil()?.[0]||"";
  const bodyType=coil.startsWith("CABINE")?"CABINE":coil.startsWith("PORTE")?"PORTE":"";
  const filmLabels={CABINE_410:"Cabine 410",CABINE_420:"Cabine 420",PORTE_410:"Porte 410",PORTE_420:"Porte 420",CABINE_CF_255:"Cabine CF 255"};
  const peEntries=Object.entries(peFilmWidths[sys]||{}).filter(([code])=>sys==="VCM"?code===coil:(bodyType&&code.startsWith(bodyType)));
  const peOptions=peEntries.map(([code,width])=>`<option value="${code}" data-width="${width}">${escapeHtml(filmLabels[code]||code.replaceAll("_"," "))} — ${fmt(width,1)} mm</option>`).join("");
  $("peFilmType").innerHTML='<option value="">Choisir un PE-Film</option>'+peOptions;
  $("peFilmType").value="";$("peFilmWidth").value="";
  const vcmWidth=sys==="VCM"?vcmFilmWidths[coil]:null;
  const vcmOptions=vcmWidth?`<option value="${coil}" data-width="${vcmWidth}">${escapeHtml(filmLabels[coil]||coil.replaceAll("_"," "))} — ${fmt(vcmWidth,1)} mm</option>`:"";
  $("vcmFilmType").innerHTML='<option value="">Choisir un VCM-Film</option>'+vcmOptions;
  $("vcmFilmBlock").hidden=sys!=="VCM";
  $("vcmFilmType").value="";$("vcmFilmWidth").value="";
}

async function addPaintType(layerCode){
  if(profile?.role!=="ADMIN"){notify("Ajout réservé à ADMIN.");return;}
  const name=prompt(`Nom du nouveau type de peinture — ${layerNames[layerCode]||layerCode}`);if(!name||!name.trim())return;
  const clean=name.trim();
  try{
    const {data,error}=await db.from("paint_products").insert({paint_code:`NEW-${$("system").value}-${layerCode}-${Date.now()}`,paint_name:clean,coating_system:$("system").value,layer_code:layerCode,active:true,created_by:session.user.id}).select("id,paint_code,paint_name,layer_code,coating_system,active").single();
    if(error)throw error;
    notify("Nouveau type de peinture ajouté.");const sel=$("paint-"+layerCode);if(sel)sel.value=data.id;await loadPaintBarrels();
  }catch(e){notify(`Ajout impossible : ${e.message||e}`);}
}
function showTab(tab){
  for(const name of ["production","records","chemicals"]){
    $(`${name}Panel`).hidden=name!==tab;
    document.querySelector(`[data-tab="${name}"]`)?.classList.toggle("active",name===tab);
  }
  if(tab==="records") loadRecords();
  if(tab==="chemicals") loadChemicals();
  if(tab==="production" && profile?.role==="ADMIN"){
    loadUsers();
    loadDailyPaintForm();
    loadPaintBarrelManagement();
    loadChemicalConsumptionHistory();
  }
}
function initForm(){
  updateCoilOptions();
  $("recordDate").value=localDate();
  $("thickness").value="0.45";
  $("coilType").addEventListener("change",()=>{updateWeight();updateFilmOptions();});
  $("coilOrigin").addEventListener("change",()=>{$("thickness").value="0.45";updateWeight();});
  $("peFilmType").addEventListener("change",()=>{$("peFilmWidth").value=$("peFilmType").selectedOptions[0]?.dataset.width||"";});
  $("vcmFilmType").addEventListener("change",()=>{$("vcmFilmWidth").value=$("vcmFilmType").selectedOptions[0]?.dataset.width||"";});
  ["thickness","length","preWeight"].forEach(id=>$(id).addEventListener("input",updateWeight));
  $("system").addEventListener("change",()=>{updateCoilOptions();renderLayers();updateFilmOptions();if(profile)loadPaintBarrels();});
  renderLayers();
  updateFilmOptions();
}
async function login(){
  $("loginError").textContent="";
  const code=$("accessCode").value.trim().toUpperCase();
  if(code.length<8){$("loginError").textContent="Veuillez saisir le code d’accès valide.";return;}
  $("loginBtn").disabled=true; $("loginBtn").textContent="Connexion…";
  try{
    // Each phone gets its own anonymous Supabase Auth identity.
    let {data:current,error:sessionError}=await db.auth.getSession();
    if(sessionError) throw sessionError;
    if(!current.session){
      const {data:anonData,error:anonError}=await db.auth.signInAnonymously();
      if(anonError) throw anonError;
      if(!anonData.session) throw new Error("Impossible de créer une session anonyme.");
    }
    const {data,error}=await db.functions.invoke("device-access",{
      body:{code,display_name:"Compte"}
    });
    if(error) throw error;
    if(!data?.success) throw new Error(data?.error||"Accès refusé.");
    const {data:authData,error:authError}=await db.auth.getSession();
    if(authError) throw authError;
    session=authData.session;
    if(!session) throw new Error("Session Supabase introuvable.");
    if(data.user_id!==session.user.id) throw new Error("La session ne correspond pas au compte autorisé. Déconnectez-vous puis réessayez.");
    if(!["ADMIN","OPERATOR","VIEWER"].includes(data.role)) throw new Error("Le serveur a renvoyé un rôle invalide.");
    // Use the verified role returned by device-access immediately. This avoids
    // showing a stale cached profile after switching from OPERATOR to ADMIN.
    profile={user_id:data.user_id,display_name:data.display_name,role:data.role,active:true};
    $("accessCode").value="";
    await enterApp();
  }catch(e){$("loginError").textContent=e.message||"Échec de connexion.";}
  finally{$("loginBtn").disabled=false;$("loginBtn").textContent="Se connecter";}
}
async function loadProfile(){
  const {data,error}=await db.from("app_profiles").select("user_id,display_name,role,active").eq("user_id",session.user.id).single();
  if(error) throw error;
  if(!data.active) throw new Error("Ce compte a été désactivé.");
  profile=data;
}
async function enterApp(){
  $("loginView").hidden=true;$("appView").hidden=false;
  $("welcomeName").textContent=`Bonjour, ${profile.display_name}`;
  const isAdmin=profile.role==="ADMIN";
  $("roleLabel").textContent=isAdmin?"Rôle: ADMIN":"";
  $("roleLabel").hidden=!isAdmin;
  $("adminPanel").hidden=!isAdmin;
  showTab("production");
  $("chemicalProductAdmin").hidden=!isAdmin;
  $("chemicalNonconformingAdmin").hidden=!isAdmin;
  $("chemicalBarrelForm").querySelectorAll("input,select,button").forEach(el=>el.disabled=profile.role==="VIEWER");
  $("chemicalOutForm").querySelectorAll("input,select,button").forEach(el=>el.disabled=profile.role==="VIEWER");
  $("chemicalCountForm").querySelectorAll("input,select,button").forEach(el=>el.disabled=profile.role==="VIEWER");
  $("chemicalNonconformingForm").querySelectorAll("input,select,button").forEach(el=>el.disabled=profile.role!=="ADMIN");
  $("saveBtn").disabled=profile.role==="VIEWER";
  $("saveBtn").title=profile.role==="VIEWER"?"Mode consultation": "";
  document.querySelectorAll(".layer-card input, #productionForm input, #productionForm select").forEach(el=>el.disabled=profile.role==="VIEWER");
  if(profile.role==="VIEWER") $("saveBtn").textContent="Consultation uniquement";
  else $("saveBtn").textContent="Enregistrer dans le cloud";
  document.querySelectorAll(".add-paint").forEach(b=>b.hidden=profile.role!=="ADMIN");
  await loadRecords(); await loadPaintBarrels(); subscribeRealtime(); setConnection(true);
}
async function loadRecords(){
  const {data,error}=await db.from("production_records").select("id,record_date,production_ref,coating_system,coil_type_code,width_mm,thickness_mm,length_m,weight_before_paint_kg,pre_weight_kg,production_weight_kg,weight_after_paint_kg,notes,production_extras,updated_at,created_at").order("record_date",{ascending:false}).limit(100);
  if(error){notify(error.message);return;}
  const records=data||[], ids=records.map(r=>r.id);
  let layers=[];
  if(ids.length){
    const {data:layerRows,error:layerError}=await db.from("layer_consumptions").select("production_record_id,layer_code,consumption_kg,coefficient,paint_barrel_id,chemical_barrel_id").in("production_record_id",ids);
    if(layerError){notify(`Détails des couches indisponibles : ${layerError.message}`);}else layers=layerRows||[];
  }
  const paintBarrelIds=[...new Set(layers.map(x=>x.paint_barrel_id).filter(Boolean))];
  const chemicalBarrelIds=[...new Set(layers.map(x=>x.chemical_barrel_id).filter(Boolean))];
  const [paintBarrelRes,chemicalBarrelRes]=await Promise.all([
    paintBarrelIds.length?db.from("paint_barrels").select("id,barrel_number,paint_product_id").in("id",paintBarrelIds):Promise.resolve({data:[],error:null}),
    chemicalBarrelIds.length?db.from("chemical_barrels").select("id,barrel_number,product_id").in("id",chemicalBarrelIds):Promise.resolve({data:[],error:null})
  ]);
  const paintProductIds=[...new Set((paintBarrelRes.data||[]).map(x=>x.paint_product_id))];
  const chemicalProductIds=[...new Set((chemicalBarrelRes.data||[]).map(x=>x.product_id))];
  const [paintProductRes,chemicalProductRes]=await Promise.all([
    paintProductIds.length?db.from("paint_products").select("id,paint_code,paint_name").in("id",paintProductIds):Promise.resolve({data:[],error:null}),
    chemicalProductIds.length?db.from("chemical_products").select("id,product_code,product_name").in("id",chemicalProductIds):Promise.resolve({data:[],error:null})
  ]);
  const paintBarrelMap=new Map((paintBarrelRes.data||[]).map(x=>[x.id,x]));
  const chemicalBarrelMap=new Map((chemicalBarrelRes.data||[]).map(x=>[x.id,x]));
  const paintProductMap=new Map((paintProductRes.data||[]).map(x=>[x.id,x]));
  const chemicalProductMap=new Map((chemicalProductRes.data||[]).map(x=>[x.id,x]));
  const layersByRecord=new Map();
  for(const layer of layers){
    let label="Peinture";
    if(layer.chemical_barrel_id){const b=chemicalBarrelMap.get(layer.chemical_barrel_id),p=chemicalProductMap.get(b?.product_id);label=`${p?.product_code||p?.product_name||"Matière chimique"} · baril ${b?.barrel_number||"—"}`;}
    else if(layer.paint_barrel_id){const b=paintBarrelMap.get(layer.paint_barrel_id),p=paintProductMap.get(b?.paint_product_id);label=`${p?.paint_code||p?.paint_name||"Peinture"} · baril ${b?.barrel_number||"—"}`;}
    const list=layersByRecord.get(layer.production_record_id)||[];
    list.push({...layer,display_label:label});layersByRecord.set(layer.production_record_id,list);
  }
  recordsCache=records.map(r=>({...r,layers:(layersByRecord.get(r.id)||[]).sort((a,b)=>a.layer_code.localeCompare(b.layer_code))}));
  renderRecords();
}
function renderRecords(){
  const body=$("recordsBody");
  if(!recordsCache.length){body.innerHTML='<tr><td colspan="5">Aucun enregistrement.</td></tr>';return;}
  body.innerHTML=recordsCache.map(r=>{
    const recordCoils=coilTypesBySystem[r.coating_system]||[];
    const coil=recordCoils.find(c=>c[0]===r.coil_type_code)?.[1]||r.coil_type_code;
    const canEdit=profile?.role==="ADMIN";
    const ex=r.production_extras||{};
    const filmName=(code,system)=>{if(!code)return "—";const aliases={CABINE_410:"Cabine 410",CABINE_420:"Cabine 420",PORTE_410:"Porte 410",PORTE_420:"Porte 420",CABINE_CF_255:"Cabine CF 255"};return aliases[code]||(coilTypesBySystem[system]||[]).find(c=>c[0]===code)?.[1]||code;};
    const extrasText=[ex.coil_origin?`Bobine: ${ex.coil_origin} · ${fmt(ex.coil_thickness_mm||0.45,2)} mm`:"",ex.protection_status?`Protection: ${ex.protection_status==="CONFORME"?"Conforme":"Non conforme"}`:"",ex.pe_film_length_m>0?`PE-Film: ${filmName(ex.pe_film_type,r.coating_system)} · ${ex.pe_film_width_mm||"—"} mm · ${fmt(ex.pe_film_length_m,2)} m`:"",ex.vcm_film_length_m>0?`VCM-Film: ${filmName(ex.vcm_film_type,"VCM")} · ${ex.vcm_film_width_mm||"—"} mm · ${fmt(ex.vcm_film_length_m,2)} m`:"",ex.process_waste_kg>0?`Déchet: ${fmt(ex.process_waste_kg)} kg`:"",ex.prelaque_kg>0?`Prélaqué: ${fmt(ex.prelaque_kg)} kg`:"",ex.raw_material_kg>0?`MP: ${fmt(ex.raw_material_kg)} kg`:""].filter(Boolean).join(" · ");
    const layerText=(r.layers||[]).map(l=>`${layerNames[l.layer_code]||l.layer_code}: ${fmt(l.consumption_kg)} kg · C=${fmt(l.coefficient||0,6)} (${l.display_label})`).join(" | ");
    return `<tr><td>${r.record_date}</td><td>${escapeHtml(r.coating_system)}</td><td>${escapeHtml(coil)}<small class="record-extra">${escapeHtml([extrasText,layerText].filter(Boolean).join(" · "))}</small></td><td>${fmt(r.weight_after_paint_kg??r.production_weight_kg??(Number(r.weight_before_paint_kg)+Number(r.pre_weight_kg||0)))} kg</td><td>${canEdit?`<button class="ghost" data-edit-record="${r.id}">Modifier système / bobine</button> <button class="ghost" data-edit-layers="${r.id}">Modifier couches</button> <button class="danger" data-delete="${r.id}">Supprimer</button>`:"—"}</td></tr>`;
  }).join("");
  body.querySelectorAll("[data-edit-record]").forEach(btn=>btn.addEventListener("click",()=>editProductionRecord(btn.dataset.editRecord)));
  body.querySelectorAll("[data-edit-layers]").forEach(btn=>btn.addEventListener("click",()=>editProductionLayers(btn.dataset.editLayers)));
  body.querySelectorAll("[data-delete]").forEach(btn=>btn.addEventListener("click",()=>deleteRecord(btn.dataset.delete)));
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function saveProduction(event){
  event.preventDefault();
  if(profile.role==="VIEWER") return;
  const base=baseWeight(), pre=Number($("preWeight").value)||0;
  if(!base||base+pre<=0){notify("Dimensions invalides.");return;}
  const peLength=Number($("peFilmLength").value||0),vcmLength=Number($("vcmFilmLength").value||0);
  const extraQuantities=[peLength,vcmLength,Number($("processWaste").value||0),Number($("prelaqueQty").value||0),Number($("rawMaterialQty").value||0)];
  if(extraQuantities.some(v=>!Number.isFinite(v)||v<0)){notify("Les quantités de films, déchets et matières doivent être positives ou nulles.");return;}
  if(peLength>0&&!$("peFilmType").value){notify("Choisissez le type de PE-Film avant de saisir une longueur consommée.");return;}
  if($("system").value==="VCM"&&vcmLength>0&&!$("vcmFilmType").value){notify("Choisissez le type de VCM-Film avant de saisir une longueur consommée.");return;}
  const inputs=[...$("layers").querySelectorAll('input[data-layer]')].filter(x=>Number(x.value)>0);
  const layers=[];
  for(const x of inputs){
    const code=x.dataset.layer,choice=$("paint-"+code)?.value||"",barrel=$("barrel-"+code)?.value||"";
    if(!choice||choice.startsWith("preset:")){notify(`Sélectionnez un type de peinture enregistré pour ${layerNames[code]}.`);return;}
    if(!barrel){notify(`Aucun baril disponible automatiquement pour ${layerNames[code]}. Vérifiez le stock de cette matière.`);return;}
    const chemical=choice.startsWith("chemical:");
    if(chemical&&code!=="BACK"){notify("EP-3189 est autorisé uniquement pour la couche Back.");return;}
    layers.push({layer_code:code,consumption_kg:Number(x.value),paint_barrel_id:chemical?null:barrel,chemical_barrel_id:chemical?barrel:null});
  }
  const extras={coil_origin:$("coilOrigin").value,coil_thickness_mm:Number($("thickness").value)||0.45,protection_status:$("protectionStatus").value,process_waste_kg:Number($("processWaste").value||0),prelaque_kg:Number($("prelaqueQty").value||0),raw_material_kg:Number($("rawMaterialQty").value||0),pe_film_type:$("peFilmType").value||null,pe_film_width_mm:Number($("peFilmWidth").value||0)||null,pe_film_length_m:peLength,vcm_film_type:$("vcmFilmType").value||null,vcm_film_width_mm:Number($("vcmFilmWidth").value||0)||null,vcm_film_length_m:$("system").value==="VCM"?vcmLength:0};
  const afterPaintWeight=Number(productionWeight().toFixed(3));
  const row={record_date:$("recordDate").value,production_ref:null,
    coating_system:$("system").value,coil_type_code:activeCoil()[0],thickness_mm:Number($("thickness").value),length_m:Number($("length").value),
    pre_weight_kg:Number(pre.toFixed(3)),diluant_kg:0,weight_after_paint_kg:afterPaintWeight,notes:null,production_extras:extras};
  $("saveBtn").disabled=true;
  try{
    const {data:recordId,error}=await db.rpc("save_production_with_consumption",{p_record:row,p_layers:layers});
    if(error)throw error;
    notify("Production, consommations et films enregistrés dans une seule transaction.");
    $("productionForm").reset();$("recordDate").value=localDate();$("thickness").value="0.45";$("processWaste").value="0";$("prelaqueQty").value="0";$("rawMaterialQty").value="0";$("peFilmLength").value="0";$("vcmFilmLength").value="0";renderLayers();updateWeight();updateFilmOptions();
    await Promise.all([loadRecords(),loadPaintBarrels(),loadChemicals(),...(profile?.role==="ADMIN"?[loadChemicalConsumptionHistory(),loadPaintBarrelManagement()]:[])]);
  }catch(e){notify(`Erreur : ${e.message||e}`);}
  finally{$("saveBtn").disabled=profile.role==="VIEWER";}
}

async function editProductionRecord(id){
  if(profile?.role!=="ADMIN")return;
  const record=recordsCache.find(r=>r.id===id); if(!record)return;
  const systems=["PCM","PRINTING","VCM"];
  const systemText=systems.map((x,i)=>`${i+1}. ${x}`).join("\n");
  const systemChoice=prompt(`Choisir le système :\n${systemText}`,String(Math.max(0,systems.indexOf(record.coating_system))+1));
  if(systemChoice===null)return;
  const system=systems[Number(systemChoice)-1];
  if(!system){notify("Système invalide.");return;}
  const coils=coilTypesBySystem[system];
  const coilText=coils.map((x,i)=>`${i+1}. ${x[1]} (${x[2]} mm)`).join("\n");
  const currentIndex=coils.findIndex(x=>x[0]===record.coil_type_code);
  const coilChoice=prompt(`Choisir la bobine :\n${coilText}`,String(currentIndex>=0?currentIndex+1:1));
  if(coilChoice===null)return;
  const coil=coils[Number(coilChoice)-1];
  if(!coil){notify("Bobine invalide.");return;}
  if(!confirm(`Confirmer le changement vers ${system} — ${coil[1]} (${coil[2]} mm) ?`))return;
  try{
    const {error}=await db.rpc("admin_update_production_coil",{p_record_id:id,p_coating_system:system,p_coil_type_code:coil[0]});
    if(error)throw error;
    notify("Système et type de bobine modifiés. Historique mis à jour."); await loadRecords();
  }catch(e){notify(`Modification impossible : ${e.message||e}`);}
}
async function editProductionLayers(id){
  if(profile?.role!=="ADMIN")return;
  const record=recordsCache.find(r=>r.id===id);if(!record)return;
  const allowed=Object.keys(layersBySystem[record.coating_system]||{});
  if(!allowed.length){notify("Système de production non reconnu.");return;}
  try{
    const [{data:paintProducts,error:productError},{data:paintBarrels,error:barrelError},{data:paintMoves,error:moveError},{data:chemicalProducts,error:chemicalProductError},{data:chemicalBarrels,error:chemicalBarrelError}]=await Promise.all([
      db.from("paint_products").select("id,paint_code,paint_name,layer_code,coating_system,active").eq("coating_system",record.coating_system),
      db.from("paint_barrels").select("id,paint_product_id,barrel_number,lot_number,net_weight_kg").order("created_at",{ascending:false}),
      fetchAllRows(()=>db.from("paint_barrel_movements").select("id,barrel_id,consumption_kg,movement_type,production_record_id,layer_code").order("created_at",{ascending:false}).order("id")).then(data=>({data,error:null})).catch(error=>({data:null,error})),
      db.from("chemical_products").select("id,product_code,product_name,active,unit").eq("product_code","EP-3189").eq("active",true),
      db.from("chemical_barrel_stock").select("barrel_id,product_id,barrel_number,remaining_quantity_kg,material_status")
    ]);
    if(productError||barrelError||moveError||chemicalProductError||chemicalBarrelError)throw productError||barrelError||moveError||chemicalProductError||chemicalBarrelError;
    const products=new Map((paintProducts||[]).map(p=>[p.id,p]));
    const paintRemain=new Map((paintBarrels||[]).map(b=>[b.id,Number(b.net_weight_kg)||0]));
    for(const m of paintMoves||[]){const q=Number(m.consumption_kg)||0;paintRemain.set(m.barrel_id,(paintRemain.get(m.barrel_id)||0)+(m.movement_type==="REVERSAL"?q:-q));}
    const oldByLayer=new Map((record.layers||[]).map(x=>[x.layer_code,x]));
    const ep=(chemicalProducts||[]).find(x=>x.unit==="kg");
    const payload=[];
    for(const code of allowed){
      const old=oldByLayer.get(code);
      const options=[];
      if(code==="BACK"&&ep){
        for(const b of chemicalBarrels||[]){
          if(b.product_id!==ep.id||b.material_status==="NON_CONFORME")continue;
          const available=Number(b.remaining_quantity_kg||0)+(old?.chemical_barrel_id===b.barrel_id?Number(old.consumption_kg||0):0);
          if(available>0)options.push({kind:"chemical",barrelId:b.barrel_id,label:`${ep.product_name} EP-3189 · Baril ${b.barrel_number||"—"} · disponible ${fmt(available)} kg`,available});
        }
      }
      for(const b of paintBarrels||[]){
        const p=products.get(b.paint_product_id);if(!p?.active||p.layer_code!==code)continue;
        const available=(paintRemain.get(b.id)||0)+(old?.paint_barrel_id===b.id?Number(old.consumption_kg||0):0);
        if(available>0)options.push({kind:"paint",barrelId:b.id,label:`${p.paint_code||p.paint_name} · ${p.paint_name} · Baril ${b.barrel_number} · disponible ${fmt(available)} kg`,available});
      }
      if(!options.length){
        if(old&&!confirm(`Aucun baril utilisable n’est disponible pour ${layerNames[code]||code}. Voulez-vous retirer cette couche et restaurer son ancienne consommation ?`))return;
        continue;
      }
      const optionLines=["0. Supprimer / ne pas consommer",...options.map((x,i)=>`${i+1}. ${x.label}`)].join("\n");
      const oldIndex=options.findIndex(x=>x.barrelId===(old?.chemical_barrel_id||old?.paint_barrel_id));
      const answer=prompt(`Modifier ${layerNames[code]||code} — choisissez le type et le baril :\n${optionLines}`,String(oldIndex>=0?oldIndex+1:1));
      if(answer===null)return;
      const choice=Number(answer);
      if(!Number.isInteger(choice)||choice<0||choice>options.length){notify("Choix de baril invalide. Aucune modification effectuée.");return;}
      if(choice===0)continue;
      const selected=options[choice-1];
      const quantityText=prompt(`Quantité consommée pour ${layerNames[code]||code} (kg) — disponible ${fmt(selected.available)} kg :`,String(old?.consumption_kg??0));
      if(quantityText===null)return;
      const quantity=Number(String(quantityText).trim().replace(",","."));
      if(!Number.isFinite(quantity)||quantity<0||quantity>selected.available+0.0005){notify(`Quantité invalide ou supérieure au stock disponible (${fmt(selected.available)} kg).`);return;}
      if(quantity===0)continue;
      payload.push({layer_code:code,consumption_kg:Number(quantity.toFixed(3)),paint_barrel_id:selected.kind==="paint"?selected.barrelId:null,chemical_barrel_id:selected.kind==="chemical"?selected.barrelId:null});
    }
    if(!confirm("Confirmer la modification des couches ? Les mouvements d’origine seront conservés et des mouvements inverses / nouveaux seront ajoutés au journal."))return;
    const {error}=await db.rpc("admin_update_production_layers",{p_record_id:id,p_layers:payload});
    if(error)throw error;
    notify("Couches et consommations mises à jour. Les mouvements précédents restent dans l’historique.");
    await Promise.all([loadRecords(),loadPaintBarrels(),loadChemicals(),loadChemicalConsumptionHistory()]);
  }catch(e){notify(`Modification des couches impossible : ${e.message||e}`);}
}

async function deleteRecord(id){
  if(profile?.role!=="ADMIN")return;
  const record=recordsCache.find(r=>r.id===id);
  if(!confirm(`Supprimer définitivement l’enregistrement ${record?.production_ref||id} et ses consommations associées ?\nUne trace complète sera conservée dans le journal d’audit.`))return;
  try{
    const {error}=await db.rpc("admin_delete_production_record",{p_record_id:id});
    if(error)throw error;
    notify("Enregistrement supprimé. Le journal d’audit a été conservé."); await Promise.all([loadRecords(),loadPaintBarrels(),loadChemicals(),loadChemicalConsumptionHistory()]);
  }catch(e){notify(`Suppression impossible : ${e.message||e}`);}
}
async function loadPaintBarrels(){
  const selects=[...document.querySelectorAll("select[data-barrel]")]; if(!selects.length)return;
  const system=$("system").value;
  const [{data:products,error:pe},{data:barrels,error:be},{data:moves,error:me},{data:chemicalProducts,error:ce},{data:chemicalBarrels,error:cbe}]=await Promise.all([
    db.from("paint_products").select("id,paint_code,paint_name,layer_code,coating_system,active").eq("active",true).eq("coating_system",system).order("paint_name"),
    db.from("paint_barrels").select("id,paint_product_id,barrel_number,lot_number,net_weight_kg").order("created_at",{ascending:false}),
    db.from("paint_barrel_movements").select("barrel_id,consumption_kg,movement_type"),
    db.from("chemical_products").select("id,product_code,product_name,active,unit").eq("active",true).eq("product_code","EP-3189"),
    db.from("chemical_barrel_stock").select("barrel_id,product_id,barrel_number,remaining_quantity_kg,material_status").gt("remaining_quantity_kg",0)
  ]);
  if(pe||be||me||ce||cbe){notify(`Chargement des barils impossible : ${(pe||be||me||ce||cbe).message}`);return;}
  const productMap=new Map((products||[]).map(x=>[x.id,x]));
  const remain=new Map((barrels||[]).map(b=>[b.id,Number(b.net_weight_kg)||0]));
  for(const m of moves||[]){const q=Number(m.consumption_kg)||0;remain.set(m.barrel_id,(remain.get(m.barrel_id)||0)-(m.movement_type==="REVERSAL"?-q:q));}
  const epProduct=(chemicalProducts||[]).find(p=>p.product_code==="EP-3189"&&p.unit==="kg");
  const epBarrels=(chemicalBarrels||[]).filter(b=>epProduct&&b.product_id===epProduct.id&&b.material_status!=="NON_CONFORME");
  for(const code of Object.keys(layersBySystem[system]||{})){
    const paintSel=$("paint-"+code),barrelSel=$("barrel-"+code);if(!paintSel)continue;
    const oldPaint=paintSel.value,oldBarrel=barrelSel?.value||"";
    const matching=(products||[]).filter(p=>p.layer_code===code && !(code==="BACK" && (/EP-3189/i.test(p.paint_code||"") || /modif.{0,8}epoxy.{0,8}paint/i.test(p.paint_name||""))));
    const presets=paintCatalog[system]?.[code]||[];
    const opts=matching.map(p=>`<option value="${p.id}">${escapeHtml(p.paint_name)}</option>`).join("");
    const chemicalOption=(code==="BACK"&&epProduct)?`<option value="chemical:${epProduct.id}">${escapeHtml(epProduct.product_name)} (EP-3189)</option>`:"";
    const missing=presets.filter(n=>!(code==="BACK"&&/EP-3189/i.test(n))&&!matching.some(p=>p.paint_name.toLowerCase()===n.toLowerCase()||p.paint_code.toLowerCase()===n.toLowerCase())).map(n=>`<option value="preset:${escapeHtml(n)}">${escapeHtml(n)} (à enregistrer dans le catalogue)</option>`).join("");
    paintSel.innerHTML='<option value="">Choisir un type de peinture</option>'+opts+chemicalOption+missing;
    if(oldPaint&&paintSel.querySelector(`option[value="${CSS.escape(oldPaint)}"]`))paintSel.value=oldPaint;
    const chosen=paintSel.value;
    if(barrelSel){
      let barrelOpts="",available=[];
      if(chosen.startsWith("chemical:")&&code==="BACK"){
        available=epBarrels.filter(b=>Number(b.remaining_quantity_kg)>=Math.max(0,Number($("layer-"+code)?.value)||0));
        barrelOpts=available.map(b=>`<option value="${b.barrel_id}">${escapeHtml(epProduct.product_name)} · ${escapeHtml(b.barrel_number||"—")} · ${fmt(b.remaining_quantity_kg)} kg</option>`).join("");
      }else{
        const selectedProduct=productMap.get(chosen);
        available=(barrels||[]).filter(b=>{const pr=productMap.get(b.paint_product_id);return pr&&pr.layer_code===code&&(!selectedProduct||pr.id===selectedProduct.id)&&(remain.get(b.id)||0)>=Math.max(0,Number($("layer-"+code)?.value)||0);});
        barrelOpts=available.map(b=>{const pr=productMap.get(b.paint_product_id);return `<option value="${b.id}">${escapeHtml(pr.paint_name)} · ${escapeHtml(b.barrel_number)} · ${fmt(remain.get(b.id))} kg</option>`;}).join("");
      }
      barrelSel.innerHTML='<option value="">Choisir un baril</option>'+barrelOpts;
      if(oldBarrel&&barrelSel.querySelector(`option[value="${CSS.escape(oldBarrel)}"]`))barrelSel.value=oldBarrel;
      else if(barrelSel.classList.contains('auto-barrel')&&available.length)barrelSel.value=available[0].barrel_id||available[0].id;
    }
  }
  document.querySelectorAll(".add-paint").forEach(b=>b.hidden=profile?.role!=="ADMIN");
}



const dailyLayersBySystem={PCM:["BACK","PRIMER","FINISH"],PRINTING:["BACK","PRIMER","FINISH","INK"],VCM:["BACK","FINISH"]};
function renderDailyPaintLayers(products=[],stockMap=new Map()){
  const system=$("dailySystem").value, codes=dailyLayersBySystem[system]||dailyLayersBySystem.PCM;
  const activeProducts=products.filter(p=>p.active&&p.unit==="kg");
  const norm=v=>String(v||"").toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"");
  $("dailyPaintLayers").innerHTML=codes.map(code=>{
    const allowed=paintCatalog[system]?.[code]||[];
    const matching=activeProducts.filter(p=>allowed.some(name=>{
      const wanted=norm(name), haystack=norm(`${p.product_code||""} ${p.product_name||""}`);
      return wanted&&haystack.includes(wanted) || (wanted&&wanted.includes(norm(p.product_code))&&norm(p.product_code).length>=4);
    }));
    const options=matching.map(p=>`<option value="${p.id}">${escapeHtml(p.product_code||"")} ${escapeHtml(p.product_name)} · Stock ${fmt(stockMap.get(p.id)||0)} kg</option>`).join("");
    const empty=matching.length?"":'<option value="" disabled>Aucun produit correspondant dans le stock chimique</option>';
    return `<div class="daily-layer-card"><h4>${layerNames[code]||code}</h4><label for="dailyProduct-${code}">Peinture — Matière chimique *</label><select id="dailyProduct-${code}" data-daily-product="${code}"><option value="">Choisir la matière peinture</option>${empty}${options}</select><label for="dailyQty-${code}">Consommation (kg)</label><input id="dailyQty-${code}" data-daily-qty="${code}" type="number" min="0" step="0.001" placeholder="0.000"><div class="daily-coeff" id="dailyCoeff-${code}">Coefficient : —</div></div>`;
  }).join("");
  $("dailyPaintLayers").querySelectorAll("[data-daily-qty]").forEach(el=>el.addEventListener("input",updateDailyCoefficients));
  $("dailyProductionWeight").oninput=updateDailyCoefficients;
  updateDailyCoefficients();
}
function updateDailyCoefficients(){
  const weight=Number($("dailyProductionWeight").value)||0;let total=0;
  document.querySelectorAll("[data-daily-qty]").forEach(el=>{const code=el.dataset.dailyQty,qty=Number(el.value)||0,coeff=weight>0&&qty>0?qty/weight:null;if(coeff!==null)total+=coeff;const out=$("dailyCoeff-"+code);if(out)out.textContent=coeff===null?"Coefficient : —":`Coefficient : ${fmt(coeff,6)}`;});
  $("dailyCoefficientSummary").textContent=weight>0?`Somme des coefficients saisis : ${fmt(total,6)} kg/kg`:"Saisissez le poids de production pour calculer les coefficients.";
}
async function loadDailyPaintForm(){
  if(profile?.role!=="ADMIN")return;
  if(!$("dailyDate").value)$("dailyDate").value=localDate();
  const [{data:chemicals,error:chemError},{data:chemicalStocks,error:stockError}]=await Promise.all([
    db.from("chemical_products").select("id,product_code,product_name,unit,active").eq("active",true).order("product_name"),
    db.from("chemical_product_stock").select("product_id,current_stock")
  ]);
  if(chemError||stockError){notify(`Chargement du formulaire impossible : ${(chemError||stockError).message}`);return;}
  const stockMap=new Map((chemicalStocks||[]).map(x=>[x.product_id,Number(x.current_stock)||0]));
  renderDailyPaintLayers(chemicals||[],stockMap);
  $("dailyDiluantProduct").innerHTML='<option value="">Choisir la matière Diluant</option>'+(chemicals||[]).filter(c=>c.unit==="kg").map(c=>`<option value="${c.id}">${escapeHtml(c.product_code||"")} ${escapeHtml(c.product_name)} · Stock ${fmt(stockMap.get(c.id)||0)} kg</option>`).join("");
  await loadDailyPaintHistory();
}
async function saveDailyPaintConsumption(event){
  event.preventDefault();
  if(profile?.role!=="ADMIN"){notify("Réservé à ADMIN.");return;}
  const system=$("dailySystem").value,weight=Number($("dailyProductionWeight").value),layers=[];
  for(const code of (dailyLayersBySystem[system]||[])){
    const qty=Number((Number($("dailyQty-"+code)?.value||0)).toFixed(3)),productId=$("dailyProduct-"+code)?.value||"";
    if(qty>0){if(!productId){notify(`Choisissez la matière peinture de la couche ${layerNames[code]}.`);return;}layers.push({layer_code:code,chemical_product_id:productId,consumption_kg:qty});}
  }
  if(!(weight>0)||!layers.length){notify("Saisissez le poids de production et au moins une quantité de peinture.");return;}
  const diluantChemist=Number((Number($("dailyDiluantChemist").value||0)).toFixed(3)),diluantRollers=Number((Number($("dailyDiluantRollers").value||0)).toFixed(3)),diluantPumps=Number((Number($("dailyDiluantPumps").value||0)).toFixed(3)),diluantQty=Number((diluantChemist+diluantRollers+diluantPumps).toFixed(3)),diluantProduct=$("dailyDiluantProduct").value||null;
  $("dailyDiluantTotal").value=diluantQty.toFixed(3);
  if(diluantQty<0||(diluantQty>0&&!diluantProduct)){notify("Sélectionnez la matière Diluant pour déduire son stock.");return;}
  const btn=$("dailyPaintForm").querySelector('button[type="submit"]');btn.disabled=true;
  try{
    const payload={p_consumption_date:$("dailyDate").value,p_coating_system:system,p_production_weight_kg:weight,p_layers:layers,p_diluant_product_id:diluantProduct,p_diluant_kg:diluantQty,p_notes:$("dailyNotes").value.trim()||null,p_chemist_kg:diluantChemist,p_rouleaux_kg:diluantRollers,p_pompes_kg:diluantPumps};
    const rpcName=editingDailyConsumptionId?"admin_update_paint_daily_consumption":"save_paint_daily_consumption_with_split";
    const rpcArgs=editingDailyConsumptionId?{...payload,p_consumption_id:editingDailyConsumptionId}:payload;
    const {data,error}=await db.rpc(rpcName,rpcArgs);
    if(error)throw error;
    notify(editingDailyConsumptionId?"Consommation journalière modifiée. Les mouvements de stock ont été corrigés.":"Consommation journalière enregistrée dans l’historique.");
    resetDailyPaintEditor();
    await loadDailyPaintForm();await loadChemicals();await loadChemicalConsumptionHistory();
  }catch(e){notify(`Enregistrement impossible : ${e.message||e}`);}finally{btn.disabled=false;}
}
function resetDailyPaintEditor(){
  editingDailyConsumptionId=null;
  $("dailyPaintForm").reset();$("dailyDate").value=localDate();$("dailyDiluantChemist").value="0";$("dailyDiluantRollers").value="0";$("dailyDiluantPumps").value="0";$("dailyDiluantTotal").value="0";$("dailySystem").value="PCM";
  const submit=$("dailyPaintForm").querySelector('button[type="submit"]');if(submit)submit.textContent="Enregistrer la consommation du jour";
  const cancel=$("cancelDailyEdit");if(cancel)cancel.hidden=true;
  loadDailyPaintForm();
}
async function editDailyPaintConsumption(id){
  if(profile?.role!=="ADMIN")return;
  try{
    const [{data:head,error:headError},{data:lines,error:linesError}]=await Promise.all([
      db.from("paint_daily_consumptions").select("*").eq("id",id).single(),
      db.from("paint_daily_consumption_layers").select("layer_code,chemical_product_id,consumption_kg").eq("daily_consumption_id",id)
    ]);
    if(headError||linesError)throw headError||linesError;
    editingDailyConsumptionId=id;
    $("dailyDate").value=head.consumption_date;$("dailySystem").value=head.coating_system;
    await loadDailyPaintForm();
    $("dailyProductionWeight").value=head.production_weight_kg;
    for(const line of lines||[]){const sel=$("dailyProduct-"+line.layer_code),qty=$("dailyQty-"+line.layer_code);if(sel)sel.value=line.chemical_product_id||"";if(qty)qty.value=line.consumption_kg;}
    $("dailyDiluantProduct").value=head.diluant_product_id||"";
    $("dailyDiluantChemist").value=head.diluant_chemist_kg||0;$("dailyDiluantRollers").value=head.diluant_rouleaux_kg||0;$("dailyDiluantPumps").value=head.diluant_pompes_kg||0;$("dailyDiluantTotal").value=head.diluant_kg||0;$("dailyNotes").value=head.notes||"";
    updateDailyCoefficients();
    $("dailyPaintForm").querySelector('button[type="submit"]').textContent="Enregistrer les modifications";
    $("cancelDailyEdit").hidden=false;
    $("dailyPaintForm").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(e){notify(`Modification impossible : ${e.message||e}`);}
}
async function deleteDailyPaintConsumption(id){
  if(profile?.role!=="ADMIN")return;
  if(!confirm("Supprimer cette consommation journalière ? Les quantités seront réintégrées au stock par des mouvements correctifs, et l’action restera dans l’audit."))return;
  try{
    const {error}=await db.rpc("admin_delete_paint_daily_consumption",{p_consumption_id:id});
    if(error)throw error;
    notify("Consommation supprimée. Le stock a été corrigé et l’action auditée.");
    await loadDailyPaintHistory();await loadChemicals();await loadChemicalConsumptionHistory();
  }catch(e){notify(`Suppression impossible : ${e.message||e}`);}
}

async function loadDailyPaintHistory(){
  if(profile?.role!=="ADMIN")return;
  const body=$("dailyPaintHistoryBody");if(!body)return;body.innerHTML='<tr><td colspan="6">Chargement…</td></tr>';
  try{
    const filter=$("dailyHistoryDate").value;
    const heads=await fetchAllRows(()=>{let query=db.from("paint_daily_consumptions").select("id,consumption_date,coating_system,production_weight_kg,diluant_kg,diluant_product_id,diluant_chemist_kg,diluant_rouleaux_kg,diluant_pompes_kg,notes,created_at").order("consumption_date",{ascending:false}).order("created_at",{ascending:false}).order("id");if(filter)query=query.eq("consumption_date",filter);return query;});
    if(!heads?.length){body.innerHTML='<tr><td colspan="6">Aucun historique pour cette date.</td></tr>';return;}
    const ids=heads.map(h=>h.id),[{data:lines,error:lineError},{data:paints,error:paintError},{data:chemicals,error:chemError}]=await Promise.all([
      db.from("paint_daily_consumption_layers").select("daily_consumption_id,layer_code,paint_product_id,chemical_product_id,consumption_kg,coefficient").in("daily_consumption_id",ids),
      db.from("paint_products").select("id,paint_code,paint_name"),
      db.from("chemical_products").select("id,product_code,product_name")
    ]);
    if(lineError||paintError||chemError)throw lineError||paintError||chemError;
    const paintMap=new Map((paints||[]).map(p=>[p.id,p])),chemMap=new Map((chemicals||[]).map(c=>[c.id,c]));
    body.innerHTML=heads.map(h=>{
      const detail=(lines||[]).filter(l=>l.daily_consumption_id===h.id).sort((a,b)=>(dailyLayersBySystem[h.coating_system]||[]).indexOf(a.layer_code)-(dailyLayersBySystem[h.coating_system]||[]).indexOf(b.layer_code)).map(l=>{const p=paintMap.get(l.paint_product_id),chem=chemMap.get(l.chemical_product_id);const label=chem?.product_code||chem?.product_name||p?.paint_code||"—";return `<span class="daily-history-layer"><strong>${layerNames[l.layer_code]||l.layer_code}</strong> · ${fmt(l.consumption_kg)} kg · C=${fmt(l.coefficient,6)} <small>(${escapeHtml(label)})</small></span>`;}).join("");
      const chem=chemMap.get(h.diluant_product_id);const diluant=Number(h.diluant_kg)>0?`${fmt(h.diluant_kg)} kg · ${escapeHtml(chem?.product_name||"Diluant")}<small class="daily-history-layer">Chimiste ${fmt(h.diluant_chemist_kg||0)} · Rouleaux ${fmt(h.diluant_rouleaux_kg||0)} · Pompes ${fmt(h.diluant_pompes_kg||0)}</small>`:"—";
      const actions=profile?.role==="ADMIN"?`<button type="button" class="ghost" data-edit-daily-consumption="${h.id}">Modifier</button> <button type="button" class="danger" data-delete-daily-consumption="${h.id}">Supprimer</button>`:"—";
      return `<tr><td>${h.consumption_date}</td><td>${h.coating_system}</td><td>${fmt(h.production_weight_kg)} kg</td><td>${detail||"—"}</td><td>${diluant}</td><td>${actions}</td></tr>`;
    }).join("");
  }catch(e){body.innerHTML=`<tr><td colspan="6">${escapeHtml(e.message||String(e))}</td></tr>`;}
}


async function loadPaintBarrelManagement(){
  if(profile?.role!=="ADMIN")return;
  const body=$("paintBarrelManagementBody");if(!body)return;
  body.innerHTML='<tr><td colspan="8">Chargement…</td></tr>';
  try{
    const [productsRes,barrelsRes,movesRes]=await Promise.all([
      db.from("paint_products").select("id,paint_code,paint_name,coating_system,layer_code,active").order("paint_code"),
      db.from("paint_barrels").select("id,paint_product_id,barrel_number,lot_number,gross_weight_kg,tare_weight_kg,net_weight_kg,created_at").order("created_at",{ascending:false}),
      db.from("paint_barrel_movements").select("id,barrel_id,consumption_kg,movement_type")
    ]);
    if(productsRes.error||barrelsRes.error||movesRes.error)throw productsRes.error||barrelsRes.error||movesRes.error;
    const products=productsRes.data||[],barrels=barrelsRes.data||[],moves=movesRes.data||[];
    const usedIds=[...new Set(barrels.map(b=>b.id))];
    const layerRes=usedIds.length?await db.from("layer_consumptions").select("paint_barrel_id").in("paint_barrel_id",usedIds):{data:[],error:null};
    if(layerRes.error)throw layerRes.error;
    const usedByLayer=new Set((layerRes.data||[]).map(x=>x.paint_barrel_id));
    const productMap=new Map(products.map(p=>[p.id,p]));
    const select=$("paintBarrelProduct"),old=select.value;
    select.innerHTML='<option value="">Choisir une peinture</option>'+products.filter(p=>p.active).map(p=>`<option value="${p.id}">${escapeHtml(p.paint_code)} — ${escapeHtml(p.paint_name)} (${escapeHtml(p.coating_system)} / ${escapeHtml(p.layer_code)})</option>`).join("");
    if(old&&select.querySelector(`option[value="${CSS.escape(old)}"]`))select.value=old;
    body.innerHTML=barrels.map(b=>{
      const p=productMap.get(b.paint_product_id),barrelMoves=moves.filter(m=>m.barrel_id===b.id);
      const consumed=barrelMoves.reduce((sum,m)=>sum+(m.movement_type==="CONSUMPTION"?Number(m.consumption_kg):m.movement_type==="REVERSAL"?-Number(m.consumption_kg):0),0);
      const remaining=Number(b.net_weight_kg||0)-consumed,hasHistory=barrelMoves.length>0||usedByLayer.has(b.id);
      return `<tr><td>${escapeHtml(p?.paint_code||"—")}<small class="record-extra">${escapeHtml(p?.paint_name||"")}</small></td><td>${escapeHtml(p?.coating_system||"—")} / ${escapeHtml(p?.layer_code||"—")}</td><td>${escapeHtml(b.barrel_number)}</td><td>${escapeHtml(b.lot_number)}</td><td>${fmt(b.net_weight_kg)} kg</td><td>${fmt(consumed)} kg</td><td>${fmt(remaining)} kg</td><td><button type="button" class="ghost" data-edit-paint-barrel="${b.id}">Modifier</button> ${hasHistory?"—":`<button type="button" class="danger" data-delete-paint-barrel="${b.id}">Supprimer</button>`}</td></tr>`;
    }).join("")||'<tr><td colspan="8">Aucun baril de peinture enregistré.</td></tr>';
    body.querySelectorAll("[data-edit-paint-barrel]").forEach(btn=>btn.addEventListener("click",()=>editPaintBarrel(btn.dataset.editPaintBarrel,barrels.find(b=>b.id===btn.dataset.editPaintBarrel))));
    body.querySelectorAll("[data-delete-paint-barrel]").forEach(btn=>btn.addEventListener("click",()=>deletePaintBarrel(btn.dataset.deletePaintBarrel)));
  }catch(e){body.innerHTML=`<tr><td colspan="8">${escapeHtml(e.message||String(e))}</td></tr>`;}
}
async function savePaintBarrel(event){
  event.preventDefault();if(profile?.role!=="ADMIN")return;
  const productId=$("paintBarrelProduct").value,number=$("paintBarrelNumber").value.trim(),lot=$("paintBarrelLot").value.trim(),gross=Number($("paintBarrelGross").value),tare=Number($("paintBarrelTare").value);
  if(!productId||!number||!lot||!Number.isFinite(gross)||!Number.isFinite(tare)||gross<=tare||tare<0){notify("Vérifiez le produit, le numéro, le lot, le poids brut et la tare.");return;}
  try{
    const {error}=await db.rpc("admin_create_paint_barrel",{p_paint_product_id:productId,p_barrel_number:number,p_lot_number:lot,p_gross_weight_kg:Number(gross.toFixed(3)),p_tare_weight_kg:Number(tare.toFixed(3))});
    if(error)throw error;
    $("paintBarrelForm").reset();$("paintBarrelNet").value="0";
    notify("Baril de peinture ajouté.");await Promise.all([loadPaintBarrelManagement(),loadPaintBarrels()]);
  }catch(e){notify(`Ajout impossible : ${e.message||e}`);}
}
async function editPaintBarrel(id,barrel){
  if(profile?.role!=="ADMIN"||!barrel)return;
  const number=prompt("Numéro du baril :",barrel.barrel_number);if(number===null)return;
  const lot=prompt("Numéro de lot :",barrel.lot_number);if(lot===null)return;
  const gross=prompt("Poids brut (kg) — inchangé si le baril a déjà été consommé :",String(barrel.gross_weight_kg));if(gross===null)return;
  const tare=prompt("Tare (kg) — inchangée si le baril a déjà été consommé :",String(barrel.tare_weight_kg));if(tare===null)return;
  try{
    const {error}=await db.rpc("admin_update_paint_barrel",{p_barrel_id:id,p_barrel_number:number.trim(),p_lot_number:lot.trim(),p_gross_weight_kg:Number(String(gross).replace(",",".")),p_tare_weight_kg:Number(String(tare).replace(",","."))});
    if(error)throw error;notify("Informations du baril mises à jour.");await Promise.all([loadPaintBarrelManagement(),loadPaintBarrels()]);
  }catch(e){notify(`Modification impossible : ${e.message||e}`);}
}
async function deletePaintBarrel(id){
  if(profile?.role!=="ADMIN"||!confirm("Supprimer ce baril uniquement s’il n’a aucun historique de consommation ?"))return;
  try{const {error}=await db.rpc("admin_delete_paint_barrel",{p_barrel_id:id});if(error)throw error;notify("Baril supprimé.");await loadPaintBarrelManagement();}
  catch(e){notify(`Suppression impossible : ${e.message||e}`);}
}

async function loadChemicalConsumptionHistory(){
  if(profile?.role!=="ADMIN")return;
  const body=$("chemicalConsumptionHistoryBody");if(!body)return;
  body.innerHTML='<tr><td colspan="6">Chargement…</td></tr>';
  try{
    const [movements,reversals]=await Promise.all([
      fetchAllRows(()=>db.from("stock_movements").select("id,product_id,barrel_id,quantity,movement_date,reference,notes").eq("movement_type","OUT").order("movement_date",{ascending:false}).order("id",{ascending:false})),
      fetchAllRows(()=>db.from("stock_movements").select("id,reference").eq("movement_type","ADJUSTMENT").eq("adjustment_direction","INCREASE").like("reference","REVERSAL:%").order("id"))
    ]);
    const reversedIds=new Set((reversals||[]).map(x=>String(x.reference||"").startsWith("REVERSAL:")?String(x.reference).slice(9):null).filter(Boolean));
    const rows=movements||[];
    if(!rows.length){body.innerHTML='<tr><td colspan="6">Aucune consommation chimique enregistrée.</td></tr>';return;}
    const productIds=[...new Set(rows.map(m=>m.product_id))],barrelIds=[...new Set(rows.map(m=>m.barrel_id).filter(Boolean))];
    const [productsRes,barrelsRes]=await Promise.all([
      db.from("chemical_products").select("id,product_code,product_name,unit").in("id",productIds),
      barrelIds.length?db.from("chemical_barrels").select("id,barrel_number").in("id",barrelIds):Promise.resolve({data:[],error:null})
    ]);
    if(productsRes.error||barrelsRes.error)throw productsRes.error||barrelsRes.error;
    const products=new Map((productsRes.data||[]).map(p=>[p.id,p]));
    const barrels=new Map((barrelsRes.data||[]).map(b=>[b.id,b]));
    body.innerHTML=rows.map(m=>{
      const p=products.get(m.product_id),b=barrels.get(m.barrel_id),ref=String(m.reference||""),head=ref.split(":")[0],reversed=reversedIds.has(m.id);
      let source="Consommation manuelle",supported=!ref||head==="MANUAL-EDIT";
      if(head==="PROD"){source=`Production · ${escapeHtml(ref.split(":")[2]||"Back")}`;supported=true;}
      else if(head.startsWith("PAINT-DAILY-LAYER-")){source="Consommation journalière · couche";supported=true;}
      else if(head.startsWith("PAINT-DAILY-")){source="Consommation journalière · Diluant";supported=true;}
      else if(head!=="MANUAL-EDIT"&&ref){source=`Consommation manuelle · ${escapeHtml(ref)}${m.notes?` · ${escapeHtml(m.notes)}`:""}`;supported=true;}
      else if((!ref||head==="MANUAL-EDIT")&&m.notes){source+=` · ${escapeHtml(m.notes)}`;}
      if(b?.barrel_number)source+=` · Baril ${escapeHtml(b.barrel_number)}`;
      const action=reversed?'<span class="muted">Mouvement corrigé / annulé</span>':supported?`<button type="button" class="ghost" data-edit-chemical-consumption="${m.id}">Modifier</button> <button type="button" class="danger" data-delete-chemical-consumption="${m.id}">Supprimer</button>`:"—";
      return `<tr class="${reversed?"muted-row":""}"><td>${escapeHtml(m.movement_date||"—")}</td><td><strong>${escapeHtml(p?.product_name||p?.product_code||"Matière inconnue")}</strong><small class="record-extra">${escapeHtml(p?.product_code||"")}</small></td><td>${fmt(m.quantity)}</td><td>${escapeHtml(p?.unit||"—")}</td><td>${source}</td><td>${action}</td></tr>`;
    }).join("");
    body.querySelectorAll("[data-edit-chemical-consumption]").forEach(btn=>btn.addEventListener("click",()=>editChemicalConsumption(btn.dataset.editChemicalConsumption,rows.find(m=>m.id===btn.dataset.editChemicalConsumption))));
    body.querySelectorAll("[data-delete-chemical-consumption]").forEach(btn=>btn.addEventListener("click",()=>deleteChemicalConsumption(btn.dataset.deleteChemicalConsumption,rows.find(m=>m.id===btn.dataset.deleteChemicalConsumption))));
  }catch(e){body.innerHTML=`<tr><td colspan="6">${escapeHtml(e.message||String(e))}</td></tr>`;}
}
async function editChemicalConsumption(id,movement){
  if(profile?.role!=="ADMIN"||!movement)return;
  const raw=prompt("Nouvelle quantité consommée (kg) :",String(movement.quantity));
  if(raw===null)return;
  const quantity=Number(String(raw).trim().replace(",","."));
  if(!Number.isFinite(quantity)||quantity<=0){notify("Saisissez une quantité strictement positive.");return;}
  try{
    const {error}=await db.rpc("admin_change_chemical_consumption_movement",{p_movement_id:id,p_new_quantity:Number(quantity.toFixed(3)),p_delete:false});
    if(error)throw error;
    notify("Consommation modifiée. Le stock et l’historique annuel ont été recalculés.");
    await Promise.all([loadChemicalConsumptionHistory(),loadChemicals(),loadRecords(),loadDailyPaintHistory()]);
  }catch(e){notify(`Modification impossible : ${e.message||e}`);}
}
async function deleteChemicalConsumption(id,movement){
  if(profile?.role!=="ADMIN"||!movement)return;
  if(!confirm(`Supprimer la consommation de ${fmt(movement.quantity)} kg ? Le stock sera restauré par une nouvelle écriture d’audit.`))return;
  try{
    const {error}=await db.rpc("admin_change_chemical_consumption_movement",{p_movement_id:id,p_new_quantity:0,p_delete:true});
    if(error)throw error;
    notify("Consommation supprimée. Le mouvement original est conservé et le stock restauré.");
    await Promise.all([loadChemicalConsumptionHistory(),loadChemicals(),loadRecords(),loadDailyPaintHistory()]);
  }catch(e){notify(`Suppression impossible : ${e.message||e}`);}
}

async function loadChemicals(){
  if(!$('chemicalProductsBody')) return;
  $('chemicalProductsBody').innerHTML='<tr><td colspan="7">Chargement…</td></tr>';
  $('chemicalBarrelsBody').innerHTML='<tr><td colspan="6">Chargement…</td></tr>';
  try{
    const [productsRes,stockRes,barrelsRes]=await Promise.all([
      db.from('chemical_products').select('id,product_code,product_name,unit,minimum_stock,active').order('product_name'),
      db.from('chemical_product_stock').select('product_id,product_code,product_name,unit,current_stock,alert_threshold_kg,stock_status'),
      db.from('chemical_barrel_stock').select('barrel_id,product_id,product_code,product_name,net_weight_kg,remaining_quantity_kg,total_out_kg,created_at,is_reusable,material_status').order('created_at',{ascending:false})
    ]);
    if(productsRes.error) throw productsRes.error;
    if(stockRes.error) throw stockRes.error;
    if(barrelsRes.error) throw barrelsRes.error;
    const products=productsRes.data||[], stocks=stockRes.data||[], barrels=barrelsRes.data||[];
    const historyRows=await fetchAllRows(()=>db.from('chemical_barrel_inventory_history').select('id,barrel_id,product_id,event_date,event_type,remaining_quantity_kg,is_reusable,material_status,created_at').order('event_date',{ascending:false}).order('created_at',{ascending:false}).order('id'));
    const stockById=new Map(stocks.map(x=>[x.product_id,x]));
    const activeProducts=products.filter(x=>x.active);
    $('chemicalProductCount').textContent=String(activeProducts.length);
    $('chemicalLowCount').textContent=String(stocks.filter(x=>Number(x.current_stock)<=50).length);
    const lowStocks=stocks.filter(x=>Number(x.current_stock)<=50).sort((a,b)=>Number(a.current_stock)-Number(b.current_stock));
    $('chemicalAlertsBody').innerHTML=lowStocks.length?lowStocks.map(x=>`<tr><td>${escapeHtml(x.product_code||'—')}</td><td>${escapeHtml(x.product_name)}</td><td><strong class="chemical-low">${fmt(x.current_stock,3)} ${escapeHtml(x.unit||'kg')}</strong></td><td>50 kg</td></tr>`).join(''):'<tr><td colspan="4" class="chemical-ok">Aucune matière à 50 kg ou moins.</td></tr>';
    $('chemicalProductsBody').innerHTML=products.length?products.map(p=>{
      const st=stockById.get(p.id), qty=Number(st?.current_stock||0), low=qty<=50;
      return `<tr><td>${escapeHtml(p.product_code||'—')}</td><td>${escapeHtml(p.product_name)}${p.active?'':' <span class="chemical-disabled">(Inactif)</span>'}</td><td>${escapeHtml(p.unit)}</td><td>${fmt(qty,3)} ${escapeHtml(p.unit)}</td><td>50 kg</td><td class="${low?'chemical-low':'chemical-ok'}">${low?'STOCK FAIBLE':'OK'}</td><td>${profile?.role==='ADMIN'?`${p.active?`<button class="ghost" data-edit-product="${p.id}">Modifier</button> <button class="ghost" data-adjust-stock="${p.id}">Ajuster stock</button> <button class="danger" data-deactivate-product="${p.id}">Désactiver</button>`:''} <button class="danger" data-delete-chemical-product="${p.id}">Supprimer</button>`:'—'}</td></tr>`;
    }).join(''):'<tr><td colspan="7">Aucune matière. Ajoutez votre première matière.</td></tr>';
    $('chemicalProductsBody').querySelectorAll('[data-deactivate-product]').forEach(b=>b.addEventListener('click',()=>deactivateChemicalProduct(b.dataset.deactivateProduct)));
    $('chemicalProductsBody').querySelectorAll('[data-adjust-stock]').forEach(b=>b.addEventListener('click',()=>adjustChemicalStock(b.dataset.adjustStock,products.find(p=>p.id===b.dataset.adjustStock),stockById.get(b.dataset.adjustStock))));
    $('chemicalProductsBody').querySelectorAll('[data-delete-chemical-product]').forEach(b=>b.addEventListener('click',()=>deleteChemicalProduct(b.dataset.deleteChemicalProduct,products.find(p=>p.id===b.dataset.deleteChemicalProduct))));
    $('chemicalProductsBody').querySelectorAll('[data-edit-product]').forEach(b=>b.addEventListener('click',()=>editChemicalProduct(b.dataset.editProduct,products.find(p=>p.id===b.dataset.editProduct))));
    $('chemicalBarrelsBody').innerHTML=barrels.length?barrels.map(b=>`<tr><td>${new Date(b.created_at).toLocaleDateString('fr-FR')}</td><td>${escapeHtml(b.product_name)}</td><td>${fmt(b.net_weight_kg)} kg</td><td>${fmt(b.total_out_kg||0)} kg</td><td><strong>${fmt(b.remaining_quantity_kg)} kg</strong></td><td class="${b.material_status==='CONFORME'?'chemical-ok':b.material_status==='NON_CONFORME'?'chemical-low':''}">${materialStatusLabel(b.material_status)}</td></tr>`).join(''):'<tr><td colspan="6">Aucun baril enregistré.</td></tr>'; 
    $('barrelProduct').innerHTML=activeProducts.length?activeProducts.map(p=>`<option value="${p.id}">${escapeHtml(p.product_name)}</option>`).join(''):'<option value="">Ajoutez d’abord une matière</option>';
    const barrelOptions=barrels.filter(b=>Number(b.remaining_quantity_kg)>0&&b.material_status!=='NON_CONFORME').map(b=>`<option value="${b.barrel_id}">${escapeHtml(b.product_name)} · ${new Date(b.created_at).toLocaleDateString('fr-FR')} (${fmt(b.remaining_quantity_kg)} kg)</option>`).join('');
    $('outBarrel').innerHTML=barrelOptions||'<option value="">Aucun baril avec stock disponible</option>';
    $('countBarrel').innerHTML=barrels.map(b=>`<option value="${b.barrel_id}">${escapeHtml(b.product_name)} · ${new Date(b.created_at).toLocaleDateString('fr-FR')} (${fmt(b.remaining_quantity_kg)} kg)</option>`).join('')||'<option value="">Aucun baril enregistré</option>';
    const barrelById=new Map(barrels.map(b=>[b.barrel_id,b]));
    const productById=new Map(products.map(p=>[p.id,p]));
    const eventNames={AJOUT:'Ajout du baril',INVENTAIRE:'Inventaire physique',CONSOMMATION:'Consommation',RESTAURATION:'Restauration après suppression de production'};
    $('chemicalInventoryHistoryBody').innerHTML=historyRows.length?historyRows.map(h=>{const b=barrelById.get(h.barrel_id),p=productById.get(h.product_id);const status=h.material_status||'A_VERIFIER';return `<tr><td>${escapeHtml(h.event_date)}</td><td>${eventNames[h.event_type]||escapeHtml(h.event_type)}</td><td>${b?.created_at?new Date(b.created_at).toLocaleDateString('fr-FR'):'—'}</td><td>${escapeHtml(p?.product_name||'—')}</td><td><strong>${fmt(h.remaining_quantity_kg)} kg</strong></td><td class="${status==='CONFORME'?'chemical-ok':status==='NON_CONFORME'?'chemical-low':''}">${materialStatusLabel(status)}</td></tr>`;}).join(''):'<tr><td colspan="6">Aucun historique enregistré.</td></tr>';
    const physicalRows=historyRows.filter(h=>h.event_type==='INVENTAIRE');
    $('chemicalPhysicalInventoryHistoryBody').innerHTML=physicalRows.length?physicalRows.map(h=>{const b=barrelById.get(h.barrel_id),p=productById.get(h.product_id);const status=h.material_status||'A_VERIFIER';return `<tr><td>${escapeHtml(h.event_date)}</td><td>${b?.created_at?new Date(b.created_at).toLocaleDateString('fr-FR'):'—'}</td><td>${escapeHtml(p?.product_name||'—')}</td><td><strong>${fmt(h.remaining_quantity_kg)} kg</strong></td><td class="${status==='CONFORME'?'chemical-ok':status==='NON_CONFORME'?'chemical-low':''}">${materialStatusLabel(status)}</td></tr>`;}).join(''):'<tr><td colspan="5">Aucun inventaire physique enregistré.</td></tr>';
    await loadAnnualChemicalConsumption();
    await loadChemicalNonconformingItems();
  }catch(e){
    notify(`Erreur stock chimique : ${e.message||e}`);
    $('chemicalProductsBody').innerHTML=`<tr><td colspan="7">${escapeHtml(e.message||String(e))}</td></tr>`;
    $('chemicalBarrelsBody').innerHTML='<tr><td colspan="6">Impossible de charger les barils.</td></tr>';
    if($('chemicalInventoryHistoryBody'))$('chemicalInventoryHistoryBody').innerHTML='<tr><td colspan="6">Impossible de charger l’historique.</td></tr>';
    if($('chemicalPhysicalInventoryHistoryBody'))$('chemicalPhysicalInventoryHistoryBody').innerHTML='<tr><td colspan="5">Impossible de charger l’historique.</td></tr>'; 
  }
}


async function loadAnnualChemicalConsumption(selectedYear=null){
  const select=$('annualConsumptionYear'),body=$('chemicalAnnualConsumptionBody');
  if(!select||!body)return;
  const currentYear=new Date().getFullYear();
  if(!select.options.length){
    select.innerHTML=Array.from({length:6},(_,i)=>currentYear-i).map(y=>`<option value="${y}">${y}</option>`).join('');
    select.value=String(currentYear);
  }
  const year=Number(selectedYear||select.value||currentYear);
  if(select.value!==String(year))select.value=String(year);
  body.innerHTML='<tr><td colspan="3">Calcul de la consommation…</td></tr>';
  try{
    const {data,error}=await db.rpc('get_chemical_annual_consumption',{p_year:year});
    if(error)throw error;
    const rows=data||[];
    body.innerHTML=rows.length?rows.map(x=>`<tr><td><strong>${escapeHtml(x.product_name)}</strong></td><td>${escapeHtml(x.unit||'kg')}</td><td><strong>${fmt(x.total_consumed||0,3)} ${escapeHtml(x.unit||'kg')}</strong></td></tr>`).join(''):'<tr><td colspan="3">Aucune matière enregistrée.</td></tr>';
  }catch(e){body.innerHTML=`<tr><td colspan="3">Impossible de calculer : ${escapeHtml(e.message||String(e))}</td></tr>`;}
}


async function loadChemicalNonconformingItems(){
  const body=$('chemicalNonconformingBody'),alerts=$('chemicalNonconformingAlertsBody');
  if(body)body.innerHTML='<tr><td colspan="9">Chargement…</td></tr>';
  if(alerts)alerts.innerHTML='<tr><td colspan="5">Chargement…</td></tr>';
  const {data,error}=await db.from('chemical_nonconforming_items').select('id,product_name,product_code,quantity,unit,expiry_date,recorded_date,note,is_waste').order('recorded_date',{ascending:false}).order('created_at',{ascending:false}).limit(200);
  if(error){const msg=escapeHtml(error.message||String(error));if(body)body.innerHTML=`<tr><td colspan="9">${msg}</td></tr>`;if(alerts)alerts.innerHTML=`<tr><td colspan="5">${msg}</td></tr>`;return;}
  const rows=data||[];
  if(alerts)alerts.innerHTML=rows.length?rows.map(x=>`<tr class="nonconforming-alert-row"><td><strong>${escapeHtml(x.recorded_date||'—')}</strong></td><td><strong>${escapeHtml(x.product_name)}</strong>${x.product_code?`<small class="notification-code">${escapeHtml(x.product_code)}</small>`:''}</td><td><strong class="chemical-low">${fmt(x.quantity,3)} ${escapeHtml(x.unit||'kg')}</strong></td><td><span class="chemical-low">NON CONFORME — NON UTILISABLE</span></td><td><span class="${x.is_waste?'chemical-low':'chemical-ok'}">${x.is_waste?'Déchet':'À traiter / À décider'}</span></td></tr>`).join(''):'<tr><td colspan="5" class="chemical-ok">Aucune matière déclarée non conforme.</td></tr>';
  if(body)body.innerHTML=rows.length?rows.map(x=>`<tr><td>${escapeHtml(x.recorded_date||'—')}</td><td><strong>${escapeHtml(x.product_name)}</strong></td><td>${escapeHtml(x.product_code||'—')}</td><td>${fmt(x.quantity,3)} ${escapeHtml(x.unit)}</td><td>${escapeHtml(x.expiry_date||'—')}</td><td><span class="chemical-low">Non conforme</span></td><td><span class="${x.is_waste?'chemical-low':'chemical-ok'}">${x.is_waste?'Déchet':'Non déclaré déchet'}</span></td><td>${escapeHtml(x.note||'Non conforme')}</td><td>${profile?.role==='ADMIN'?`<button class="danger" data-delete-nonconforming="${x.id}">Supprimer</button>`:'—'}</td></tr>`).join(''):'<tr><td colspan="9">Aucun produit périmé ou non conforme enregistré.</td></tr>';
  body?.querySelectorAll('[data-delete-nonconforming]').forEach(b=>b.addEventListener('click',()=>deleteChemicalNonconformingItem(b.dataset.deleteNonconforming)));
}
async function saveChemicalNonconformingItem(event){
  event.preventDefault();
  if(profile?.role!=='ADMIN'){notify('Réservé à ADMIN.');return;}
  const product_name=$('nonconformingName').value.trim();
  const quantity=Number($('nonconformingQty').value||0);
  const recorded_date=$('nonconformingDate').value||localDate();
  if(!product_name||quantity<=0){notify('Saisissez le nom et une quantité supérieure à zéro.');return;}
  const is_waste=$('nonconformingWaste').checked;
  const row={product_name,product_code:$('nonconformingCode').value.trim()||null,quantity,unit:$('nonconformingUnit').value,expiry_date:$('nonconformingExpiry').value||null,recorded_date,note:$('nonconformingNote').value.trim()||'Non conforme',is_waste,created_by:session.user.id};
  const btn=$('chemicalNonconformingForm').querySelector('button[type="submit"]');btn.disabled=true;
  try{
    const {error}=await db.from('chemical_nonconforming_items').insert(row);if(error)throw error;
    $('chemicalNonconformingForm').reset();$('nonconformingQty').value='0';$('nonconformingNote').value='Non conforme';$('nonconformingDate').value=localDate();
    notify(is_waste?'Alerte créée : matière non conforme déclarée comme déchet.':'Alerte créée : matière non conforme enregistrée.');await loadChemicalNonconformingItems();
  }catch(e){notify(`Ajout impossible : ${e.message||e}`);}finally{btn.disabled=false;}
}
async function deleteChemicalNonconformingItem(id){
  if(profile?.role!=='ADMIN'||!confirm('Supprimer cette ligne du registre Non conforme ?'))return;
  const {error}=await db.from('chemical_nonconforming_items').delete().eq('id',id);
  if(error)notify(`Suppression impossible : ${error.message}`);else{notify('Ligne supprimée du registre.');await loadChemicalNonconformingItems();}
}

async function adjustChemicalStock(id,product,stock){
  if(profile?.role!=="ADMIN"||!product||!product.active)return;
  const current=Number(stock?.current_stock||0);
  const directionText=prompt(`Stock actuel : ${fmt(current)} ${product.unit}\nSaisir INCREASE pour augmenter ou DECREASE pour diminuer :`,"INCREASE");
  if(directionText===null)return;
  const direction=directionText.trim().toUpperCase();
  if(!["INCREASE","DECREASE"].includes(direction)){notify("Direction invalide. Utilisez INCREASE ou DECREASE.");return;}
  const qtyText=prompt(`Quantité à ${direction==="INCREASE"?"ajouter":"retirer"} (${product.unit}) :`);
  if(qtyText===null)return;
  const quantity=Number(qtyText);
  if(!(quantity>0)){notify("Saisissez une quantité strictement positive.");return;}
  if(direction==="DECREASE"&&quantity>current){notify("La quantité à retirer dépasse le stock actuel.");return;}
  const reference=prompt("Référence du correctif (facultatif) :",""); if(reference===null)return;
  const notes=prompt("Motif / observations (facultatif) :",""); if(notes===null)return;
  if(!confirm(`Confirmer ${direction==="INCREASE"?"l’ajout":"le retrait"} de ${fmt(quantity)} ${product.unit} pour ${product.product_name} ?`))return;
  try{
    const {error}=await db.rpc("admin_adjust_chemical_stock",{
      p_product_id:id,p_direction:direction,p_quantity:quantity,
      p_reference:reference.trim()||null,p_notes:notes.trim()||null,
      p_movement_date:new Date().toISOString().slice(0,10)
    });
    if(error)throw error;
    notify("Correction enregistrée dans l’historique du stock."); await loadChemicals();
  }catch(e){notify(`Ajustement impossible : ${e.message||e}`);}
}

async function saveChemicalProduct(event){
  event.preventDefault();
  if(profile?.role!=='ADMIN'){notify('Réservé à l’administrateur.');return;}
  const product_name=$('chemicalProductName').value.trim();
  const unit=$('chemicalProductUnit').value;
  const minimum_stock=Number($('chemicalMinimumStock').value);
  if(!product_name||!(minimum_stock>=0)){notify('Vérifiez le nom et le seuil.');return;}
  try{
    const {error}=await db.from('chemical_products').insert({product_name,unit,minimum_stock,active:true});
    if(error) throw error;
    $('chemicalProductForm').reset();$('chemicalMinimumStock').value='50';
    notify('Matière chimique ajoutée.');await loadChemicals();
  }catch(e){notify(`Ajout impossible : ${e.message||e}`);}
}
async function editChemicalProduct(id,product){
  if(profile?.role!=='ADMIN'||!product)return;
  const product_name=prompt('Nom de la matière :',product.product_name);
  if(product_name===null)return;
  const unit=prompt('Unité (kg, L, g, unit) :',product.unit);
  if(unit===null)return;
  if(!product_name.trim()||!['kg','L','g','unit'].includes(unit.trim())){notify('Nom ou unité invalide.');return;}
  const {error}=await db.from('chemical_products').update({product_name:product_name.trim(),unit:unit.trim()}).eq('id',id);
  if(error)notify(`Modification impossible : ${error.message}`);else{notify('Matière modifiée.');await loadChemicals();}
}
async function deactivateChemicalProduct(id){
  if(profile?.role!=='ADMIN'||!confirm('Désactiver cette matière ? Son historique et ses barils seront conservés.'))return;
  const {error}=await db.from('chemical_products').update({active:false}).eq('id',id);
  if(error)notify(error.message);else{notify('Matière désactivée.');await loadChemicals();}
}
async function deleteChemicalProduct(id,product){
  if(profile?.role!=="ADMIN"||!product)return;
  if(!confirm(`Supprimer définitivement « ${product.product_name} » uniquement si aucun stock, baril ou historique ne lui est lié ?`))return;
  try{const {error}=await db.rpc("admin_delete_chemical_product",{p_product_id:id});if(error)throw error;notify("Matière chimique supprimée.");await loadChemicals();}
  catch(e){notify(`Suppression impossible : ${e.message||e}`);}
}
async function saveChemicalBarrel(event){
  event.preventDefault();
  if(profile?.role==='VIEWER')return;
  const product_id=$('barrelProduct').value;
  const gross_weight_kg=Number($('barrelGross').value), tare_weight_kg=Number($('barrelTare').value);
  if(!product_id||!(gross_weight_kg>tare_weight_kg&&tare_weight_kg>=0)){notify('Vérifiez la matière et les poids.');return;}
  try{
    const {error}=await db.from('chemical_barrels').insert({product_id,gross_weight_kg,tare_weight_kg,created_by:session.user.id});
    if(error)throw error;
    $('chemicalBarrelForm').reset();notify('Baril enregistré et stock initial ajouté.');await loadChemicals();
  }catch(e){notify(`Enregistrement du baril impossible : ${e.message||e}`);}
}
async function saveChemicalOut(event){
  event.preventDefault();
  if(profile?.role==='VIEWER')return;
  const quantity=Number($('outQuantity').value), barrel_id=$('outBarrel').value;
  if(!barrel_id||!(quantity>0)){notify('Sélectionnez un baril et une quantité valide.');return;}
  try{
    const {data:barrel,error:barrelError}=await db.from('chemical_barrels').select('product_id,material_status').eq('id',barrel_id).single();
    if(barrelError)throw barrelError;
    if(barrel.material_status==='NON_CONFORME')throw new Error('Cette matière est déclarée non conforme et ne peut pas être consommée.');
    const {data:barrelStock,error:stockError}=await db.from('chemical_barrel_stock').select('remaining_quantity_kg').eq('barrel_id',barrel_id).single();
    if(stockError)throw stockError;
    if(quantity>Number(barrelStock.remaining_quantity_kg))throw new Error('La quantité demandée dépasse la quantité restante dans ce baril.');
    const {error}=await db.from('stock_movements').insert({product_id:barrel.product_id,barrel_id,movement_type:'OUT',quantity,movement_date:$('outDate').value||localDate(),notes:$('outNotes').value,created_by:session.user.id});
    if(error)throw error;
    $('chemicalOutForm').reset();$('outDate').value=localDate();notify('Consommation enregistrée.');await loadChemicals();if(profile?.role==='ADMIN')await loadChemicalConsumptionHistory();
  }catch(e){notify(`Consommation impossible : ${e.message||e}`);}
}
async function saveChemicalCount(event){
  event.preventDefault();
  if(profile?.role==='VIEWER')return;
  const barrel_id=$('countBarrel').value, counted=Number($('countQuantity').value);
  if(!barrel_id||!(counted>=0)){notify('Sélectionnez un baril et saisissez la quantité réelle.');return;}
  try{
    const {data,error}=await db.rpc('record_chemical_barrel_annual_inventory',{p_barrel_id:barrel_id,p_counted_quantity_kg:counted,p_material_status:$('countMaterialStatus').value});
    if(error)throw error;
    $('chemicalCountForm').reset();notify(data?'Inventaire enregistré et écart ajusté.':'Inventaire enregistré : aucun écart de stock.');await loadChemicals();
  }catch(e){notify(`Inventaire impossible : ${e.message||e}`);}
}

async function loadUsers(){
  if(profile?.role!=="ADMIN" || !$("usersList")) return;
  const {data,error}=await db.from("access_code_registry").select("id,user_id,display_name,role,active,created_at").order("created_at",{ascending:false});
  if(error){$("usersList").textContent=error.message;return;}
  $("usersList").innerHTML=`<table><thead><tr><th>Nom du compte</th><th>Rôle</th><th>État</th><th>Action</th></tr></thead><tbody>${(data||[]).map(u=>`<tr><td>${escapeHtml(u.display_name)}</td><td>${u.role}</td><td>${u.active?"Actif":"Révoqué"}</td><td>${u.active&&u.user_id!==session.user.id?`<button class="danger" data-revoke="${u.id}">Révoquer</button>`:"—"}</td></tr>`).join("")}</tbody></table>`;
  $("usersList").querySelectorAll("[data-revoke]").forEach(b=>b.addEventListener("click",()=>revokeUser(b.dataset.revoke)));
}
async function revokeUser(registryId){
  if(!confirm("Révoquer définitivement ce code d’accès ?"))return;
  const {data,error}=await db.functions.invoke("revoke-access-code",{body:{registry_id:registryId}});
  if(error||data?.error){notify(error?.message||data.error);return;}
  notify("Code d’accès révoqué.");await loadUsers();
}

async function createAccessCode(event){
  event.preventDefault();
  const name=$("newName").value.trim(), role=$("newRole").value;
  try{
    const {data,error}=await db.functions.invoke("create-access-code",{body:{display_name:name,role}});
    if(error)throw error;
    if(data?.error)throw new Error(data.error);
    $("newCodeResult").hidden=false;
    $("newCodeResult").innerHTML=`<strong>Code créé pour ${escapeHtml(data.display_name)}</strong><code>${escapeHtml(data.access_code)}</code><button id="copyCode" class="ghost">Copier le code</button>`;
    $("copyCode").onclick=async()=>{await navigator.clipboard.writeText(data.access_code);notify("Code copié.");};
    $("createCodeForm").reset(); notify("Nouveau code généré.");
  }catch(e){notify(`Création impossible : ${e.message||e}`);}
}
function subscribeRealtime(){
  if(recordsChannel) db.removeChannel(recordsChannel);
  recordsChannel=db.channel("shared-production")
    .on("postgres_changes",{event:"*",schema:"public",table:"production_records"},()=>loadRecords())
    .on("postgres_changes",{event:"*",schema:"public",table:"layer_consumptions"},()=>loadRecords())
    .on("postgres_changes",{event:"*",schema:"public",table:"paint_barrel_movements"},()=>{loadPaintBarrels();if(profile?.role==="ADMIN")loadPaintBarrelManagement();})
    .on("postgres_changes",{event:"*",schema:"public",table:"chemical_products"},()=>loadChemicals())
    .on("postgres_changes",{event:"*",schema:"public",table:"chemical_barrels"},()=>{loadChemicals();loadPaintBarrels();})
    .on("postgres_changes",{event:"*",schema:"public",table:"chemical_barrel_inventory_history"},()=>loadChemicals())
    .on("postgres_changes",{event:"*",schema:"public",table:"paint_barrels"},()=>{if(profile?.role==="ADMIN")loadPaintBarrelManagement();})
    .on("postgres_changes",{event:"*",schema:"public",table:"stock_movements"},()=>{loadChemicals();loadPaintBarrels();if(profile?.role==="ADMIN")loadChemicalConsumptionHistory();})
    .subscribe(status=>setConnection(status==="SUBSCRIBED"));
}
async function logout(){
  if(recordsChannel) await db.removeChannel(recordsChannel);
  await db.auth.signOut(); session=null;profile=null;
  $("appView").hidden=true;$("loginView").hidden=false;$("adminPanel").hidden=true;
}
$("loginBtn").addEventListener("click",login);
$("accessCode").addEventListener("keydown",e=>{if(e.key==="Enter")login();});
$("logoutBtn").addEventListener("click",logout);
$("productionForm").addEventListener("submit",saveProduction);
$("createCodeForm").addEventListener("submit",createAccessCode);
$("dailyPaintForm").addEventListener("submit",saveDailyPaintConsumption);
$("dailySystem").addEventListener("change",()=>loadDailyPaintForm());
$("dailyHistoryDate").addEventListener("change",loadDailyPaintHistory);
$("dailyPaintHistoryBody").addEventListener("click",e=>{const edit=e.target.closest("[data-edit-daily-consumption]");const del=e.target.closest("[data-delete-daily-consumption]");if(edit)editDailyPaintConsumption(edit.dataset.editDailyConsumption);if(del)deleteDailyPaintConsumption(del.dataset.deleteDailyConsumption);});
$("cancelDailyEdit").addEventListener("click",resetDailyPaintEditor);
$("printDailyPaintHistory").addEventListener("click",()=>{document.body.classList.add("print-daily-history");window.addEventListener("afterprint",()=>document.body.classList.remove("print-daily-history"),{once:true});window.print();});
["dailyDiluantChemist","dailyDiluantRollers","dailyDiluantPumps"].forEach(id=>$(id).addEventListener("input",()=>{$("dailyDiluantTotal").value=["dailyDiluantChemist","dailyDiluantRollers","dailyDiluantPumps"].reduce((t,k)=>t+(Number($(k).value)||0),0).toFixed(3);}));
$("refreshBtn").addEventListener("click",loadRecords);
$("chemicalRefreshBtn").addEventListener("click",loadChemicals);
$("printChemicalConsumptionHistory").addEventListener("click",()=>{document.body.classList.remove("print-daily-history");window.print();});
$("paintBarrelForm").addEventListener("submit",savePaintBarrel);
["paintBarrelGross","paintBarrelTare"].forEach(id=>$(id).addEventListener("input",()=>{$("paintBarrelNet").value=Math.max(0,(Number($("paintBarrelGross").value)||0)-(Number($("paintBarrelTare").value)||0)).toFixed(3);}));
$("chemicalProductForm").addEventListener("submit",saveChemicalProduct);
$("chemicalNonconformingForm").addEventListener("submit",saveChemicalNonconformingItem);
$("chemicalBarrelForm").addEventListener("submit",saveChemicalBarrel);
$("chemicalOutForm").addEventListener("submit",saveChemicalOut);
$("chemicalCountForm").addEventListener("submit",saveChemicalCount);
$("annualConsumptionYear").addEventListener("change",()=>loadAnnualChemicalConsumption($("annualConsumptionYear").value));
$("outDate").value=localDate();
$("nonconformingDate").value=localDate();
$("dailyDate").value=localDate();
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>showTab(b.dataset.tab)));
initForm();
if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
const {data:{session:existing}}=await db.auth.getSession();
if(existing){session=existing;try{await loadProfile();await enterApp();}catch{await logout();}}
window.addEventListener("online",()=>setConnection(true));
window.addEventListener("offline",()=>setConnection(false));
