(function(){
"use strict";

// ========== SUPABASE CLIENT ==========
var SUPABASE_URL = "https://fbapjqvmvipytyrcjtav.supabase.co";
var SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZiYXBqcXZtdmlweXR5cmNqdGF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3OTY1NDMsImV4cCI6MjEwNTM3MjU0M30.sg62VzlIrkKBUlLfI6dRZiSf_2K_OHOTZFDL5DtSxFI";
var supabase=null;
try{
  if(!window.supabase){throw new Error("El SDK de Supabase no se cargo (CDN bloqueado o sin internet).");}
  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
}catch(e){
  console.error("FusaPet inicio:",e);
  supabase=null;
}

// ========== ENUM MAPPING (frontend -> BD) ==========
var TIPO_MAP = { lost:"perdida", found:"encontrada", sighting:"avistado", otro:"encontrada", perdida:"perdida", encontrada:"encontrada", avistado:"avistado", adopcion:"adopcion" };
var TIPO_REV  = { perdida:"lost", encontrada:"found", avistado:"sighting", adopcion:"otro" };
var ESTADO_MAP = { active:"publicado", closed:"recuperada", publicado:"publicado", recuperada:"recuperada" };
var ESTADO_REV = { publicado:"active", recuperada:"closed" };
var TAMANO_MAP = { small:"pequeño", medium:"mediano", large:"grande", pequeno:"pequeño", mediano:"mediano", grande:"grande", "pequeño":"pequeño" };
var TAMANO_REV = { "pequeño":"small", mediano:"medium", grande:"large" };
var ROL_MAP = { user:"usuario", admin:"administrador", usuario:"usuario", administrador:"administrador" };
var ROLE_LABEL = { usuario:"Usuario", administrador:"Admin" };
var FLAG_MAP = { pending:"pendiente", reviewed:"aprobada", dismissed:"desestimada", pendiente:"pendiente", aprobada:"aprobada", desestimada:"desestimada" };
var FLAG_REV = { pendiente:"pending", aprobada:"reviewed", desestimada:"dismissed" };
var FLAG_REASON_LABEL = { fake:"Información falsa", inappropriate:"Contenido inapropiado", spam:"Spam", other:"Otro", informacion_falsa:"Información falsa" };

// ========== TEACHABLE MACHINE (FOTOS DE AVISTAMIENTOS) ==========
var FUSAPET_TM_MODEL_URL = "https://teachablemachine.withgoogle.com/models/t57qdDP-j/";
var teachableMachineModelPromise = null;
function loadExternalScript(src){
  return new Promise(function(resolve,reject){
    var existing=Array.from(document.scripts).find(function(s){return s.src===src;});
    if(existing){if(existing.dataset.loaded==="true")resolve();else{existing.addEventListener("load",resolve,{once:true});existing.addEventListener("error",reject,{once:true});}return;}
    var script=document.createElement("script");script.src=src;script.async=true;
    script.onload=function(){script.dataset.loaded="true";resolve();};script.onerror=function(){reject(new Error("No se pudo cargar la biblioteca de análisis de imágenes"));};
    document.head.appendChild(script);
  });
}
function loadTeachableMachineModel(){
  if(!teachableMachineModelPromise){
    teachableMachineModelPromise=(async function(){
      await loadExternalScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js");
      await loadExternalScript("https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.3/dist/teachablemachine-image.min.js");
      if(!window.tmImage)throw new Error("La biblioteca de Teachable Machine no está disponible");
      return window.tmImage.load(FUSAPET_TM_MODEL_URL+"model.json",FUSAPET_TM_MODEL_URL+"metadata.json");
    })().catch(function(error){teachableMachineModelPromise=null;throw error;});
  }
  return teachableMachineModelPromise;
}
function loadImageForPrediction(source){
  return new Promise(function(resolve,reject){
    var image=new Image();image.crossOrigin="anonymous";
    image.onload=function(){resolve(image);};image.onerror=function(){reject(new Error("No se pudo leer una de las imágenes para compararla"));};
    image.src=source;
  });
}
async function predictImageFile(file){
  var model=await loadTeachableMachineModel();
  var localUrl=URL.createObjectURL(file);
  try{return await model.predict(await loadImageForPrediction(localUrl));}
  finally{URL.revokeObjectURL(localUrl);}
}
async function predictImageUrl(url){var model=await loadTeachableMachineModel();return model.predict(await loadImageForPrediction(url));}
function comparePredictionClasses(first,second){
  var other={};(second||[]).forEach(function(p){other[p.className]=Number(p.probability)||0;});
  var dot=0,n1=0,n2=0;(first||[]).forEach(function(p){var a=Number(p.probability)||0,b=other[p.className]||0;dot+=a*b;n1+=a*a;n2+=b*b;});
  return n1&&n2?Math.max(0,Math.min(1,dot/(Math.sqrt(n1)*Math.sqrt(n2)))):0;
}

// ========== UTILS ==========
function generateReportCode(){
  var ts=Date.now().toString(36).toUpperCase();
  var rnd=Math.random().toString(36).substring(2,6).toUpperCase();
  return "FSP-"+ts+"-"+rnd;
}
function formatDate(d){return d?new Date(d).toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}):"-";}
function normalizeColombianPhone(value){var digits=String(value||"").replace(/\D/g,"");if(digits.indexOf("57")===0)digits=digits.slice(2);return digits?"+57"+digits:"";}
function whatsappPhone(value){return normalizeColombianPhone(value).replace(/\D/g,"");}
function timeAgo(d){if(!d)return"-";var s=Math.floor((Date.now()-new Date(d))/1000);if(s<60)return"hace un momento";if(s<3600)return"hace "+Math.floor(s/60)+" min";if(s<86400)return"hace "+Math.floor(s/3600)+" h";if(s<604800)return"hace "+Math.floor(s/86400)+" d";return formatDate(d);}
function getTypeLabel(t){return{lost:"Perdida",found:"Encontrada",sighting:"Avistamiento"}[t]||t;}
function getTypeClass(t){return{lost:"type-lost",found:"type-found",sighting:"type-sighting"}[t]||"";}
function getStatusLabel(s){return{active:"Activo",closed:"Cerrado",cancelled:"Cancelado",moderated:"Retirado por moderación",pending:"Pendiente de aprobación",rejected:"Rechazado"}[s]||s;}
function getStatusClass(s){return{active:"status-active",closed:"status-closed",cancelled:"status-moderated",moderated:"status-moderated",pending:"status-pending",rejected:"status-moderated"}[s]||"";}
function navigateTo(p){window.location.hash=p;}
function showToast(msg,type){
  var c=document.getElementById("toast-container");
  if(!c){c=document.createElement("div");c.id="toast-container";c.className="toast-container";document.body.appendChild(c);}
  var t=document.createElement("div");t.className="toast toast-"+(type||"info");
  t.innerHTML='<span class="toast-message"></span><button class="toast-close">&times;</button>';
  t.querySelector(".toast-message").textContent=String(msg==null?"":msg);
  t.querySelector(".toast-close").onclick=function(){t.remove();};
  c.appendChild(t);
  requestAnimationFrame(function(){t.classList.add("show");});
  setTimeout(function(){t.classList.remove("show");setTimeout(function(){t.remove();},300);},5000);
}
var modalFocusStates=new WeakMap();
function showModal(id){
  var m=document.getElementById(id);if(!m)return;
  m.classList.add("show");m.hidden=false;m.setAttribute("role","dialog");m.setAttribute("aria-modal","true");
  var title=m.querySelector("h2");if(title){if(!title.id)title.id=id+"-title";m.setAttribute("aria-labelledby",title.id);}
  var previous=document.activeElement;var focusable=m.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
  var keyHandler=function(e){if(e.key==="Escape"){e.preventDefault();hideModal(id);return;}if(e.key!=="Tab"||!focusable.length)return;var first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}};
  modalFocusStates.set(m,{previous:previous,keyHandler:keyHandler});m.addEventListener("keydown",keyHandler);document.body.style.overflow="hidden";if(focusable.length)focusable[0].focus();
}
function hideModal(id){
  var m=document.getElementById(id);if(!m)return;m.classList.remove("show");m.hidden=true;document.body.style.overflow="";
  var state=modalFocusStates.get(m);if(state){m.removeEventListener("keydown",state.keyHandler);if(state.previous&&state.previous.isConnected)state.previous.focus();modalFocusStates.delete(m);}
}
function $(s,p){return(p||document).querySelector(s);}
function $$(s,p){return Array.from((p||document).querySelectorAll(s));}
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
// Reescala y prioriza WebP en el dispositivo antes de subir; la metadata EXIF
// (incluida ubicación incrustada) no se copia a la imagen resultante.
async function optimizeReportPhoto(file){
  if(typeof createImageBitmap!=="function"||!document.createElement("canvas").toBlob)return file;
  var bitmap;
  try{
    bitmap=await createImageBitmap(file);
    var scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    var canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    var context=canvas.getContext("2d");if(!context)return file;context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    var blob=await new Promise(function(resolve){canvas.toBlob(resolve,"image/webp",0.84);});
    if(!blob||blob.type!=="image/webp"||blob.size>5242880||typeof File!=="function")return file;
    return new File([blob],file.name.replace(/\.[^.]+$/,".webp"),{type:"image/webp",lastModified:Date.now()});
  }catch(error){return file;}finally{if(bitmap&&bitmap.close)bitmap.close();}
}
function linkFormLabels(root){
  if(!root)return;
  root.querySelectorAll("label:not([for])").forEach(function(label){
    var controls=label.querySelectorAll("input,select,textarea");
    if(controls.length!==1)return;
    var control=controls[0];if(!control.id)control.id="field-"+Math.random().toString(36).slice(2,10);
    label.htmlFor=control.id;
  });
  root.querySelectorAll(".modal-close").forEach(function(button){if(!button.hasAttribute("aria-label"))button.setAttribute("aria-label","Cerrar ventana");});
}
function bindReportCardKeyboard(root){
  if(!root)return;
  root.querySelectorAll(".report-card[tabindex]").forEach(function(card){
    card.setAttribute("role","link");
    if(!card.hasAttribute("aria-label")){var heading=card.querySelector("h3,h4");card.setAttribute("aria-label","Ver reporte de "+(heading?heading.textContent:"mascota"));}
    card.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();card.click();}});
  });
}
// The single-page templates are assembled dynamically; repair skipped levels
// in their document order so each rendered view has one h1 and a linear outline.
function normalizeHeadings(root){
  if(!root)return;
  var previous=0,hasH1=false;
  Array.from(root.querySelectorAll("h1,h2,h3,h4,h5,h6")).forEach(function(heading){
    var level=Number(heading.tagName.slice(1));
    if(level===1){if(hasH1)level=2;else hasH1=true;}
    else if(!hasH1)level=1;
    else if(level>previous+1)level=previous+1;
    if(level!==Number(heading.tagName.slice(1))){
      var replacement=document.createElement("h"+level);
      Array.from(heading.attributes).forEach(function(attribute){replacement.setAttribute(attribute.name,attribute.value);});
      while(heading.firstChild)replacement.appendChild(heading.firstChild);
      heading.replaceWith(replacement);
    }
    previous=level;
  });
}
function updatePageMetadata(root){
  var main=root&&root.querySelector("main");var heading=main&&main.querySelector("h1");
  var title=heading?heading.textContent.trim()+" | FusaPet":"FusaPet - Mascotas perdidas y encontradas";
  var subtitle=main&&main.querySelector(".page-subtitle, .subtitle");
  var description=subtitle?subtitle.textContent.trim():"Reporta mascotas perdidas, encontradas y avistamientos en tu comunidad.";
  document.title=title;
  var desc=document.querySelector('meta[name="description"]');if(desc)desc.content=description;
  var ogTitle=document.querySelector('meta[property="og:title"]');if(ogTitle)ogTitle.content=title;
  var ogDescription=document.querySelector('meta[property="og:description"]');if(ogDescription)ogDescription.content=description;
}

// Los mapas contactan a OpenFreeMap/MapLibre. Pedimos consentimiento antes de
// cargar sus recursos; la preferencia solo guarda una opción funcional local.
var mapLibraryPromise=null;
function requestMapConsent(){
  try{var saved=localStorage.getItem("fusapet-map-consent");if(saved==="accepted")return Promise.resolve(true);}catch(e){}
  return new Promise(function(resolve){
    var opener=document.activeElement;
    var dialog=document.createElement("section");dialog.className="map-consent";dialog.setAttribute("role","dialog");dialog.setAttribute("aria-modal","true");dialog.setAttribute("aria-labelledby","map-consent-title");
    dialog.innerHTML='<div class="map-consent-card"><h2 id="map-consent-title">Cargar mapa externo</h2><p>El mapa se conecta con OpenFreeMap y carga bibliotecas alojadas en un CDN. Puedes continuar sin mapa; los demás reportes y formularios seguirán disponibles.</p><div class="map-consent-actions"><button type="button" class="btn btn-primary" data-map-choice="accepted">Aceptar y cargar el mapa</button><button type="button" class="btn btn-secondary" data-map-choice="rejected">Continuar sin mapa</button></div></div>';
    document.body.appendChild(dialog);var buttons=dialog.querySelectorAll("button");buttons[0].focus();
    var finish=function(accepted){if(accepted){try{localStorage.setItem("fusapet-map-consent","accepted");}catch(e){}}dialog.remove();if(opener&&opener.isConnected)opener.focus();resolve(accepted);};
    dialog.addEventListener("keydown",function(e){if(e.key==="Escape"){e.preventDefault();finish(false);}else if(e.key==="Tab"){if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons[1].focus();}else if(!e.shiftKey&&document.activeElement===buttons[1]){e.preventDefault();buttons[0].focus();}}});
    buttons.forEach(function(button){button.addEventListener("click",function(){finish(button.dataset.mapChoice==="accepted");});});
  });
}
function ensureMapLibraries(){
  if(mapLibraryPromise)return mapLibraryPromise;
  mapLibraryPromise=(async function(){
    if(!(await requestMapConsent())){mapLibraryPromise=null;return false;}
    function addStyle(href){return new Promise(function(resolve,reject){var link=document.createElement("link");link.rel="stylesheet";link.href=href;link.crossOrigin="anonymous";link.onload=resolve;link.onerror=reject;document.head.appendChild(link);});}
    function addScript(src){return new Promise(function(resolve,reject){var script=document.createElement("script");script.src=src;script.async=true;script.crossOrigin="anonymous";script.onload=resolve;script.onerror=reject;document.head.appendChild(script);});}
    try{
      if(!window.L){await addStyle("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css");await addScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js");}
      if(!window.maplibregl){await addStyle("https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css");await addScript("https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js");}
      if(window.L&&!window.L.maplibreGL)await addScript("https://unpkg.com/@maplibre/maplibre-gl-leaflet/leaflet-maplibre-gl.js");
      return !!(window.L&&window.L.maplibreGL);
    }catch(error){mapLibraryPromise=null;showToast("No se pudieron cargar los recursos del mapa. Puedes continuar sin él.","warning");return false;}
  })();
  return mapLibraryPromise;
}

// ========== AUTH SERVICE ==========
var AuthService={
  _user:null,
  _initPromise:null,
  async init(){
    if(this._initPromise)return this._initPromise;
    var self=this;
    this._initPromise=(async function(){
      var res=await supabase.auth.getSession();
      self._user=res.data.session?res.data.session.user:null;
      supabase.auth.onAuthStateChange(function(event,session){
        self._user=session?session.user:null;
        cachedUser=null;cachedProfile=null;
      });
      return self._user;
    })();
    return this._initPromise;
  },
  async me(){
    if(this._user)return this._user;
    var res=await supabase.auth.getSession();
    this._user=res.data.session?res.data.session.user:null;
    return this._user;
  },
  async profile(){
    var user=await this.me();
    if(!user)return null;
    var {data,error}=await supabase.rpc("get_my_profile").maybeSingle();
    if(error||!data){
      // intentar crear perfil si falta
      var {error:err2}=await supabase.from("usuarios").insert([{id:user.id,nombre:user.user_metadata.nombre||user.email,email:user.email,telefono:user.user_metadata.telefono||"",rol:"usuario"}]);
      if(!err2){var r2=await supabase.rpc("get_my_profile").maybeSingle();return r2.data||null;}
      return null;
    }
    return data;
  },
  async isAuthenticated(){var u=await this.me();return !!u;},
  async hasRole(role){var p=await this.profile();return p&&p.rol===ROL_MAP[role];},
  async login(email,pass){
    var {data,error}=await supabase.auth.signInWithPassword({email:email,password:pass});
    if(error)throw new Error(error.message==="Invalid login credentials"?"Correo o contraseña incorrectos":error.message);
    this._user=data.user;
    return data.user;
  },
  async register(nombre,email,pass,telefono){
    var {data,error}=await supabase.auth.signUp({email:email,password:pass,options:{data:{nombre:nombre,telefono:telefono||""}}});
    if(error)throw new Error(error.message==="User already registered"?"El correo ya está registrado":error.message);
    if(data.user&&!data.session){
      return{user:data.user,emailConfirmation:true};
    }
    this._user=data.user;
    if(data.user){
      // crear registro en tabla usuarios
      var {error:perr}=await supabase.from("usuarios").insert([{id:data.user.id,nombre:nombre,email:email,telefono:telefono||"" ,rol:"usuario"}]);
      if(perr)console.error("Error creando perfil:",perr.message);
    }
    return{user:data.user,emailConfirmation:false};
  },
  async logout(){
    await supabase.auth.signOut();
    this._user=null;
  },
  async recoverPassword(email){
    var {error}=await supabase.auth.resetPasswordForEmail(email);
    if(error)throw new Error(error.message);
    return true;
  }
};

// ========== DATA SERVICE ==========
var Data={
  async getCommunes(){
    var {data,error}=await supabase.from("comunas").select("*").order("nombre");
    if(error){console.error(error);return[];}
    return data||[];
  },
  async getBarrios(){
    var {data,error}=await supabase.from("barrios").select("*");
    if(error){console.error(error);return[];}
    return data||[];
  },
  async getEspecies(){
    var {data,error}=await supabase.from("especies").select("*").order("nombre");
    if(error){console.error(error);return[];}
    return data||[];
  },
  async getReports(filters){
    filters=filters||{};
    var q=supabase.from("reportes").select("*, usuario:usuarios(nombre,telefono), barrio:barrios(nombre,comuna_id), mascota:mascotas(nombre,color,raza)");
    if(filters.types&&filters.types.length){
      var tipos=filters.types.map(function(t){return TIPO_MAP[t]||t;});
      q=q.in("tipo",tipos);
    }
    if(filters.statuses&&filters.statuses.length){
      var estados=filters.statuses.map(function(s){return ESTADO_MAP[s]||s;});
      q=q.in("estado",estados);
    }
    if(filters.commune){
      // filtrar por comuna via barrios
      var barrios=await this.getBarrios();
      var ids=barrios.filter(function(b){return String(b.comuna_id)===String(filters.commune);}).map(function(b){return b.id;});
      if(ids.length)q=q.in("barrio_id",ids);
      else return{reports:[],total:0};
    }
    if(filters.neighborhood)q=q.eq("barrio_id",filters.neighborhood);
    if(filters.query){
      // Whitelist plain text before composing PostgREST's .or expression.
      var term=String(filters.query).trim().slice(0,100).replace(/[^a-zA-Z0-9áéíóúüñÁÉÍÓÚÜÑ\s-]/g," ").replace(/\s+/g," ").trim();
      if(!term)return{reports:[],total:0};
      var names=[];
      var {data:m}=await supabase.from("mascotas").select("id").ilike("nombre","%"+term+"%");
      if(m&&m.length)names=m.map(function(x){return x.id;});
      var nameCond=names.length?"mascota_id.in.("+names.join(",")+")":"true.eq.true";
      q=q.or("descripcion.ilike.%"+term+"%,color.ilike.%"+term+"%,"+nameCond);
    }
    q=q.order("created_at",{ascending:false});
    var {data,error}=await q;
    if(error){console.error(error);return{reports:[],total:0};}
    // Consultar el estado por separado evita que un error al resolver la
    // relación anidada mascota:mascotas deje vacía toda la lista de reportes.
    var visibleRows=data||[];
    var petStatus=await supabase.from("mascotas").select("id,deleted_at");
    if(!petStatus.error&&petStatus.data){
      var deletedPetIds=new Set(petStatus.data.filter(function(p){return p.deleted_at;}).map(function(p){return String(p.id);}));
      visibleRows=visibleRows.filter(function(r){return !r.mascota_id||!deletedPetIds.has(String(r.mascota_id));});
    }else if(petStatus.error){
      console.error("No se pudo filtrar mascotas eliminadas de los reportes:",petStatus.error);
    }
    var reports=this.decorateReports(visibleRows);
    return{reports:reports,total:reports.length};
  },
  async getMyReports(){
    var user=await AuthService.me();
    if(!user)return[];
    var {data,error}=await supabase.from("reportes").select("*, barrio:barrios(nombre,comuna_id), mascota:mascotas(nombre,color,raza)").eq("usuario_id",user.id).order("created_at",{ascending:false});
    if(error)return[];
    return this.decorateReports(data||[]);
  },
  async getPendingReports(){
    var {data,error}=await supabase.from("reportes").select("id,codigo_unico,tipo,estado,revision_estado,moderado,usuario_id,created_at,descripcion,color,tamano,senas_particulares,barrio:barrios(nombre),mascota:mascotas(nombre,raza),usuario:usuarios(nombre,email)").eq("revision_estado","pendiente").order("created_at",{ascending:true});
    if(error)throw new Error(error.message);
    return await Promise.all((data||[]).map(async function(r){
      var photoRows=await supabase.from("fotos_reporte").select("url,orden").eq("reporte_id",r.id).order("orden");
      var photos=(await Promise.all((photoRows.data||[]).map(async function(p){var signed=await supabase.storage.from("report-photos").createSignedUrl(p.url,3600);return signed.error?null:signed.data.signedUrl;}))).filter(Boolean);
      var barrio=Array.isArray(r.barrio)?r.barrio[0]:r.barrio;var mascota=Array.isArray(r.mascota)?r.mascota[0]:r.mascota;var author=Array.isArray(r.usuario)?r.usuario[0]:r.usuario;
      return{id:r.id,code:r.codigo_unico,type:TIPO_REV[r.tipo]||r.tipo,petName:mascota&&mascota.nombre||"Mascota",breed:mascota&&mascota.raza||"",color:r.color||"",size:TAMANO_REV[r.tamano]||"",characteristics:r.senas_particulares||"",location:r.descripcion||"",neighborhood:barrio&&barrio.nombre||"",authorName:author&&author.nombre||"Usuario",authorEmail:author&&author.email||"",createdAt:r.created_at,photos:photos};
    }));
  },
  async reviewReport(id,status){
    if(["aprobado","rechazado"].indexOf(status)<0)throw new Error("Estado de revisión no válido");
    var {data,error}=await supabase.from("reportes").update({revision_estado:status}).eq("id",id).eq("revision_estado","pendiente").select("id").maybeSingle();
    if(error)throw new Error(error.message);
    if(!data)throw new Error("El reporte ya no está pendiente de revisión");
  },
  decorateReports(rows){
    return rows.map(function(r){
      var barrio=Array.isArray(r.barrio)?r.barrio[0]:(r.barrio||null);
      return{
        id:r.id,
        code:r.codigo_unico,
        type:TIPO_REV[r.tipo]||"otro",
        petName:r.mascota&&r.mascota.nombre?r.mascota.nombre:"Mascota",
        species:"",
        breed:r.mascota&&r.mascota.raza||"",
        color:r.color||"",
        size:TAMANO_REV[r.tamano]||"",
        characteristics:r.senas_particulares||"",
        commune:barrio?String(barrio.comuna_id):"",
        neighborhood:barrio?barrio.nombre:"",
        barrioId:r.barrio_id,
        location:r.descripcion||"",
        date:r.fecha_publicacion||r.created_at,
        status:ESTADO_REV[r.estado]||"active",
        moderated:r.moderado===true,
        approvalStatus:r.revision_estado||"aprobado",
        contactName:r.usuario&&r.usuario.nombre||"",
        contactPhone:r.usuario&&r.usuario.telefono||"",
        authorName:r.usuario&&r.usuario.nombre||"",
        userId:r.usuario_id,
        lat:r.latitud!=null?Number(r.latitud):null,
        lng:r.longitud!=null?Number(r.longitud):null,
        photos:[],
        showContact:true,
        createdAt:r.created_at,
        sightings:[]
      };
    });
  },
  async getReportById(id){
    var {data,error}=await supabase.from("reportes").select("*, usuario:usuarios(nombre,telefono), barrio:barrios(nombre,comuna_id), mascota:mascotas(nombre,especie_id,raza,color)").eq("id",id).single();
    if(error){console.error(error);return null;}
    var r=data;
    var barrio=Array.isArray(r.barrio)?r.barrio[0]:(r.barrio||null);
    var fotosRes=await supabase.from("fotos_reporte").select("url").eq("reporte_id",id).order("orden");
    var fotos=(await Promise.all((fotosRes.data||[]).map(async function(f){
      var signed=await supabase.storage.from("report-photos").createSignedUrl(f.url,3600);
      return signed.error?null:signed.data.signedUrl;
    }))).filter(Boolean);
    var avistRes=await supabase.from("avistamientos").select("*, barrio:barrios(nombre,comuna_id)").eq("reporte_id",id).order("fecha",{ascending:false});
    var comunas=await this.getCommunes();
    function comunaName(cid){var c=comunas.find(function(x){return String(x.id)===String(cid);});return c?c.nombre:"";}
    return{
      id:r.id,
      code:r.codigo_unico,
      type:TIPO_REV[r.tipo]||"otro",
      petName:r.mascota&&r.mascota.nombre?r.mascota.nombre:"Mascota",
      species:r.mascota&&r.mascota.especie_id?String(r.mascota.especie_id):"",
      breed:r.mascota&&r.mascota.raza||"",
      color:r.color||"",
      size:TAMANO_REV[r.tamano]||"",
      characteristics:r.senas_particulares||"",
      commune:comunaName(barrio?barrio.comuna_id:null),
      communeId:barrio?barrio.comuna_id:null,
      neighborhood:barrio?barrio.nombre:"",
      location:r.descripcion||"",
      date:r.fecha_publicacion||r.created_at,
      status:ESTADO_REV[r.estado]||"active",
      moderated:r.moderado===true,
      approvalStatus:r.revision_estado||"aprobado",
      contactName:r.usuario&&r.usuario.nombre||"",
      contactPhone:r.usuario&&r.usuario.telefono||"",
      authorName:r.usuario&&r.usuario.nombre||"",
      userId:r.usuario_id,
      lat:r.latitud!=null?Number(r.latitud):null,
      lng:r.longitud!=null?Number(r.longitud):null,
      photos:fotos,
      showContact:true,
      createdAt:r.created_at,
      sightings:await Promise.all((avistRes.data||[]).map(async function(a){
        var ab=Array.isArray(a.barrio)?a.barrio[0]:(a.barrio||null);
        var sightingPhotoRows=await supabase.from("fotos_avistamiento").select("url").eq("avistamiento_id",a.id).order("orden");
        var sightingPhotos=(await Promise.all((sightingPhotoRows.data||[]).map(async function(f){var signed=await supabase.storage.from("report-photos").createSignedUrl(f.url,3600);return signed.error?null:signed.data.signedUrl;}))).filter(Boolean);
        return{id:a.id,description:(a.informacion_adicional||"").replace(/^MASCOTA_ENCONTRADA:\s*/,""),found:(a.informacion_adicional||"").indexOf("MASCOTA_ENCONTRADA:")===0,location:a.descripcion||"",commune:comunaName(ab?ab.comuna_id:null),neighborhood:ab?ab.nombre:"",date:a.fecha||a.created_at,photos:sightingPhotos};
      }))
    };
  },
  async createReport(data){
    var user=await AuthService.me();
    if(!user)throw new Error("Debes iniciar sesión");
    var isAdmin=await AuthService.hasRole("admin");
    var photoFiles=(data.photoFiles||[]).filter(function(f){return f&&f.size;});
    if(photoFiles.length>5)throw new Error("Puedes adjuntar hasta 5 fotos");
    photoFiles.forEach(function(f){if(["image/jpeg","image/png","image/webp"].indexOf(f.type)<0||f.size>5242880)throw new Error("Cada foto debe ser JPG, PNG o WebP y pesar máximo 5 MB");});
    photoFiles=await Promise.all(photoFiles.map(optimizeReportPhoto));
    var uploadedPaths=[];
    var photoFolder=(window.crypto&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2));
    var photoUrls=[];
    try{
      for(var pi=0;pi<photoFiles.length;pi++){
        var file=photoFiles[pi];
        var ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}[file.type];
        var path=user.id+"/"+photoFolder+"/"+(pi+1)+"."+ext;
        var up=await supabase.storage.from("report-photos").upload(path,file,{contentType:file.type,upsert:false});
        if(up.error)throw up.error;
        uploadedPaths.push(path);
        photoUrls.push(path);
      }
    }catch(photoError){
      if(uploadedPaths.length)await supabase.storage.from("report-photos").remove(uploadedPaths);
      throw new Error("No se pudieron cargar las fotos: "+photoError.message);
    }
    var pet=null;
    if(data.petName){
      var petResult=await supabase.from("mascotas").insert([{
        usuario_id:user.id,nombre:data.petName,especie_id:data.speciesId||null,raza:"",
        color:data.color||"",tamano:TAMANO_MAP[data.size]||null,
        senas_particulares:data.characteristics||""
      }]).select("id").single();
      if(petResult.error){if(uploadedPaths.length)await supabase.storage.from("report-photos").remove(uploadedPaths);throw new Error(petResult.error.message);}
      pet=petResult.data;
    }
    var estadoActivo="publicado";
    var {data:inserted,error}=await supabase.from("reportes").insert([{
      codigo_unico:data.code||generateReportCode(),
      usuario_id:user.id,
      mascota_id:pet?pet.id:null,
      tipo:TIPO_MAP[data.type]||"otro",
      estado:estadoActivo,
      revision_estado:isAdmin?"aprobado":"pendiente",
      contacto_visible:data.contactoVisible===true,
      color:data.color||"",
      tamano:TAMANO_MAP[data.size]||null,
      senas_particulares:data.characteristics||"",
      descripcion:data.location||"",
      barrio_id:data.barrioId||null,
      latitud:data.lat!=null?data.lat:null,
      longitud:data.lng!=null?data.lng:null,
      fecha_publicacion:data.date||new Date().toISOString()
    }]).select();
    if(error){if(uploadedPaths.length)await supabase.storage.from("report-photos").remove(uploadedPaths);if(pet)await supabase.from("mascotas").delete().eq("id",pet.id);throw new Error(error.message);}
    var report=inserted[0];
    if(photoUrls.length){
      var photoRows=photoUrls.map(function(url,i){return{reporte_id:report.id,url:url,orden:i};});
      var photoInsert=await supabase.from("fotos_reporte").insert(photoRows);
      if(photoInsert.error){
        await supabase.storage.from("report-photos").remove(uploadedPaths);
        await supabase.from("reportes").delete().eq("id",report.id);
        if(pet)await supabase.from("mascotas").delete().eq("id",pet.id);
        throw new Error("No se pudieron asociar las fotos al reporte: "+photoInsert.error.message);
      }
    }
    return report;
  },
  async closeReport(id){
    var {error}=await supabase.from("reportes").update({estado:"recuperada",fecha_cierre:new Date().toISOString()}).eq("id",id);
    if(error)throw new Error(error.message);
  },
  async updateReportLocation(id,lat,lng){
    var user=await AuthService.me();
    if(!user)throw new Error("Debes iniciar sesión");
    if(!Number.isFinite(lat)||!Number.isFinite(lng))throw new Error("Selecciona un punto válido en el mapa");
    var {data,error}=await supabase.from("reportes").update({latitud:lat,longitud:lng}).eq("id",id).eq("usuario_id",user.id).select("id").maybeSingle();
    if(error)throw new Error(error.message);
    if(!data)throw new Error("No se pudo guardar el punto. Verifica que seas dueño del reporte.");
  },
  async addSighting(reportId,data){
    var user=await AuthService.me();
    if(!user)throw new Error("Debes iniciar sesión");
    var photoFile=data.photoFile&&data.photoFile.size?data.photoFile:null;
    if(photoFile&&(["image/jpeg","image/png","image/webp"].indexOf(photoFile.type)<0||photoFile.size>5242880))throw new Error("La foto debe ser JPG, PNG o WebP y pesar máximo 5 MB");
    var {data:rows,error}=await supabase.from("avistamientos").insert([{
      reporte_id:reportId,
      usuario_id:user.id,
      descripcion:data.location||"",
      informacion_adicional:(data.action==="found"?"MASCOTA_ENCONTRADA: ":"")+(data.description||""),
      barrio_id:data.barrioId||null,
      latitud:data.lat!=null?data.lat:null,
      longitud:data.lng!=null?data.lng:null,
      fecha:data.date||new Date().toISOString()
    }]).select();
    if(error)throw new Error(error.message);
    if(photoFile){
      var sighting=rows[0];var folder=window.crypto&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
      var ext={"image/jpeg":"jpg","image/png":"png","image/webp":"webp"}[photoFile.type];var path=user.id+"/avistamientos/"+folder+"/foto."+ext;
      var upload=await supabase.storage.from("report-photos").upload(path,photoFile,{contentType:photoFile.type,upsert:false});
      if(upload.error)throw new Error("El avistamiento se guardó, pero no se pudo guardar su foto: "+upload.error.message);
      var photoInsert=await supabase.from("fotos_avistamiento").insert([{avistamiento_id:sighting.id,url:path,orden:0}]);
      if(photoInsert.error){await supabase.storage.from("report-photos").remove([path]);throw new Error("El avistamiento se guardó, pero no se pudo asociar su foto: "+photoInsert.error.message);}
    }
    // La notificación se crea en el trigger de base de datos para evitar suplantaciones.
    return rows[0];
  },
  async getSightingPhotoCandidates(){
    var {data:photoRows,error:photoError}=await supabase.from("fotos_avistamiento").select("avistamiento_id,url,orden").order("orden");
    if(photoError)throw new Error(photoError.message);
    if(!photoRows||!photoRows.length)return[];
    var sightingIds=Array.from(new Set(photoRows.map(function(p){return p.avistamiento_id;})));
    var {data:sightings,error:sightingError}=await supabase.from("avistamientos").select("id,reporte_id,descripcion,fecha,created_at").in("id",sightingIds);
    if(sightingError)throw new Error(sightingError.message);
    var reportIds=Array.from(new Set((sightings||[]).map(function(s){return s.reporte_id;})));
    if(!reportIds.length)return[];
    var {data:reports,error:reportError}=await supabase.from("reportes").select("id,codigo_unico,tipo,estado,moderado,revision_estado,mascota:mascotas(nombre)").in("id",reportIds);
    if(reportError)throw new Error(reportError.message);
    var sightingById={};(sightings||[]).forEach(function(s){sightingById[String(s.id)]=s;});
    var reportById={};(reports||[]).forEach(function(r){reportById[String(r.id)]=r;});
    return (await Promise.all(photoRows.map(async function(p){
      var s=sightingById[String(p.avistamiento_id)],r=s&&reportById[String(s.reporte_id)];
      if(!s||!r||r.estado!=="publicado"||r.revision_estado!=="aprobado"||r.moderado===true)return null;
      var signed=await supabase.storage.from("report-photos").createSignedUrl(p.url,3600);
      if(signed.error)return null;
      return{id:s.id,reportId:r.id,code:r.codigo_unico,petName:r.mascota&&r.mascota.nombre||"Mascota",type:TIPO_REV[r.tipo]||r.tipo,date:s.fecha||s.created_at,location:s.descripcion||"",photoUrl:signed.data.signedUrl};
    }))).filter(Boolean);
  },
  async flagReport(reportId,reason){
    var user=await AuthService.me();
    if(!user)throw new Error("Debes iniciar sesión");
    var {error}=await supabase.from("denuncias").insert([{
      reporte_id:reportId,
      usuario_id:user.id,
      motivo:reason||"other",
      estado:"pendiente"
    }]);
    if(error){console.error(error);throw new Error("Error al enviar denuncia");}
  },
  async getMyPets(includeDeleted){
    var user=await AuthService.me();
    if(!user)return[];
    var {data,error}=await supabase.rpc("get_my_pets",{include_deleted:!!includeDeleted});
    if(error)return[];
    return (data||[]).map(function(p){
      var e=Array.isArray(p.especie)?p.especie[0]:(p.especie||null);
      return{id:p.id,name:p.nombre,species:e?e.nombre:String(p.especie_id),speciesId:p.especie_id,breed:p.raza||"",color:p.color||"",size:TAMANO_REV[p.tamano]||"",gender:"",characteristics:p.senas_particulares||"",photos:[],deletedAt:p.deleted_at};
    });
  },
  async createPet(data){
    var user=await AuthService.me();
    if(!user)throw new Error("Debes iniciar sesión");
    var {data:rows,error}=await supabase.from("mascotas").insert([{
      usuario_id:user.id,
      nombre:data.name,
      especie_id:data.speciesId||null,
      raza:data.breed||"",
      color:data.color||"",
      tamano:TAMANO_MAP[data.size]||null,
      senas_particulares:data.characteristics||""
    }]).select();
    if(error)throw new Error(error.message);
    return rows[0];
  },
  async updatePet(id,data){
    var {error}=await supabase.from("mascotas").update({
      nombre:data.name,
      especie_id:data.speciesId||null,
      raza:data.breed||"",
      color:data.color||"",
      tamano:TAMANO_MAP[data.size]||null,
      senas_particulares:data.characteristics||""
    }).eq("id",id);
    if(error)throw new Error(error.message);
  },
  async deletePet(id){
    var {error}=await supabase.from("mascotas").update({deleted_at:new Date().toISOString()}).eq("id",id);
    if(error)throw new Error(error.message);
  },
  async restorePet(id){
    var {error}=await supabase.from("mascotas").update({deleted_at:null}).eq("id",id);
    if(error)throw new Error(error.message);
  },
  async getAdminUsers(){
    var {data,error}=await supabase.rpc("admin_list_users");
    if(error)return[];
    return data||[];
  },
  async updateUser(id,data){
    var upd={nombre:data.name,telefono:data.phone||""};
    if(data.role)upd.rol=ROL_MAP[data.role];
    if(Object.prototype.hasOwnProperty.call(data,"active"))upd.activo=!!data.active;
    var {error}=await supabase.from("usuarios").update(upd).eq("id",id);
    if(error)throw new Error(error.message);
  },
  async updateMyProfile(name,phone){
    var user=await AuthService.me();
    if(!user)throw new Error("Debes iniciar sesión");
    var {error}=await supabase.from("usuarios").update({nombre:name,telefono:phone||""}).eq("id",user.id);
    if(error)throw new Error(error.message);
    cachedProfile=null;
  },
  async deleteUser(id){
    // eliminar auth user (requiere admin service role) - eliminar registro público
    var {error}=await supabase.from("usuarios").delete().eq("id",id);
    if(error)throw new Error(error.message);
  },
  async getFlags(){
    var {data,error}=await supabase.from("denuncias").select("*, reporte:reportes(codigo_unico,mascota_id), usuario:usuarios(nombre)").order("created_at",{ascending:false});
    if(error)return[];
    return (data||[]).map(function(f){
      var r=Array.isArray(f.reporte)?f.reporte[0]:(f.reporte||null);
      return{id:f.id,reporteId:f.reporte_id,petName:r?"Reporte "+r.codigo_unico:"",code:r?r.codigo_unico:"",reason:FLAG_REASON_LABEL[f.motivo]||f.motivo,status:FLAG_REV[f.estado]||"pending",details:null,createdAt:f.created_at,authorName:Array.isArray(f.usuario)?f.usuario[0].nombre:""};});
  },
  async moderateFlag(flagId,status){
    var {error}=await supabase.rpc("admin_moderate_flag",{flag_id:String(flagId),new_status:FLAG_MAP[status]||status});
    if(error)throw new Error(error.message);
  },
  async createCommune(name,neighborhoods){
    var {data:c,error}=await supabase.from("comunas").insert([{nombre:name}]).select();
    if(error)throw new Error(error.message);
    if(neighborhoods.length){
      var rows=neighborhoods.map(function(n){return{nombre:n,comuna_id:c[0].id};});
      var {error:berr}=await supabase.from("barrios").insert(rows);
      if(berr){await supabase.from("comunas").delete().eq("id",c[0].id);throw new Error(berr.message);}
    }
    return c[0];
  },
  async deleteCommune(id){
    var {error:berr}=await supabase.from("barrios").delete().eq("comuna_id",id);
    if(berr)throw new Error(berr.message);
    var {error}=await supabase.from("comunas").delete().eq("id",id);
    if(error)throw new Error(error.message);
  },
  async getStats(){
    var users=await this.getAdminUsers();
    var reports=await supabase.from("reportes").select("id,estado");
    var rActive=(reports.data||[]).filter(function(x){return x.estado==="publicado";}).length;
    var rClosed=(reports.data||[]).filter(function(x){return x.estado==="recuperada";}).length;
    var sightings=(await supabase.from("avistamientos").select("id")).data||[];
    var flags=(await supabase.from("denuncias").select("id,estado")).data||[];
    var pets=(await supabase.from("mascotas").select("id")).data||[];
    return{totalUsers:users.length,activeReports:rActive,closedReports:rClosed,totalSightings:sightings.length,pendingFlags:flags.filter(function(f){return f.estado==="pendiente";}).length,totalPets:pets.length};
  },
  async getNotifications(){
    var user=await AuthService.me();
    if(!user)return[];
    var {data,error}=await supabase.from("notificaciones").select("*").eq("usuario_id",user.id).order("created_at",{ascending:false}).limit(20);
    if(error)return[];
    return data||[];
  },
  async markNotifRead(id){
    var {error}=await supabase.from("notificaciones").update({leido:true}).eq("id",id);
    if(error)throw new Error(error.message);
  }
};

// ========== PAGES HTML ==========
var PAGES={};

PAGES.login='<main class="main-container"><header class="auth-header"><h1>FusaPet</h1><p class="subtitle">Tu comunidad de mascotas perdidas y encontradas</p></header>'+
'<div class="tab-buttons"><button class="tab-btn active" id="login-tab">Iniciar Sesión</button><button class="tab-btn" id="register-tab">Crear Cuenta</button></div>'+
'<form id="login-form"><div class="form-group"><label>Correo electrónico</label><input type="email" id="login-email" name="email" required placeholder="tu@email.com"></div>'+
'<div class="form-group"><label>Contraseña</label><input type="password" id="login-password" name="password" required placeholder="••••••••"></div>'+
'<div class="form-options"><label class="checkbox-label"><input type="checkbox"> Recordarme</label><a href="#" id="forgot-password-link" class="forgot-link">¿Olvidaste tu contraseña?</a></div>'+
'<button type="submit" class="btn btn-primary">Ingresar</button></form>'+
'<form id="register-form" hidden><div class="form-group"><label>Nombre</label><input type="text" id="register-name" name="name" required placeholder="Tu nombre completo"></div>'+
'<div class="form-group"><label>Correo</label><input type="email" id="register-email" name="email" required placeholder="tu@email.com"></div>'+
'<div class="form-group"><label>Teléfono</label><input type="tel" id="register-phone" name="phone" autocomplete="tel" placeholder="+57 300 123 4567"></div>'+ 
'<div class="form-group"><label>Contraseña</label><input type="password" id="register-password" name="password" required minlength="8" placeholder="••••••••"><span class="field-hint">Mínimo 8 caracteres</span></div>'+
'<div class="form-group"><label>Confirmar contraseña</label><input type="password" id="register-confirm-password" name="confirmPassword" required placeholder="••••••••"></div>'+
'<button type="submit" class="btn btn-primary">Registrarse</button></form>'+
'<div class="auth-footer"><p><a href="#map">Explorar el mapa</a> · <a href="#reports">Ver reportes</a></p><p>Al continuar, aceptas nuestros <a href="#">Términos</a></p></div></main>'+ 
'<div id="forgot-password-modal" class="modal" hidden><div class="modal-backdrop"></div><div class="modal-content"><header class="modal-header"><h2>Recuperar contraseña</h2><button class="modal-close">&times;</button></header>'+
'<form id="forgot-password-form" class="modal-body"><p>Ingresa tu correo para recibir instrucciones.</p><div class="form-group"><label>Correo</label><input type="email" id="forgot-email" name="email" required placeholder="tu@email.com"></div>'+
'<div class="modal-actions"><button type="button" class="btn btn-secondary modal-close">Cancelar</button><button type="submit" class="btn btn-primary">Enviar</button></div></form></div></div>';

var cachedUser=null;
var cachedProfile=null;

async function getUserName(){
  if(!cachedProfile){
    cachedProfile=await AuthService.profile();
  }
  return cachedProfile?cachedProfile.nombre:"Usuario";
}

function navHTML(u,p){
  var name=u?u.nombre||"Usuario":"Usuario";
  var email=u?u.email||"":"";
  var initial=(name||"U").charAt(0).toUpperCase();
  var isAdmin=p&&p.rol==="administrador";
  var adminLink=isAdmin?'<li><a href="#admin" class="nav-link" data-page="admin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span>Admin</span></a></li>':"";
  if(!u){return '<header class="app-header"><div class="header-content"><a href="#map" class="logo"><span class="logo-text">FusaPet</span></a><nav class="main-nav" aria-label="Navegación principal"><ul class="nav-menu"><li><a href="#map" class="nav-link">Mapa</a></li><li><a href="#reports" class="nav-link">Reportes</a></li></ul></nav><a class="btn btn-primary" href="#login">Iniciar sesión</a></div></header>';}
  return '<header class="app-header"><div class="header-content">'+
  '<a href="#dashboard" class="logo"><svg class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg><span class="logo-text">FusaPet</span></a>'+
  '<nav class="main-nav" aria-label="Navegación principal"><button class="nav-toggle" aria-label="Abrir menú de navegación" aria-controls="primary-navigation" aria-expanded="false"><span class="hamburger"></span></button>'+ 
  '<ul class="nav-menu" id="primary-navigation">'+
  '<li><a href="#dashboard" class="nav-link" data-page="dashboard"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg><span>Inicio</span></a></li>'+
  '<li><a href="#map" class="nav-link" data-page="map"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg><span>Mapa</span></a></li>'+
  '<li><a href="#reports" class="nav-link" data-page="reports"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>Reportes</span></a></li>'+
  '<li><a href="#pets" class="nav-link" data-page="pets"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/></svg><span>Mis Mascotas</span></a></li>'+
  adminLink+
  '<li><a href="#reports/new" class="nav-link btn-report" data-page="report-form"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Reportar</span></a></li>'+
  '</ul></nav>'+
  '<div class="user-menu"><button class="user-avatar" aria-label="Abrir menú de usuario" aria-expanded="false"><span class="avatar-text">'+initial+'</span></button>'+ 
  '<div class="user-dropdown"><div class="user-info"><span class="user-name">'+esc(name)+'</span><span class="user-email">'+esc(email)+'</span></div><div class="dropdown-divider"></div>'+ 
  '<a href="#profile" class="dropdown-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>Mi perfil</a>'+
  '<button id="logout-btn" class="dropdown-item dropdown-danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>Cerrar sesión</button></div></div>'+
  '</div></header>';
}

function communeOptionsHTML(communes,selected){
  var h='<option value="">Seleccionar comuna</option>';
  communes.forEach(function(c){h+='<option value="'+esc(c.id)+'"'+(String(c.id)===String(selected)?' selected':'')+'>'+esc(c.nombre)+'</option>';});
  return h;
}
function barrioOptionsHTML(barrios,communeId,selected){
  var inComuna=barrios.filter(function(b){return String(b.comuna_id)===String(communeId);});
  if(!inComuna.length)return'<option value="">Sin barrios</option>';
  var h='<option value="">Seleccionar barrio</option>';
  inComuna.forEach(function(b){h+='<option value="'+esc(b.id)+'"'+(String(b.id)===String(selected)?' selected':'')+'>'+esc(b.nombre)+'</option>';});
  return h;
}

var cachedCommunes=[];
var cachedBarrios=[];
var pendingMapReportAction=null;
var cachedEspecies=[];
async function ensureCatalogs(){
  if(!cachedCommunes.length) cachedCommunes=await Data.getCommunes();
  if(!cachedBarrios.length) cachedBarrios=await Data.getBarrios();
  if(!cachedEspecies.length) cachedEspecies=await Data.getEspecies();
}

// ========== PAGE INIT FUNCTIONS ==========
function bindNavLinks(){
  var toggle=$(".nav-toggle");var menu=$(".nav-menu");
  if(toggle&&menu){toggle.onclick=function(){var ex=toggle.getAttribute("aria-expanded")==="true";toggle.setAttribute("aria-expanded",String(!ex));toggle.setAttribute("aria-label",ex?"Abrir menú de navegación":"Cerrar menú de navegación");menu.classList.toggle("open");};}
  var avatar=$(".user-avatar");
  if(avatar){avatar.onclick=function(e){e.stopPropagation();avatar.setAttribute("aria-expanded",avatar.getAttribute("aria-expanded")==="true"?"false":"true");};setTimeout(function(){document.addEventListener("click",function(){avatar.setAttribute("aria-expanded","false");});},10);}
  var logout=$("#logout-btn");if(logout){logout.onclick=async function(){await AuthService.logout();cachedUser=null;cachedProfile=null;navigateTo("login");};}
}

async function initDashboard(){
  bindNavLinks();
  var user=await AuthService.me();
  var profile=await AuthService.profile();
  await ensureCatalogs();
  var name=profile?profile.nombre:"Usuario";
  var reports=await Data.getReports({});
  var myReports=await Data.getMyReports();
  var notifications=await Data.getNotifications();
  var active=reports.reports.filter(function(r){return r.status==="active"&&!r.moderated&&r.approvalStatus==="aprobado";}).length;
  var recent=reports.reports.filter(function(r){return r.approvalStatus==="aprobado";}).slice(0,5);
  var cards='';
  recent.forEach(function(r){
    var comunaName=r.communeId?communeNameNative(r.communeId):"";
    var b=profile;
    var reportStatus=r.approvalStatus==="pendiente"?"pending":r.approvalStatus==="rechazado"?"rejected":(r.moderated?"moderated":r.status);
    cards+='<article class="report-card" data-id="'+esc(r.id)+'" tabindex="0"><div class="report-type '+getTypeClass(r.type)+'">'+getTypeLabel(r.type)+'</div>'+
    '<div class="report-info"><div class="report-header"><h4>'+esc(r.petName)+'</h4><span class="report-status '+getStatusClass(reportStatus)+'">'+getStatusLabel(reportStatus)+'</span></div>'+ 
    '<p class="report-location">'+esc(r.neighborhood||"")+'</p><p class="report-date">'+timeAgo(r.createdAt)+'</p></div><div class="report-code">'+esc(r.code)+'</div></article>';
  });
  if(!cards)cards='<div class="empty-state"><h3>Sin reportes aún</h3><p>Crea tu primer reporte</p><a href="#reports/new" class="btn-hero"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Crear reporte</a></div>';
  var notificationHTML=notifications.length?notifications.map(function(n){return '<button class="notification-item '+(n.leido?"":"unread")+'" data-id="'+esc(n.id)+'" data-report="'+esc(n.reporte_id||"")+'"><span>'+esc(n.mensaje||"Tienes una nueva notificación")+'</span><small>'+timeAgo(n.created_at)+'</small></button>';}).join(""):'<p class="text-muted">No tienes notificaciones nuevas.</p>';
  var container=$("#app");
  container.innerHTML=navHTML(user,profile)+'<main class="app-main"><div class="dashboard-content">'+
  '<div class="dashboard-welcome"><h1>Hola, '+esc(name)+'</h1><p>Bienvenido a FusaPet</p></div>'+ 
  '<div class="stats-grid"><div class="stat-card" style="--stat-color:#1976d2"><div class="stat-icon" style="background:#1976d220;color:#1976d2"><span>🔍</span></div><div class="stat-info"><span class="stat-value">'+active+'</span><span class="stat-label">Activos</span></div></div>'+
  '<div class="stat-card" style="--stat-color:#7b1fa2"><div class="stat-icon" style="background:#7b1fa220;color:#7b1fa2"><span>📋</span></div><div class="stat-info"><span class="stat-value">'+reports.total+'</span><span class="stat-label">Total</span></div></div>'+
  '<div class="stat-card" style="--stat-color:#2e7d32"><div class="stat-icon" style="background:#2e7d3220;color:#2e7d32"><span>🐾</span></div><div class="stat-info"><span class="stat-value">'+myReports.length+'</span><span class="stat-label">Mis reportes</span></div></div></div>'+
  '<div class="dashboard-section"><div class="section-header"><h2>Reportes recientes</h2><a href="#reports" class="btn btn-secondary btn-sm">Ver todos</a></div><div class="recent-reports">'+cards+'</div></div>'+ 
  '<div class="dashboard-section"><div class="section-header"><h2>Notificaciones</h2></div><div class="notification-list">'+notificationHTML+'</div></div>'+ 
  '<div class="dashboard-section"><div class="map-cta"><div><h3>Reportes en tu comunidad</h3><p>Explora el mapa con todos los avistamientos y mascotas perdidas.</p></div><a href="#map" class="btn-hero"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>Ver mapa de reportes</a></div></div>'+
  '</div></main><footer class="app-footer"><p>FusaPet © '+new Date().getFullYear()+'</p></footer>';
  bindNavLinks();
  $$(".report-card").forEach(function(c){c.onclick=function(){navigateTo("reports/"+c.dataset.id);};});
  bindReportCardKeyboard(container);
  $$(".notification-item").forEach(function(n){n.onclick=async function(){try{await Data.markNotifRead(n.dataset.id);n.classList.remove("unread");if(n.dataset.report)navigateTo("reports/"+n.dataset.report);}catch(e){showToast(e.message,"error");}};});
}
function communeNameNative(cid){var c=cachedCommunes.find(function(x){return String(x.id)===String(cid);});return c?c.nombre:"";}
var mapInstance=null;
var FUSAGASUGA_MAP_STYLE="https://tiles.openfreemap.org/styles/liberty";

async function initMapPage(){
  bindNavLinks();
  var user=await AuthService.me();
  var profile=await AuthService.profile();
  await ensureCatalogs();
  var container=$("#app");
  container.innerHTML=navHTML(user,profile)+'<main class="app-main">'+
  '<div class="page-header"><h1>Mapa de Reportes</h1><p class="page-subtitle">Visualiza reportes en el mapa</p></div>'+
  '<div class="map-layout"><aside class="map-filters"><form id="map-filters-form">'+
  '<div class="filter-section"><h3>Tipo</h3><div class="filter-options">'+
  '<label class="filter-option"><input type="checkbox" name="type" value="lost" checked><span class="type-badge type-lost">Perdida</span></label>'+
  '<label class="filter-option"><input type="checkbox" name="type" value="found" checked><span class="type-badge type-found">Encontrada</span></label>'+
  '<label class="filter-option"><input type="checkbox" name="type" value="sighting" checked><span class="type-badge type-sighting">Avistamiento</span></label></div></div>'+
  '<div class="filter-section"><h3>Comuna</h3><label class="sr-only" for="map-commune">Filtrar por comuna</label><select id="map-commune" name="commune">'+communeOptionsHTML(cachedCommunes,"")+'</select><label class="sr-only" for="map-neighborhood">Barrio</label><select id="map-neighborhood" name="neighborhood"><option value="">Todos los barrios</option></select></div>'+ 
  '<div class="map-report-list"><h4>Reportes activos</h4><div id="map-report-items" class="map-report-items"></div><p id="map-empty-message" class="form-hint" hidden>No hay reportes con punto en el mapa. Abre un reporte sin ubicación para agregarla.</p></div>'+ 
  '<div class="map-legend"><h4>Leyenda</h4><div class="legend-items"><div class="legend-item"><span class="marker-icon lost"></span>Perdida</div><div class="legend-item"><span class="marker-icon found"></span>Encontrada</div><div class="legend-item"><span class="marker-icon sighting"></span>Avistamiento</div></div></div></form></aside>'+
  '<section class="map-main" aria-label="Mapa interactivo"><div id="map" class="map-container" role="region" aria-label="Mapa interactivo de reportes"></div><div class="map-controls"><button class="btn btn-primary" id="locate-me-btn">Mi ubicación</button><button type="button" class="btn btn-secondary" id="map-consent-manage">Preferencias del mapa</button></div></section></main>';
  bindNavLinks();
  $("#map-consent-manage").onclick=function(){try{localStorage.removeItem("fusapet-map-consent");}catch(e){}mapLibraryPromise=null;initMapPage();};
  var reports=await Data.getReports({statuses:["active"]});
  if(!(await ensureMapLibraries())){
    $("#map").innerHTML='<div class="map-fallback"><p>Mapa externo no cargado. Puedes consultar los reportes de la lista.</p><button class="btn btn-secondary" type="button" id="map-retry">Revisar opción de mapa</button></div>';
    $("#locate-me-btn").hidden=true;
    var fallbackList=$("#map-report-items");fallbackList.innerHTML=reports.reports.length?reports.reports.map(function(r){return '<button type="button" class="map-report-item" data-report-id="'+esc(r.id)+'"><span><strong>'+esc(r.petName)+'</strong><small>'+esc(r.neighborhood||r.location||"Sin ubicación")+'</small></span></button>';}).join(""):'<p class="form-hint">No hay reportes activos.</p>';
    fallbackList.querySelectorAll("[data-report-id]").forEach(function(button){button.onclick=function(){navigateTo("reports/"+button.dataset.reportId);};});
    $("#map-retry").onclick=function(){initMapPage();};return;
  }
  if(mapInstance){mapInstance.remove();mapInstance=null;}
  var map=L.map("map",{center:[4.3364,-74.3639],zoom:14,minZoom:1,zoomControl:true,dragging:true,touchZoom:true,doubleClickZoom:true,keyboard:true,maxBounds:[[-85,-180],[85,180]],maxBoundsViscosity:1});
  mapInstance=map;
  if(typeof L.maplibreGL!=="function"){showToast("No se pudo cargar el proveedor del mapa. Revisa tu conexión e inténtalo de nuevo.","error");return;}
  L.maplibreGL({style:FUSAGASUGA_MAP_STYLE,interactive:false}).addTo(map);
  map.dragging.enable();map.touchZoom.enable();map.doubleClickZoom.enable();map.keyboard.enable();
  L.control.scale({imperial:false}).addTo(map);
  var markersLayer=L.layerGroup().addTo(map);
  var typeColors={lost:"#d32f2f",found:"#2e7d32",sighting:"#1976d2"};
  var icons={lost:"🐕",found:"⚠️",sighting:"👁️"};
  var markersById={};
  function renderMarkers(list){
    markersLayer.clearLayers();
    markersById={};
    var publicReports=list.filter(function(r){return r.approvalStatus==="aprobado";});
    var listNode=$("#map-report-items"),emptyNode=$("#map-empty-message"),withLocation=publicReports.filter(function(r){return !r.moderated&&r.lat!=null&&r.lng!=null&&Number.isFinite(r.lat)&&Number.isFinite(r.lng);});
    if(listNode){listNode.innerHTML=publicReports.length?publicReports.map(function(r){return '<button type="button" class="map-report-item" data-report-id="'+esc(r.id)+'"><span class="map-report-dot '+getTypeClass(r.type)+'"></span><span><strong>'+esc(r.petName)+'</strong><small>'+esc(r.neighborhood||r.location||"Sin punto en el mapa")+'</small></span></button>';}).join(""):'<p class="form-hint">No hay reportes para estos filtros.</p>';}
    if(emptyNode)emptyNode.hidden=withLocation.length>0;
    publicReports.forEach(function(r){
      if(r.moderated||r.lat==null||r.lng==null||!Number.isFinite(r.lat)||!Number.isFinite(r.lng))return;
      var color=typeColors[r.type]||"#757575";
      var icon=L.divIcon({className:"custom-marker",html:'<div class="marker-pin" style="background:'+color+'"><span>'+(icons[r.type]||"📍")+'</span></div>',iconSize:[36,42],iconAnchor:[18,42]});
      var marker=L.marker([r.lat,r.lng],{icon:icon}).addTo(markersLayer);
      markersById[String(r.id)]=marker;
      var photosTxt=(r.photos&&r.photos.length)?'<div class="popup-photos">'+r.photos.slice(0,3).map(function(u){return '<img src="'+esc(u)+'" alt="Fotografía de la mascota reportada" width="60" height="60" loading="lazy">';}).join("")+'</div>':"";
      var placeTxt=(r.neighborhood||r.commune||r.location)?'<p class="popup-place">📍 '+(r.neighborhood?esc(r.neighborhood)+" ":"")+(r.commune?'<strong>'+esc(communeNameNative(r.commune))+'</strong>':"")+"</p>":"";
      var petDetails='<div class="popup-pet-details">'+(r.breed?'<p><strong>Raza:</strong> '+esc(r.breed)+'</p>':"")+(r.color?'<p><strong>Color:</strong> '+esc(r.color)+'</p>':"")+(r.size?'<p><strong>Tamaño:</strong> '+esc(r.size)+'</p>':"")+(r.characteristics?'<p><strong>Señas:</strong> '+esc(r.characteristics)+'</p>':"")+'</div>';
      var actionButtons='<div class="popup-report-actions"><button type="button" class="btn btn-secondary btn-sm" data-report-action="sighting">Reportar avistamiento</button>'+(r.type==="lost"?'<button type="button" class="btn btn-success btn-sm" data-report-action="found">La encontré</button>':"")+'</div>';
      marker.bindPopup('<div class="map-popup-card"><div class="popup-content">'+
        '<div class="popup-type '+getTypeClass(r.type)+'">'+getTypeLabel(r.type)+"</div>"+
        '<h4>'+esc(r.petName)+"</h4>"+
        petDetails+
        (r.location?'<p class="popup-location">'+esc(r.location)+"</p>":"")+ 
        placeTxt+
        photosTxt+
        actionButtons+
        '<button type="button" class="btn btn-primary btn-sm" data-report-view="'+esc(r.id)+'">Ver detalle</button>'+ 
        "</div></div>",{maxWidth:280,minWidth:220});
      marker.on("popupopen",function(ev){
        var viewButton=ev.popup.getElement().querySelector("[data-report-view]");
        if(viewButton)viewButton.onclick=function(){navigateTo("reports/"+r.id);};
        ev.popup.getElement().querySelectorAll("[data-report-action]").forEach(function(button){
          button.onclick=function(){
            pendingMapReportAction={reportId:r.id,action:button.dataset.reportAction};
            AuthService.isAuthenticated().then(function(authed){
              navigateTo(authed?"reports/"+r.id:"login");
              if(!authed)showToast("Inicia sesión para enviar esta información","info");
            });
          };
        });
      });
    });
    var layerList=markersLayer.getLayers();
    if(layerList.length){var group=L.featureGroup(layerList);map.fitBounds(group.getBounds().pad(0.15));}
    if(listNode)listNode.querySelectorAll("[data-report-id]").forEach(function(button){button.onclick=function(){var report=list.find(function(r){return String(r.id)===button.dataset.reportId;});var marker=markersById[button.dataset.reportId];if(marker){map.setView(marker.getLatLng(),Math.max(map.getZoom(),16));marker.openPopup();}else if(report){navigateTo("reports/"+report.id);}};});
  }
  renderMarkers(reports.reports);
  var communeSel=$("#map-commune"),neighborhoodSel=$("#map-neighborhood");
  async function applyMapFilters(){
    var types=$$('input[name="type"]:checked',$("#map-filters-form")).map(function(x){return x.value;});
    if(!types.length){renderMarkers([]);return;}
    var f={statuses:["active"],types:types};
    if(communeSel.value)f.commune=communeSel.value;
    if(neighborhoodSel.value)f.neighborhood=neighborhoodSel.value;
    var rr=await Data.getReports(f);renderMarkers(rr.reports);
  }
  if(communeSel){communeSel.onchange=function(){neighborhoodSel.innerHTML=barrioOptionsHTML(cachedBarrios,communeSel.value);if(!communeSel.value)neighborhoodSel.innerHTML='<option value="">Todos los barrios</option>';applyMapFilters();};}
  if(neighborhoodSel)neighborhoodSel.onchange=applyMapFilters;
  $$('#map-filters-form input[name="type"]').forEach(function(input){input.onchange=applyMapFilters;});
  if($("#locate-me-btn")){$("#locate-me-btn").onclick=function(){navigator.geolocation.getCurrentPosition(function(p){map.setView([p.coords.latitude,p.coords.longitude],14);showToast("Ubicación encontrada","success");},function(){showToast("No se pudo obtener ubicación","error");},{enableHighAccuracy:true});};}
}

async function initPetsPage(){
  bindNavLinks();
  var user=await AuthService.me();
  var profile=await AuthService.profile();
  await ensureCatalogs();
  var container=$("#app");
  container.innerHTML=navHTML(user,profile)+'<main class="app-main">'+
  '<div class="page-header"><div><h1>Mis Mascotas</h1><p class="page-subtitle">Registra y gestiona tus mascotas</p></div><button class="btn btn-primary" id="add-pet-btn">+ A\u00f1adir mascota</button></div>'+
  '<div class="pets-tabs">'+
  '  <button class="pets-tab active" data-tab="active">Mascotas activas</button>'+
  '  <button class="pets-tab" data-tab="history">Historial (eliminadas)</button>'+
  '</div>'+
  '<div id="pets-active" class="pets-tab-panel"><div id="pets-grid" class="pets-grid"></div></div>'+
  '<div id="pets-history" class="pets-tab-panel" hidden><div id="pets-history-grid" class="pets-grid"></div></div>'+
  '<div id="pet-modal" class="modal" hidden><div class="modal-backdrop"></div><div class="modal-content modal-lg"><header class="modal-header"><h2 id="pet-modal-title">Registrar mascota</h2><button class="modal-close">&times;</button></header>'+
  '<form id="pet-form" class="modal-body"><input type="hidden" name="id">'+
  '<div class="form-row"><div class="form-group"><label>Nombre *</label><input type="text" name="name" required maxlength="100"></div><div class="form-group"><label>Especie *</label><select name="speciesId" required><option value="">Seleccionar</option>'+cachedEspecies.map(function(e){return '<option value="'+e.id+'">'+e.nombre+'</option>';}).join("")+'</select></div></div>'+
  '<div class="form-row"><div class="form-group"><label>Raza</label><input type="text" name="breed" maxlength="100"></div><div class="form-group"><label>Color *</label><input type="text" name="color" required maxlength="100"></div></div>'+
  '<div class="form-row"><div class="form-group"><label>Tama\u00f1o *</label><select name="size" required><option value="">Seleccionar</option><option value="small">Peque\u00f1o</option><option value="medium">Mediano</option><option value="large">Grande</option></select></div><div class="form-group"><label>Sexo</label><select name="gender"><option value="">No especificado</option><option value="male">Macho</option><option value="female">Hembra</option></select></div></div>'+
  '<div class="form-group"><label>Se\u00f1as particulares</label><textarea name="characteristics" rows="3" maxlength="500"></textarea></div>'+
  '<div class="modal-actions"><button type="button" class="btn btn-secondary modal-close">Cancelar</button><button type="submit" class="btn btn-primary">Guardar</button></div></form></div></div>'+
  '</main>';
  bindNavLinks();

  var activePets=[];
  var historyPets=[];
  var grid=$("#pets-grid");
  var historyGrid=$("#pets-history-grid");

  $$(".pets-tab").forEach(function(tab){
    tab.onclick=function(){
      $$(".pets-tab").forEach(function(t){t.classList.remove("active");});
      tab.classList.add("active");
      var isHistory=tab.dataset.tab==="history";
      $("#pets-active").hidden=isHistory;
      $("#pets-history").hidden=!isHistory;
    };
  });

  async function loadPets(){
    activePets=await Data.getMyPets(false);
    historyPets=(await Data.getMyPets(true)).filter(function(p){return p.deletedAt;});
    renderActive();
    renderHistory();
  }

  function renderActive(){
    if(!activePets.length){
      grid.innerHTML='<div class="empty-state"><p>No tienes mascotas activas</p><button class="btn btn-primary" id="first-pet-btn">Registrar mascota</button></div>';
      var fpb=$("#first-pet-btn"); if(fpb)fpb.onclick=function(){openPetModal();};
      return;
    }
    grid.innerHTML=activePets.map(function(p){
      return '<article class="pet-card"><div class="pet-info"><h3 class="pet-name">'+esc(p.name)+'</h3><p class="pet-details">'+esc(p.species||"")+' \u2022 '+esc(p.breed||"Sin raza")+' \u2022 '+esc(p.color||"")+'</p><div class="pet-meta"><span class="pet-size">'+({small:"Peque\u00f1o",medium:"Mediano",large:"Grande"}[p.size]||"")+'</span></div></div><div class="pet-actions"><button class="icon-btn edit-pet" data-id="'+esc(p.id)+'" aria-label="Editar">\u270f\ufe0f</button><button class="icon-btn danger delete-pet" data-id="'+esc(p.id)+'" aria-label="Eliminar">\uD83D\uDDD1\uFE0F</button></div></article>';
    }).join("");
    bindPetActions();
  }

  function renderHistory(){
    if(!historyPets.length){
      historyGrid.innerHTML='<div class="empty-state"><p>Historial vac\u00edo</p><p class="text-muted">Las mascotas eliminadas aparecer\u00e1n aqu\u00ed</p></div>';
      return;
    }
    historyGrid.innerHTML=historyPets.map(function(p){
      var fecha=p.deletedAt?formatDate(p.deletedAt):"";
      return '<article class="pet-card history-card"><div class="pet-info"><h3 class="pet-name">'+esc(p.name)+' <span class="history-badge">Eliminada</span></h3><p class="pet-details">'+esc(p.species||"")+' \u2022 '+esc(p.breed||"Sin raza")+' \u2022 '+esc(p.color||"")+'</p><div class="pet-meta"><span class="pet-size">'+({small:"Peque\u00f1o",medium:"Mediano",large:"Grande"}[p.size]||"")+'</span><span class="history-date">Eliminada: '+esc(fecha)+'</span></div></div><div class="pet-actions"><button class="icon-btn restore-pet" data-id="'+esc(p.id)+'" aria-label="Restaurar">\u267B\ufe0f</button></div></article>';
    }).join("");
    $$(".restore-pet").forEach(function(b){
      b.onclick=async function(){
        var pet=historyPets.find(function(x){return x.id===b.dataset.id;});
        if(pet&&confirm("Restaurar a "+pet.name+"?")){
          try{await Data.restorePet(pet.id);showToast("Mascota restaurada","success");await loadPets();}
          catch(e){showToast(e.message,"error");}
        }
      };
    });
  }

  function bindPetActions(){
    $$(".edit-pet").forEach(function(b){b.onclick=function(){var pet=activePets.find(function(x){return x.id===b.dataset.id;});openPetModal(pet);};});
    $$(".delete-pet").forEach(function(b){b.onclick=async function(){var pet=activePets.find(function(x){return x.id===b.dataset.id;});if(pet&&confirm("Eliminar a "+pet.name+"? Pasar\u00e1 al historial.")){try{await Data.deletePet(pet.id);showToast("Mascota movida al historial","success");await loadPets();}catch(e){showToast(e.message,"error");}}};});
  }

  function openPetModal(pet){
    showModal("pet-modal");
    var f=$("#pet-form"); f.reset();
    $("#pet-modal-title").textContent=pet?"Editar mascota":"Registrar mascota";
    $('input[name="id"]').value=pet?pet.id:"";
    if(pet){
      f.name.value=pet.name; f.speciesId.value=pet.speciesId||""; f.breed.value=pet.breed||""; f.color.value=pet.color||""; f.size.value=pet.size||""; f.characteristics.value=pet.characteristics||"";
    }
  }

  $$("#pet-modal .modal-close, #pet-modal .modal-backdrop").forEach(function(el){el.onclick=function(){hideModal("pet-modal");};});
  $("#add-pet-btn").onclick=function(){openPetModal(null);};

  $("#pet-form").onsubmit=async function(e){
    e.preventDefault();
    var d=new FormData(e.target);
    var name=d.get("name"),speciesId=d.get("speciesId"),color=d.get("color"),size=d.get("size");
    if(!name||!speciesId||!color||!size){showToast("Completa los campos obligatorios","error");return;}
    var id=$('input[name="id"]').value;
    var data={name:name,speciesId:speciesId||null,breed:d.get("breed")||"",color:color,size:size,gender:d.get("gender")||"",characteristics:d.get("characteristics")||""};
    try{
      if(id){await Data.updatePet(id,data);showToast("Mascota actualizada","success");}
      else{await Data.createPet(data);showToast("Mascota registrada","success");}
      hideModal("pet-modal");await loadPets();
    }catch(err){showToast(err.message,"error");}
  };

  await loadPets();
}

async function initReportsList(){
  bindNavLinks();
  var user=await AuthService.me();
  var profile=await AuthService.profile();
  await ensureCatalogs();
  var container=$("#app");
  container.innerHTML=navHTML(user,profile)+'<main class="app-main">'+
  '<div class="page-header"><div><h1>Reportes</h1><p class="page-subtitle">Busca y gestiona reportes</p></div><a href="#reports/new" class="btn btn-primary">+ Nuevo reporte</a></div>'+
  '<div class="reports-layout"><aside class="reports-filters"><form id="filters-form">'+
  '<div class="filter-section"><h3>Búsqueda</h3><div class="form-group"><label class="sr-only" for="search-query">Buscar por nombre, color o ubicación</label><input type="search" id="search-query" name="query" placeholder="Nombre, color, ubicación..."></div></div>'+ 
  '<div class="filter-section"><h3>Tipo</h3><div class="filter-options"><label class="filter-option"><input type="checkbox" name="type" value="lost" checked><span>Perdida</span></label><label class="filter-option"><input type="checkbox" name="type" value="found" checked><span>Encontrada</span></label><label class="filter-option"><input type="checkbox" name="type" value="sighting" checked><span>Avistamiento</span></label></div></div>'+
  '<div class="filter-section"><h3>Comuna</h3><label class="sr-only" for="filter-commune">Filtrar por comuna</label><select id="filter-commune" name="commune">'+communeOptionsHTML(cachedCommunes,"")+'</select></div>'+ 
  '<div class="filter-actions"><button type="button" class="btn btn-secondary" id="clear-filters">Limpiar</button><button type="submit" class="btn btn-primary">Filtrar</button></div></form></aside>'+
  '<section class="reports-results" aria-label="Resultados de reportes"><div class="results-header"><span id="results-count">Cargando...</span></div>'+ 
  '<div id="reports-container" class="reports-container reports-list"></div></section></div>'+ 
  '<div id="similar-sightings-modal" class="modal" hidden><div class="modal-backdrop"></div><div class="modal-content modal-lg"><header class="modal-header"><h2 id="similar-sightings-title">Avistamientos parecidos</h2><button type="button" class="modal-close" aria-label="Cerrar">&times;</button></header><div class="modal-body"><p class="form-hint">Los resultados se ordenan por similitud entre las categorías que detecta el modelo. Son sugerencias, no identificación confirmada.</p><div id="similar-sightings-results" class="similar-sightings-results" role="status" aria-live="polite"></div></div></div></div>'+ 
  '</main>';
  bindNavLinks();
  $$("#similar-sightings-modal .modal-close, #similar-sightings-modal .modal-backdrop").forEach(function(el){el.onclick=function(){hideModal("similar-sightings-modal");};});
  var filters={types:["lost","found","sighting"]};
  async function loadReports(){
    filters.types=Array.from($$('input[name="type"]:checked').map(function(c){return c.value;}));
    filters.query=$("#search-query")?$("#search-query").value:"";
    filters.commune=$("#filter-commune")?$("#filter-commune").value:"";
    var result=await Data.getReports(filters);
    var reports=result.reports;
    var rc=$("#results-count");if(rc)rc.textContent=reports.length+" reporte"+(reports.length!==1?"s":"");
    var ctr=$("#reports-container");if(!ctr)return;
    if(!reports.length){ctr.innerHTML='<div class="empty-state"><p>No se encontraron reportes</p><a href="#reports/new" class="btn-hero"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Crear reporte</a></div>';return;}
    ctr.innerHTML=reports.map(function(r){var s=r.approvalStatus==="pendiente"?"pending":r.approvalStatus==="rechazado"?"rejected":(r.moderated?"moderated":r.status);var searchButton=user&&String(r.userId)===String(user.id)&&r.type==="lost"&&r.approvalStatus==="aprobado"&&!r.moderated?'<button type="button" class="btn btn-secondary btn-sm find-similar-sightings" data-report-id="'+esc(r.id)+'">Buscar avistamientos parecidos</button>':"";return '<article class="report-card" data-id="'+esc(r.id)+'" tabindex="0"><div class="report-type '+getTypeClass(r.type)+'">'+getTypeLabel(r.type)+'</div><div class="report-info"><div class="report-header"><h4>'+esc(r.petName)+'</h4><span class="report-status '+getStatusClass(s)+'">'+getStatusLabel(s)+'</span></div><p class="report-location">'+esc(r.neighborhood||"")+'</p><p class="report-date">'+timeAgo(r.createdAt)+'</p></div><div class="report-code">'+esc(r.code)+'</div>'+searchButton+'</article>';}).join("");
    $$(".report-card").forEach(function(c){c.onclick=function(){navigateTo("reports/"+c.dataset.id);};});
    bindReportCardKeyboard(ctr);
    $$(".find-similar-sightings",ctr).forEach(function(button){button.onclick=function(event){event.stopPropagation();showSimilarSightings(button.dataset.reportId);};});
  }
  async function showSimilarSightings(reportId){
    var resultNode=$("#similar-sightings-results");var titleNode=$("#similar-sightings-title");
    if(!resultNode)return;
    resultNode.textContent="Cargando fotos y avistamientos…";showModal("similar-sightings-modal");
    try{
      var report=await Data.getReportById(reportId);
      if(!report||!report.photos||!report.photos.length){resultNode.textContent="Este reporte no tiene fotos para comparar. Añade una foto al reporte y vuelve a intentarlo.";return;}
      if(titleNode)titleNode.textContent="Avistamientos parecidos a "+report.petName;
      var candidates=await Data.getSightingPhotoCandidates();
      if(!candidates.length){resultNode.textContent="Todavía no hay avistamientos con foto guardada para comparar.";return;}
      resultNode.textContent="Cargando el modelo y analizando "+candidates.length+" foto"+(candidates.length===1?"":"s")+"…";
      var ownerPredictions=[];
      for(var pi=0;pi<report.photos.length;pi++){try{ownerPredictions.push(await predictImageUrl(report.photos[pi]));}catch(ownerImageError){console.warn("No se pudo analizar una foto del reporte",ownerImageError);}}
      if(!ownerPredictions.length){resultNode.textContent="No se pudieron analizar las fotos del reporte. Revisa que el reporte tenga fotos accesibles y vuelve a intentar.";return;}
      var ranked=[];
      for(var ci=0;ci<candidates.length;ci++){
        try{
          var candidatePrediction=await predictImageUrl(candidates[ci].photoUrl);
          var score=ownerPredictions.reduce(function(best,p){return Math.max(best,comparePredictionClasses(p,candidatePrediction));},0);
          ranked.push({item:candidates[ci],score:score});
        }catch(candidateImageError){console.warn("No se pudo comparar una foto de avistamiento",candidateImageError);}
        resultNode.textContent="Comparando fotos: "+(ci+1)+" de "+candidates.length+"…";
      }
      ranked.sort(function(a,b){return b.score-a.score;});
      if(!ranked.length){resultNode.textContent="No se pudieron comparar las fotos. Inténtalo de nuevo más tarde.";return;}
      resultNode.innerHTML='<p>Se encontraron '+ranked.length+' fotos de avistamientos. Están ordenadas de mayor a menor similitud orientativa:</p><div class="similar-sightings-grid">'+ranked.map(function(row){var item=row.item;return '<article class="similar-sighting-card"><img src="'+esc(item.photoUrl)+'" alt="Foto del avistamiento de '+esc(item.petName)+'" loading="lazy"><div><strong>'+esc(item.petName)+'</strong><p>'+esc(getTypeLabel(item.type))+' · '+formatDate(item.date)+'</p><p>'+esc(item.location||"Ubicación no especificada")+'</p><p>Similitud de categorías: '+Math.round(row.score*100)+'% (orientativa)</p><button type="button" class="btn btn-secondary btn-sm open-sighting-report" data-report-id="'+esc(item.reportId)+'">Ver reporte</button></div></article>';}).join("")+'</div>';
      $$(".open-sighting-report",resultNode).forEach(function(button){button.onclick=function(){hideModal("similar-sightings-modal");navigateTo("reports/"+button.dataset.reportId);};});
    }catch(error){resultNode.textContent="No se pudieron buscar avistamientos: "+(error.message||"error inesperado");}
  }
  $("#filters-form").onsubmit=function(e){e.preventDefault();loadReports();};
  $("#clear-filters").onclick=function(){if($("#search-query"))$("#search-query").value="";if($("#filter-commune"))$("#filter-commune").value="";$$('input[name="type"]').forEach(function(c){c.checked=true;});loadReports();};
  if($("#search-query")){
    var debounceTimer;
    $("#search-query").oninput=function(){clearTimeout(debounceTimer);debounceTimer=setTimeout(loadReports,400);};
  }
  loadReports();
}

async function initReportForm(){
  bindNavLinks();
  var user=await AuthService.me();
  var profile=await AuthService.profile();
  await ensureCatalogs();
  var container=$("#app");
  var myPets=await Data.getMyPets();
  container.innerHTML=navHTML(user,profile)+'<main class="app-main">'+
  '<div class="page-header"><h1>Nuevo Reporte</h1><p class="page-subtitle">Ayuda a encontrar una mascota</p></div>'+(profile&&profile.rol==="administrador"?"":'<p class="form-hint">Tu reporte será revisado por un administrador antes de aparecer públicamente.</p>')+ 
  '<form id="report-form" class="report-form">'+
  '<div class="form-section"><h2>Tipo de reporte</h2><div class="report-type-selector">'+
  '<label class="type-option"><input type="radio" name="type" value="lost" required><span class="type-card type-lost"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg><span>Perdida</span><small>Mi mascota se perdió</small></span></label>'+
  '<label class="type-option"><input type="radio" name="type" value="found"><span class="type-card type-found"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span>Encontrada</span><small>Encontré una mascota</small></span></label>'+
  '<label class="type-option"><input type="radio" name="type" value="sighting"><span class="type-card type-sighting"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg><span>Avistamiento</span><small>Vi una mascota reportada</small></span></label></div></div>'+
  '<div class="form-section"><h2>Información</h2>'+
  '<div class="form-row"><div class="form-group"><label>Nombre de la mascota *</label><input type="text" name="petName" required maxlength="100"></div><div class="form-group"><label>Especie *</label><select name="speciesId" required><option value="">Seleccionar</option>'+cachedEspecies.map(function(e){return '<option value="'+e.id+'">'+e.nombre+'</option>';}).join("")+'</select></div></div>'+
  '<div class="form-row"><div class="form-group"><label>Color *</label><input type="text" name="color" required maxlength="100"></div><div class="form-group"><label>Tamaño *</label><select name="size" required><option value="">Seleccionar</option><option value="small">Pequeño</option><option value="medium">Mediano</option><option value="large">Grande</option></select></div></div>'+
  '<div class="form-row"><div class="form-group"><label>Comuna *</label><select id="report-commune" name="commune" required>'+communeOptionsHTML(cachedCommunes,"")+'</select></div><div class="form-group"><label>Barrio *</label><select id="report-neighborhood" name="barrio" required disabled><option value="">Seleccione comuna</option></select></div></div>'+
  '<div class="form-row"><div class="form-group"><label>Fecha</label><input type="datetime-local" name="date" value="'+new Date().toISOString().slice(0,16)+'"></div></div>'+
  '<div class="form-group"><label>Dirección o referencia del lugar donde se perdió / encontró *</label><input type="text" name="location" required maxlength="200" placeholder="Ej. Calle 9 # 8-20, cerca al parque principal"></div>'+ 
  '<div class="form-group"><h3>Ubicación en el mapa (opcional)</h3><p class="form-hint">Si aceptas cargar el mapa externo, haz clic para señalar el lugar. También puedes publicar solo con la dirección escrita.</p><div id="report-location-map" class="report-location-map" role="application" aria-label="Mapa para seleccionar dónde ocurrió el reporte"></div><div class="location-map-status" id="report-location-status" aria-live="polite">El punto en el mapa es opcional.</div></div>'+ 
  '<div class="form-group"><label>Señas / descripción</label><textarea name="characteristics" rows="3" maxlength="500"></textarea></div></div>'+ 
  '<div class="form-section"><h2>Fotografías</h2><div class="form-group"><label for="report-photos">Adjuntar hasta 5 fotos (JPG, PNG o WebP; máximo 5 MB cada una)</label><input id="report-photos" type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple></div></div>'+ 
  '<div class="form-section"><h2>Información de contacto</h2>'+
  '<div class="form-row"><div class="form-group"><label>Tu nombre *</label><input type="text" name="contactName" required maxlength="100" value="'+esc(profile?profile.nombre:"")+'"></div><div class="form-group"><label>Celular de Colombia *</label><input type="tel" name="contactPhone" required placeholder="+57 300 123 4567" value="'+esc(profile?normalizeColombianPhone(profile.telefono):"")+'"><span class="field-hint">Se guardará con el indicativo +57 y permitirá contactarte por WhatsApp.</span></div></div>'+
  '<div class="form-group"><label class="checkbox-label"><input type="checkbox" name="showContact" required> Autorizo mostrar mi nombre y teléfono del perfil a usuarios registrados que consulten este reporte</label></div></div>'+ 
  '<div class="form-actions"><button type="submit" class="btn btn-primary">Publicar reporte</button></div></form>'+
  '<div id="success-modal" class="modal" hidden><div class="modal-backdrop"></div><div class="modal-content"><header class="modal-header"><h2 id="report-result-title">Reporte recibido</h2><button class="modal-close">&times;</button></header><div class="modal-body success-content"><div class="success-icon">✅</div><h3 id="report-result-message">Tu reporte ha sido publicado</h3><p>Código: <strong id="published-code"></strong></p><div class="success-actions"><button class="btn btn-primary" id="share-report-btn">Compartir</button><button class="btn btn-secondary modal-close">Cerrar</button></div></div></div></div>'+ 
  '</main>';
  bindNavLinks();
  var form=$("#report-form");
  var communeSel=$("#report-commune");
  var barrioSel=$("#report-neighborhood");
  communeSel.onchange=function(){barrioSel.innerHTML=barrioOptionsHTML(cachedBarrios,communeSel.value);barrioSel.disabled=!communeSel.value;};
  var reportLat=null,reportLng=null,reportPin=null,reportMap=null;
  var mapAllowed=await ensureMapLibraries();
  if(!mapAllowed){$("#report-location-map").innerHTML='<p class="map-fallback">Publica con la dirección de texto; las coordenadas son opcionales.</p>';}
  if(mapAllowed){
    reportMap=L.map("report-location-map",{center:[4.3364,-74.3639],zoom:15,minZoom:1,dragging:true,touchZoom:true,doubleClickZoom:true});
    if(typeof L.maplibreGL!=="function"){showToast("No se pudo cargar el proveedor del mapa. Revisa tu conexión e inténtalo de nuevo.","error");return;}
    L.maplibreGL({style:FUSAGASUGA_MAP_STYLE,interactive:false}).addTo(reportMap);
    reportMap.dragging.enable();reportMap.touchZoom.enable();reportMap.doubleClickZoom.enable();
    reportMap.on("click",function(ev){reportLat=ev.latlng.lat;reportLng=ev.latlng.lng;if(reportPin)reportPin.setLatLng(ev.latlng);else reportPin=L.marker(ev.latlng,{draggable:true}).addTo(reportMap);reportPin.on("dragend",function(){var p=reportPin.getLatLng();reportLat=p.lat;reportLng=p.lng;});$("#report-location-status").textContent="Punto seleccionado: "+reportLat.toFixed(6)+", "+reportLng.toFixed(6);});
    requestAnimationFrame(function(){reportMap.invalidateSize();});
  }
  $$("#success-modal .modal-close, #success-modal .modal-backdrop").forEach(function(el){el.onclick=function(){hideModal("success-modal");};});
  form.onsubmit=async function(e){
    e.preventDefault();
    var d=new FormData(form);
    var type=d.get("type"),petName=d.get("petName"),speciesId=d.get("speciesId"),color=d.get("color"),size=d.get("size"),commune=d.get("commune"),barrio=d.get("barrio"),location=d.get("location"),contactName=d.get("contactName"),contactPhone=normalizeColombianPhone(d.get("contactPhone"));
    if(!type||!petName||!speciesId||!color||!size||!commune||!barrio||!location||!contactName||!contactPhone){showToast("Completa todos los campos obligatorios","error");return;}
    if((reportLat==null)!==(reportLng==null)){showToast("La ubicación del reporte no está completa","error");return;}
    var photoFiles=d.getAll("photos").filter(function(f){return f&&f.size;});
    if(photoFiles.length>5||photoFiles.some(function(f){return ["image/jpeg","image/png","image/webp"].indexOf(f.type)<0||f.size>5242880;})){showToast("Adjunta hasta 5 fotos JPG, PNG o WebP de máximo 5 MB cada una","error");return;}
    var reportData={type:type,petName:petName,speciesId:speciesId,color:color,size:size,barrioId:parseInt(barrio),location:location,characteristics:d.get("characteristics")||"",date:d.get("date")||null,lat:reportLat,lng:reportLng,photoFiles:photoFiles,contactoVisible:d.get("showContact")==="on"};
    try{
      await Data.updateMyProfile(contactName,contactPhone);
      var rep=await Data.createReport(reportData);
      var code=$("#published-code");if(code)code.textContent=rep.codigo_unico;
      var pendingReview=rep.revision_estado==="pendiente";var resultTitle=$("#report-result-title"),resultMessage=$("#report-result-message");
      if(resultTitle)resultTitle.textContent=pendingReview?"Reporte enviado a revisión":"¡Publicado!";
      if(resultMessage)resultMessage.textContent=pendingReview?"Un administrador revisará tu reporte antes de publicarlo.":"Tu reporte ha sido publicado";
      var shareButton=$("#share-report-btn");if(shareButton)shareButton.hidden=pendingReview;
      showModal("success-modal");showToast(pendingReview?"Reporte enviado para aprobación":"Reporte publicado","success");
      if($("#share-report-btn")){$("#share-report-btn").onclick=function(){var url=window.location.origin+"#reports/"+rep.id;if(navigator.clipboard){navigator.clipboard.writeText(url);showToast("Enlace copiado","success");}};}
    }catch(err){showToast(err.message,"error");}
  };
}

async function initReportDetail(){
  bindNavLinks();
  await ensureCatalogs();
  var hash=window.location.hash.split("/");var id=hash[hash.length-1];
  var user=await AuthService.me();
  var profile=await AuthService.profile();
  var report=await Data.getReportById(id);
  var container=$("#app");
  if(!report){showToast("Reporte no encontrado","error");navigateTo("reports");return;}
  var isAuthor=user&&report.userId===user.id;
  var sightings=report.sightings||[];
  container.innerHTML=navHTML(user,profile)+'<main class="app-main">'+
  '<div class="page-header"><div><h1>Detalle del Reporte</h1><p class="page-subtitle" id="report-code-display">'+esc(report.code)+'</p></div><div class="header-actions"><button class="btn btn-secondary" id="back-btn">Volver</button></div></div>'+ 
  '<div class="detail-grid"><div class="detail-main"><div class="detail-info"><div class="detail-header"><div class="report-type '+getTypeClass(report.type)+'">'+getTypeLabel(report.type)+'</div><span class="report-status '+getStatusClass(report.approvalStatus==="pendiente"?"pending":report.approvalStatus==="rechazado"?"rejected":(report.moderated?"moderated":report.status))+'">'+getStatusLabel(report.approvalStatus==="pendiente"?"pending":report.approvalStatus==="rechazado"?"rejected":(report.moderated?"moderated":report.status))+'</span></div>'+ 
  '<h2>'+esc(report.petName)+'</h2><div class="detail-meta"><span><strong>Color:</strong> '+esc(report.color||"-")+'</span><span><strong>Tamaño:</strong> '+esc(report.size||"-")+'</span></div>'+ 
  (report.photos&&report.photos.length?'<div class="detail-section"><h3>Fotografías</h3><div class="report-photo-gallery">'+report.photos.map(function(url){return '<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer"><img src="'+esc(url)+'" alt="Fotografía de '+esc(report.petName)+' del reporte" width="480" height="360" loading="lazy" decoding="async"></a>';}).join("")+'</div></div>':"")+ 
  (report.characteristics?'<div class="detail-section"><h3>Señas</h3><p>'+esc(report.characteristics)+'</p></div>':"")+ 
  '<div class="detail-section"><h3>Lugar donde ocurrió</h3><p>'+esc(report.location||"")+(report.neighborhood?', '+esc(report.neighborhood):"")+(report.commune?', '+esc(report.commune):"")+'</p>'+(report.lat!=null&&report.lng!=null?'<div id="report-detail-map" class="report-detail-map" role="region" aria-label="Mapa del lugar donde ocurrió el reporte"></div>':(isAuthor&&report.status==="active"&&!report.moderated?'<p class="form-hint">Este reporte todavía no tiene un punto en el mapa. Puedes agregar el lugar correcto.</p><button type="button" class="btn btn-secondary btn-sm" id="select-report-location">Ubicar en el mapa</button>':'<p class="form-hint">Este reporte no tiene un punto guardado en el mapa.</p>'))+'</div>'+ 
  '<div class="detail-section"><h3>Fecha</h3><p>'+formatDate(report.date||report.createdAt)+'</p></div></div></div>'+
  '<div class="detail-sidebar">'+(user?'<div class="sidebar-card"><h3>Contacto</h3><p><strong>'+esc(report.contactName||"")+'</strong></p><p><a href="https://wa.me/'+whatsappPhone(report.contactPhone)+'" target="_blank" rel="noopener noreferrer">Abrir WhatsApp ('+esc(normalizeColombianPhone(report.contactPhone))+')</a></p></div>':'<div class="sidebar-card"><h3>Contacto</h3><p><a href="#login">Inicia sesión para ver los datos de contacto</a></p></div>')+
  '<div class="sidebar-card"><h3>Acciones</h3><div class="action-buttons">'+
  (user&&report.approvalStatus==="aprobado"&&!report.moderated?'<button class="btn btn-secondary btn-sm" id="add-sighting-btn">Señalar avistamiento</button>':'')+ 
  '<button class="btn btn-secondary btn-sm" id="share-btn">Compartir</button>'+
  (isAuthor&&report.status==="active"&&!report.moderated?'<button class="btn btn-success btn-sm" id="close-report-btn">Cerrar reporte</button>':"")+ 
  (user?'<button class="btn btn-danger btn-sm" id="flag-btn">Denunciar</button>':'')+ 
  '</div></div></div></div>'+
  (sightings.length?'<div class="sightings-section"><h3>Novedades ('+sightings.length+')</h3><div class="sightings-list">'+sightings.map(function(s){return '<div class="sighting-card"><div class="sighting-header">'+(s.found?'<span class="type-badge type-found">Mascota encontrada</span>':'<span class="type-badge type-sighting">Avistamiento</span>')+'<span class="sighting-date">'+formatDate(s.date)+'</span><span class="sighting-location">'+esc(s.location||"")+'</span></div>'+(s.description?'<p class="sighting-desc">'+esc(s.description)+'</p>':"")+'</div>';}).join('')+'</div></div>':"")+ 
  (report.lat==null||report.lng==null?'<div id="edit-report-location-modal" class="modal" hidden><div class="modal-backdrop"></div><div class="modal-content modal-lg"><header class="modal-header"><h2>Ubica el lugar del reporte</h2><button type="button" class="modal-close">&times;</button></header><form id="edit-report-location-form" class="modal-body"><p class="form-hint">Haz clic en el mapa para marcar dónde se perdió o encontró la mascota.</p><div id="edit-report-location-map" class="report-location-map"></div><div id="edit-report-location-status" class="location-map-status" aria-live="polite">Selecciona un punto.</div><div class="modal-actions"><button type="button" class="btn btn-secondary modal-close">Cancelar</button><button type="submit" class="btn btn-primary">Guardar ubicación</button></div></form></div></div>':"")+ 
  '<div id="add-sighting-modal" class="modal" hidden><div class="modal-backdrop"></div><div class="modal-content modal-lg"><header class="modal-header"><h2 id="sighting-modal-title">Registrar avistamiento</h2><button class="modal-close">&times;</button></header>'+ 
  '<form id="sighting-form" class="modal-body"><input type="hidden" name="reportId" value="'+report.id+'">'+
  '<div class="form-group"><label>¿Qué ocurrió? *</label><select name="action" required><option value="sighting">Vi la mascota (avistamiento)</option><option value="found">Encontré la mascota</option></select><small>Si la encontraste, el dueño recibirá un aviso y podrá cerrar el reporte.</small></div>'+ 
  '<div class="form-row"><div class="form-group"><label>Fecha *</label><input type="datetime-local" name="date" required value="'+new Date().toISOString().slice(0,16)+'"></div><div class="form-group"><label>Comuna *</label><select id="sighting-commune" name="commune" required>'+communeOptionsHTML(cachedCommunes,"")+'</select></div></div>'+
  '<div class="form-group"><label>Barrio *</label><select id="sighting-neighborhood" name="barrio" required disabled><option value="">Seleccione comuna</option></select></div>'+
  '<div class="form-group"><label>Ubicación *</label><input type="text" name="location" required maxlength="200"></div>'+ 
  '<div class="form-group"><label>Descripción</label><textarea name="description" rows="3" maxlength="500" placeholder="Describe cómo estaba la mascota o dónde la viste"></textarea></div>'+ 
  '<div class="form-group"><label for="sighting-photo">Foto del avistamiento (opcional)</label><input id="sighting-photo" type="file" name="photo" accept="image/jpeg,image/png,image/webp"><small>JPG, PNG o WebP; máximo 5 MB. Se analiza en este navegador y se guarda con el avistamiento para ayudar a encontrar coincidencias.</small></div><div id="sighting-match-result" class="sighting-match-result" role="status" aria-live="polite" hidden></div>'+ 
  '<div class="modal-actions"><button type="button" class="btn btn-secondary modal-close">Cancelar</button><button type="submit" class="btn btn-primary">Registrar</button></div></form></div></div>'+ 
  '<div id="flag-modal" class="modal" hidden><div class="modal-backdrop"></div><div class="modal-content"><header class="modal-header"><h2>Denunciar</h2><button class="modal-close">&times;</button></header>'+
  '<form id="flag-form" class="modal-body"><input type="hidden" name="reportId" value="'+report.id+'">'+
  '<div class="form-group"><label>Motivo *</label><div class="radio-group"><label class="radio-option"><input type="radio" name="reason" value="fake" required> Información falsa</label><label class="radio-option"><input type="radio" name="reason" value="inappropriate"> Contenido inapropiado</label><label class="radio-option"><input type="radio" name="reason" value="spam"> Spam</label></div></div>'+
  '<div class="modal-actions"><button type="button" class="btn btn-secondary modal-close">Cancelar</button><button type="submit" class="btn btn-danger">Enviar</button></div></form></div></div>'+
  '</main>';
  bindNavLinks();
  var pendingAction=pendingMapReportAction&&String(pendingMapReportAction.reportId)===String(report.id)?pendingMapReportAction:null;
  if(pendingAction)pendingMapReportAction=null;
  if(report.lat!=null&&report.lng!=null&&await ensureMapLibraries()){
    var detailMap=L.map("report-detail-map",{center:[report.lat,report.lng],zoom:16,scrollWheelZoom:false,dragging:true,touchZoom:true});
    if(typeof L.maplibreGL==="function")L.maplibreGL({style:FUSAGASUGA_MAP_STYLE,interactive:false}).addTo(detailMap);
    detailMap.dragging.enable();detailMap.touchZoom.enable();
    L.marker([report.lat,report.lng]).addTo(detailMap).bindPopup(esc(report.location||"Lugar del reporte")).openPopup();
    requestAnimationFrame(function(){detailMap.invalidateSize();});
  }else if(report.lat!=null&&report.lng!=null){
    var detailMapPlaceholder=$("#report-detail-map");if(detailMapPlaceholder)detailMapPlaceholder.innerHTML='<p class="map-fallback">El mapa externo no se cargó. La dirección del reporte se muestra en el texto anterior.</p>';
  }
  if($("#select-report-location")){
    var editLocationMap=null,editLocationMarker=null,editLat=null,editLng=null;
    $$("#edit-report-location-modal .modal-close, #edit-report-location-modal .modal-backdrop").forEach(function(el){el.onclick=function(){hideModal("edit-report-location-modal");};});
    $("#select-report-location").onclick=async function(){
      if(!(await ensureMapLibraries())){showToast("No se cargó el mapa. Puedes conservar la ubicación escrita.","info");return;}
      showModal("edit-report-location-modal");
      requestAnimationFrame(function(){
        if(!editLocationMap){
          if(typeof L.maplibreGL!=="function"){showToast("No se pudo cargar el mapa","error");return;}
          editLocationMap=L.map("edit-report-location-map",{center:[4.3364,-74.3639],zoom:15,dragging:true,touchZoom:true,minZoom:1});
          L.maplibreGL({style:FUSAGASUGA_MAP_STYLE,interactive:false}).addTo(editLocationMap);
          editLocationMap.dragging.enable();editLocationMap.touchZoom.enable();
          editLocationMap.on("click",function(ev){editLat=ev.latlng.lat;editLng=ev.latlng.lng;if(editLocationMarker)editLocationMarker.setLatLng(ev.latlng);else editLocationMarker=L.marker(ev.latlng).addTo(editLocationMap);$("#edit-report-location-status").textContent="Punto seleccionado: "+editLat.toFixed(6)+", "+editLng.toFixed(6);});
        }
        editLocationMap.invalidateSize();
      });
    };
    $("#edit-report-location-form").onsubmit=async function(e){
      e.preventDefault();
      if(editLat==null||editLng==null){showToast("Selecciona en el mapa el lugar del reporte","error");return;}
      try{await Data.updateReportLocation(report.id,editLat,editLng);hideModal("edit-report-location-modal");showToast("Ubicación guardada. El reporte ya puede aparecer en el mapa.","success");await initReportDetail();}
      catch(err){showToast(err.message,"error");}
    };
  }
  var sCommune=$("#sighting-commune");var sBarrio=$("#sighting-neighborhood");
  if(sCommune){sCommune.onchange=function(){sBarrio.innerHTML=barrioOptionsHTML(cachedBarrios,sCommune.value);sBarrio.disabled=!sCommune.value;};}
  function openSightingModal(action){action=action||"sighting";var sightingForm=$("#sighting-form");if(sightingForm){sightingForm.reset();sightingForm.querySelector('[name="action"]').value=action;}var matchBox=$("#sighting-match-result");if(matchBox){matchBox.hidden=true;matchBox.textContent="";}$("#sighting-modal-title").textContent=action==="found"?"Informar mascota encontrada":"Registrar avistamiento";showModal("add-sighting-modal");}
  if($("#add-sighting-btn"))$("#add-sighting-btn").onclick=function(){openSightingModal("sighting");};
  if(pendingAction)openSightingModal(pendingAction.action);
  var sightingPhoto=$("#sighting-photo"),sightingMatchBox=$("#sighting-match-result");
  if(sightingPhoto)sightingPhoto.onchange=async function(){
    var file=sightingPhoto.files&&sightingPhoto.files[0];if(!file||!sightingMatchBox)return;
    sightingMatchBox.hidden=false;sightingMatchBox.textContent="Analizando la foto en este navegador…";
    if(["image/jpeg","image/png","image/webp"].indexOf(file.type)<0||file.size>5242880){sightingMatchBox.textContent="Elige una imagen JPG, PNG o WebP de máximo 5 MB.";return;}
    try{
      var newPrediction=await predictImageFile(file);var best=null;
      for(var photoIndex=0;photoIndex<(report.photos||[]).length;photoIndex++){
        try{var oldPrediction=await predictImageUrl(report.photos[photoIndex]);var score=comparePredictionClasses(newPrediction,oldPrediction);if(!best||score>best.score)best={score:score,prediction:oldPrediction};}catch(imageError){console.warn("No se pudo analizar una foto del reporte",imageError);}
      }
      var lead=newPrediction.slice().sort(function(a,b){return b.probability-a.probability;})[0];
      var leadLabel=lead?esc(lead.className)+" ("+Math.round(lead.probability*100)+"%)":"";
      if(best){sightingMatchBox.textContent="Categoría más probable en el avistamiento: "+(leadLabel||"sin resultado")+". Similitud entre resultados del modelo y las fotos del reporte: "+Math.round(best.score*100)+"% (orientativa; no confirma que sea el mismo perro).";}
      else if(report.photos&&report.photos.length){sightingMatchBox.textContent="El modelo clasificó el avistamiento como "+(leadLabel||"sin resultado")+", pero no se pudieron comparar las fotos del reporte.";}
      else{sightingMatchBox.textContent="El modelo clasificó el avistamiento como "+(leadLabel||"sin resultado")+". Este reporte no tiene fotos para comparar.";}
    }catch(error){sightingMatchBox.textContent="No se pudo analizar la foto: "+(error.message||"error de carga")+". Puedes registrar el avistamiento sin análisis.";}
  };
  $("#share-btn").onclick=function(){var url=window.location.origin+"#reports/"+report.id;if(navigator.clipboard){navigator.clipboard.writeText(url);showToast("Enlace copiado","success");}};
  if($("#flag-btn"))$("#flag-btn").onclick=function(){showModal("flag-modal");};
  $("#back-btn").onclick=function(){history.back();};
  if($("#close-report-btn")){$("#close-report-btn").onclick=async function(){if(confirm("¿Cerrar reporte? La mascota fue recuperada.")){try{await Data.closeReport(report.id);showToast("Reporte cerrado","success");navigateTo("reports");}catch(e){showToast(e.message,"error");}}};}
  $$("#add-sighting-modal .modal-close, #add-sighting-modal .modal-backdrop").forEach(function(el){el.onclick=function(){hideModal("add-sighting-modal");};});
  $$("#flag-modal .modal-close, #flag-modal .modal-backdrop").forEach(function(el){el.onclick=function(){hideModal("flag-modal");};});
  $("#sighting-form").onsubmit=async function(e){
    e.preventDefault();var d=new FormData(e.target);var data={action:d.get("action"),date:d.get("date"),commune:d.get("commune"),barrioId:parseInt(d.get("barrio")),location:d.get("location"),description:d.get("description")||"",photoFile:d.get("photo")};if(!data.action||!data.date||!data.commune||!data.barrioId||!data.location){showToast("Completa los campos","error");return;}
    if(data.photoFile&&data.photoFile.size&&(["image/jpeg","image/png","image/webp"].indexOf(data.photoFile.type)<0||data.photoFile.size>5242880)){showToast("La foto debe ser JPG, PNG o WebP y pesar máximo 5 MB","error");return;}
    try{await Data.addSighting(report.id,data);showToast(data.action==="found"?"Aviso de mascota encontrada enviado al dueño.":"Avistamiento registrado. El dueño será notificado.","success");hideModal("add-sighting-modal");await initReportDetail();}catch(err){showToast(err.message,"error");}
  };
  $("#flag-form").onsubmit=async function(e){
    e.preventDefault();var d=new FormData(e.target);if(!d.get("reason")){showToast("Selecciona un motivo","error");return;}
    try{await Data.flagReport(report.id,d.get("reason"));showToast("Denuncia enviada","success");hideModal("flag-modal");}catch(err){showToast(err.message,"error");}
  };
}

async function initAdminPage(){
  bindNavLinks();
  var user=await AuthService.me();
  var profile=await AuthService.profile();
  var container=$("#app");
  container.innerHTML=navHTML(user,profile)+'<main class="app-main">'+
  '<div class="page-header"><h1>Panel de Administración</h1></div>'+
  '<nav class="admin-tabs"><button class="admin-tab active" data-tab="users">Usuarios</button><button class="admin-tab" data-tab="pending-reports">Pendientes de aprobación</button><button class="admin-tab" data-tab="reports">Denuncias</button><button class="admin-tab" data-tab="communes">Comunas</button><button class="admin-tab" data-tab="stats">Estadísticas</button></nav>'+ 
  '<div class="admin-content">'+
  '<div id="tab-users" class="admin-tab-panel"><div class="table-container"><table class="admin-table"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="users-table-body"></tbody></table></div></div>'+ 
  '<div id="tab-pending-reports" class="admin-tab-panel" hidden><p class="form-hint">Revisa la información y las fotos antes de aprobar. Los reportes pendientes no aparecen en búsquedas públicas ni en el mapa.</p><div id="pending-reports-list" class="table-container"></div></div>'+ 
  '<div id="tab-reports" class="admin-tab-panel" hidden><div class="table-container"><table class="admin-table"><thead><tr><th>Reporte</th><th>Motivo</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="flags-table-body"></tbody></table></div></div>'+ 
  '<div id="tab-communes" class="admin-tab-panel" hidden><button class="btn btn-primary" id="add-commune-btn" style="margin-bottom:16px">+ Nueva comuna</button><div id="communes-list" class="communes-list"></div></div>'+
  '<div id="tab-stats" class="admin-tab-panel" hidden><div id="stats-grid" class="stats-grid"></div></div>'+
  '</div>'+
  '<div id="commune-modal" class="modal" hidden><div class="modal-backdrop"></div><div class="modal-content"><header class="modal-header"><h2>Nueva comuna</h2><button class="modal-close">&times;</button></header>'+
  '<form id="commune-form" class="modal-body"><div class="form-group"><label>Nombre *</label><input type="text" name="name" required></div>'+
  '<div class="form-group"><label>Barrios (separados por coma)</label><input type="text" name="neighborhoods" placeholder="Barrio1, Barrio2..."></div>'+
  '<div class="modal-actions"><button type="button" class="btn btn-secondary modal-close">Cancelar</button><button type="submit" class="btn btn-primary">Guardar</button></div></form></div></div>'+
  '</main>';
  bindNavLinks();
  renderTab("users");
  $$(".admin-tab").forEach(function(tab){tab.onclick=function(){$$(".admin-tab").forEach(function(t){t.classList.remove("active");});tab.classList.add("active");$$(".admin-tab-panel").forEach(function(p){p.hidden=true;});var panel=$("#tab-"+tab.dataset.tab);if(panel)panel.hidden=false;renderTab(tab.dataset.tab);};});
  async function renderTab(tab){
    if(tab==="users")await renderUsers();
    if(tab==="pending-reports")await renderPendingReports();
    if(tab==="reports")await renderFlags();
    if(tab==="communes")await renderCommunes();
    if(tab==="stats")await renderStats();
  }
  async function renderPendingReports(){
    var ctr=$("#pending-reports-list");if(!ctr)return;
    try{
      var reports=await Data.getPendingReports();
      if(!reports.length){ctr.innerHTML='<p class="text-center">No hay reportes pendientes de aprobación.</p>';return;}
      ctr.innerHTML='<table class="admin-table"><thead><tr><th>Mascota y fotos</th><th>Información</th><th>Autor</th><th>Fecha</th><th>Acciones</th></tr></thead><tbody>'+reports.map(function(r){return '<tr><td><strong>'+esc(r.petName)+'</strong><div class="pending-report-photos">'+(r.photos.length?r.photos.map(function(url){return '<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer"><img src="'+esc(url)+'" alt="Foto del reporte de '+esc(r.petName)+'" loading="lazy"></a>';}).join(""):'<small>Sin foto</small>')+'</div></td><td>'+esc(getTypeLabel(r.type))+'<br>Color: '+esc(r.color||"No indicado")+'<br>Ubicación: '+esc(r.location||"No indicada")+'<br>Señas: '+esc(r.characteristics||"No indicadas")+'<br>Código: '+esc(r.code)+'</td><td>'+esc(r.authorName)+'<br><small>'+esc(r.authorEmail)+'</small></td><td>'+formatDate(r.createdAt)+'</td><td><button type="button" class="btn btn-primary btn-sm approve-report" data-id="'+esc(r.id)+'">Aprobar</button> <button type="button" class="btn btn-danger btn-sm reject-report" data-id="'+esc(r.id)+'">Rechazar</button></td></tr>';}).join("")+'</tbody></table>';
      $$(".approve-report",ctr).forEach(function(button){button.onclick=async function(){try{await Data.reviewReport(button.dataset.id,"aprobado");showToast("Reporte aprobado y publicado","success");await renderPendingReports();}catch(error){showToast(error.message,"error");}};});
      $$(".reject-report",ctr).forEach(function(button){button.onclick=async function(){if(!confirm("¿Rechazar este reporte? No se mostrará públicamente."))return;try{await Data.reviewReport(button.dataset.id,"rechazado");showToast("Reporte rechazado","success");await renderPendingReports();}catch(error){showToast(error.message,"error");}};});
    }catch(error){ctr.innerHTML='<p class="text-error">No se pudo cargar la cola de aprobación: '+esc(error.message)+'</p>';}
  }
  async function renderUsers(){
    var users=await Data.getAdminUsers();var tbody=$("#users-table-body");if(!tbody)return;
    tbody.innerHTML=users.map(function(u){return '<tr><td><strong>'+esc(u.nombre)+'</strong></td><td>'+esc(u.email)+'</td><td><span class="badge badge-'+esc(u.rol)+'">'+esc(ROLE_LABEL[u.rol]||u.rol)+'</span></td><td><span class="badge badge-'+(u.activo?"active":"inactive")+'">'+(u.activo?"Activo":"Inactivo")+'</span></td><td><button class="icon-btn toggle-role" data-id="'+esc(u.id)+'" data-rol="'+esc(u.rol)+'" aria-label="Cambiar rol" title="Cambiar rol">🔄</button> <button class="icon-btn toggle-active" data-id="'+esc(u.id)+'" data-active="'+String(!!u.activo)+'" aria-label="'+(u.activo?"Desactivar usuario":"Activar usuario")+'" title="'+(u.activo?"Desactivar usuario":"Activar usuario")+'">'+(u.activo?"🚫":"✅")+'</button></td></tr>';}).join("");
    $$(".toggle-role").forEach(function(b){b.onclick=async function(){var newRole=b.dataset.rol==="administrador"?"usuario":"administrador";try{await Data.updateUser(b.dataset.id,{role:newRole==="administrador"?"admin":"user"});showToast("Rol actualizado","success");await renderUsers();}catch(e){showToast(e.message,"error");}};});
    $$(".toggle-active").forEach(function(b){b.onclick=async function(){var active=b.dataset.active!=="true";if(!active&&!confirm("¿Desactivar este usuario? Su sesión y acceso a la plataforma quedarán bloqueados."))return;try{await Data.updateUser(b.dataset.id,{active:active});var current=await AuthService.me();if(current&&current.id===b.dataset.id&&!active){await AuthService.logout();cachedProfile=null;cachedUser=null;showToast("Tu cuenta fue desactivada","warning");initLoginPage();return;}showToast(active?"Usuario activado":"Usuario desactivado","success");await renderUsers();}catch(e){showToast(e.message,"error");}};});
  }
  async function renderFlags(){
    var flags=await Data.getFlags();var tbody=$("#flags-table-body");if(!tbody)return;
    if(!flags.length){tbody.innerHTML='<tr><td colspan="4" class="text-center">Sin denuncias</td></tr>';return;}
    tbody.innerHTML=flags.map(function(f){
      var actions=f.status==="pending"?'<button class="btn btn-danger btn-sm approve-flag" data-id="'+esc(f.id)+'">Retirar publicación</button> <button class="btn btn-secondary btn-sm dismiss-flag" data-id="'+esc(f.id)+'">Desestimar denuncia</button>':(f.status==="reviewed"?'<button class="btn btn-secondary btn-sm restore-flag" data-id="'+esc(f.id)+'">Restaurar publicación</button>':"");
      return '<tr><td>'+esc(f.petName)+'</td><td>'+esc(f.reason)+'</td><td><span class="badge badge-'+(f.status==="pending"?"pending":esc(f.status))+'">'+esc(f.status)+'</span></td><td>'+actions+'</td></tr>';
    }).join("");
    $$(".approve-flag").forEach(function(b){b.onclick=async function(){if(!confirm("¿Retirar esta publicación del mapa y del listado público?"))return;try{await Data.moderateFlag(b.dataset.id,"reviewed");showToast("Publicación retirada","success");await renderFlags();}catch(e){showToast(e.message,"error");}};});
    $$(".dismiss-flag").forEach(function(b){b.onclick=async function(){try{await Data.moderateFlag(b.dataset.id,"dismissed");showToast("Denuncia desestimada","success");await renderFlags();}catch(e){showToast(e.message,"error");}};});
    $$(".restore-flag").forEach(function(b){b.onclick=async function(){try{await Data.moderateFlag(b.dataset.id,"dismissed");showToast("Publicación restaurada","success");await renderFlags();}catch(e){showToast(e.message,"error");}};});
  }
  async function renderCommunes(){
    var communes=cachedCommunes.length?cachedCommunes:await Data.getCommunes();
    cachedCommunes=communes;
    if(!cachedBarrios.length) cachedBarrios=await Data.getBarrios();
    var ctr=$("#communes-list");if(!ctr)return;
    ctr.innerHTML=communes.map(function(c){
      var barrios=cachedBarrios.filter(function(b){return String(b.comuna_id)===String(c.id);});
      return '<div class="commune-card"><div class="commune-header"><h4>'+esc(c.nombre)+'</h4><button class="icon-btn danger del-commune" data-id="'+esc(c.id)+'">🗑️</button></div><div class="neighborhoods-tags">'+barrios.map(function(b){return '<span class="tag">'+esc(b.nombre)+'</span>';}).join("")+'</div></div>';
    }).join("");
    $$(".del-commune").forEach(function(b){b.onclick=async function(){if(confirm("¿Eliminar comuna y sus barrios?")){try{await Data.deleteCommune(b.dataset.id);cachedCommunes=[];cachedBarrios=[];await renderCommunes();showToast("Comuna eliminada","success");}catch(e){showToast(e.message,"error");}}};});
    $("#add-commune-btn")?$$("#add-commune-btn").forEach(function(b){b.onclick=function(){showModal("commune-modal");};}):null;
    var acb=$("#add-commune-btn");if(acb)acb.onclick=function(){showModal("commune-modal");};
    $$("#commune-modal .modal-close, #commune-modal .modal-backdrop").forEach(function(el){el.onclick=function(){hideModal("commune-modal");};});
    var cf=$("#commune-form");if(cf)cf.onsubmit=async function(e){e.preventDefault();var d=new FormData(e.target);var name=d.get("name");var barrios=d.get("neighborhoods")?d.get("neighborhoods").split(",").map(function(s){return s.trim();}).filter(Boolean):[];if(!name){showToast("Nombre requerido","error");return;}try{await Data.createCommune(name,barrios);cachedCommunes=[];cachedBarrios=[];showToast("Comuna creada","success");hideModal("commune-modal");await renderCommunes();}catch(err){showToast(err.message,"error");}};
  }
  async function renderStats(){
    var stats=await Data.getStats();var grid=$("#stats-grid");if(!grid)return;
    grid.innerHTML='<div class="stat-card"><div class="stat-icon" style="background:#1976d220;color:#1976d2"><span>👥</span></div><div class="stat-info"><span class="stat-value">'+stats.totalUsers+'</span><span class="stat-label">Usuarios</span></div></div>'+
    '<div class="stat-card"><div class="stat-icon" style="background:#f57c0020;color:#f57c00"><span>📋</span></div><div class="stat-info"><span class="stat-value">'+stats.activeReports+'</span><span class="stat-label">Activos</span></div></div>'+
    '<div class="stat-card"><div class="stat-icon" style="background:#2e7d3220;color:#2e7d32"><span>✅</span></div><div class="stat-info"><span class="stat-value">'+stats.closedReports+'</span><span class="stat-label">Cerrados</span></div></div>'+
    '<div class="stat-card"><div class="stat-icon" style="background:#7b1fa220;color:#7b1fa2"><span>🐾</span></div><div class="stat-info"><span class="stat-value">'+stats.totalPets+'</span><span class="stat-label">Mascotas</span></div></div>'+
    '<div class="stat-card"><div class="stat-icon" style="background:#d32f2f20;color:#d32f2f"><span>⚠️</span></div><div class="stat-info"><span class="stat-value">'+stats.pendingFlags+'</span><span class="stat-label">Denuncias</span></div></div>';
  }
}

async function initProfilePage(){
  bindNavLinks();
  var user=await AuthService.me();
  var profile=await AuthService.profile();
  var container=$("#app");
  container.innerHTML=navHTML(user,profile)+'<main class="app-main">'+
  '<div class="page-header"><h1>Mi Perfil</h1></div><div class="profile-layout"><div class="profile-card">'+
  '<div class="profile-avatar-section"><div class="profile-avatar">'+esc((profile?profile.nombre:"U").charAt(0).toUpperCase())+'</div><h2>'+esc(profile?profile.nombre:"")+'</h2><p class="text-muted">'+esc(profile?profile.email:"")+'</p></div>'+ 
  '<div class="form-section" style="padding:24px"><h3>Información</h3><p><strong>Nombre:</strong> '+esc(profile?profile.nombre:"")+'</p><p><strong>Correo:</strong> '+esc(profile?profile.email:"")+'</p><p><strong>Teléfono:</strong> '+esc(profile?profile.telefono||"No registrado":"")+'</p><p><strong>Rol:</strong> '+(profile&&profile.rol==="administrador"?"Administrador":"Usuario")+'</p></div>'+ 
  '</div><aside class="profile-sidebar"><div class="sidebar-card"><h3>Cuenta</h3><p class="text-muted">Miembro de FusaPet</p></div></aside></div></main>';
  bindNavLinks();
}

// ========== LOGIN INIT ==========
function initLoginPage(){
  var app=$("#app");
  if(app)app.innerHTML='<div class="auth-page">'+PAGES.login+'</div>';
  linkFormLabels(app);
  normalizeHeadings(app);
  var loginMain=app&&app.querySelector("main");if(loginMain)loginMain.id="app-main";
  updatePageMetadata(app);
  var loginTab=$("#login-tab");var registerTab=$("#register-tab");
  var loginForm=$("#login-form");var registerForm=$("#register-form");
  if(loginTab){loginTab.onclick=function(){loginTab.classList.add("active");registerTab.classList.remove("active");loginForm.hidden=false;registerForm.hidden=true;};}
  if(registerTab){registerTab.onclick=function(){registerTab.classList.add("active");loginTab.classList.remove("active");registerForm.hidden=false;loginForm.hidden=true;};}
  if(loginForm){loginForm.onsubmit=async function(e){e.preventDefault();var email=$("#login-email").value;var pass=$("#login-password").value;var btn=$("button[type=submit]",loginForm);btn.disabled=true;btn.textContent="Ingresando...";try{await AuthService.login(email,pass);cachedUser=null;cachedProfile=null;showToast("Bienvenido","success");window.location.hash=pendingMapReportAction?"reports/"+pendingMapReportAction.reportId:"dashboard";}catch(err){showToast(err.message,"error");btn.disabled=false;btn.textContent="Ingresar";}};}
  if(registerForm){registerForm.onsubmit=async function(e){e.preventDefault();var name=$("#register-name").value;var email=$("#register-email").value;var pass=$("#register-password").value;var confirm=$("#register-confirm-password").value;if(pass!==confirm){showToast("Las contraseñas no coinciden","error");return;}var btn=$("button[type=submit]",registerForm);btn.disabled=true;btn.textContent="Registrando...";try{var res=await AuthService.register(name,email,pass,$("#register-phone").value);cachedUser=null;cachedProfile=null;if(res&&res.emailConfirmation){showToast("Revisa tu correo para confirmar tu cuenta","info");}else{showToast("Cuenta creada","success");window.location.hash=pendingMapReportAction?"reports/"+pendingMapReportAction.reportId:"dashboard";}}catch(err){showToast(err.message,"error");btn.disabled=false;btn.textContent="Registrarse";}};}
  if($("#forgot-password-link")){$("#forgot-password-link").onclick=function(e){e.preventDefault();showModal("forgot-password-modal");};}
  $$("#forgot-password-modal .modal-close, #forgot-password-modal .modal-backdrop").forEach(function(el){el.onclick=function(){hideModal("forgot-password-modal");};});
  if($("#forgot-password-form")){$("#forgot-password-form").onsubmit=async function(e){e.preventDefault();try{await AuthService.recoverPassword($("#forgot-email").value);showToast("Instrucciones enviadas a tu correo","success");hideModal("forgot-password-modal");}catch(err){showToast(err.message,"error");}};}
}

// ========== ROUTER ==========
function renderBootError(extra){
  var app=document.getElementById("app");
  if(!app)return;
  app.innerHTML='<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;min-height:100vh;padding:24px;max-width:560px;margin:0 auto">'+
  '<h1 style="color:var(--text-primary);font-size:22px;margin-bottom:12px">No se pudo iniciar FusaPet</h1>'+
  '<p style="color:#c62828;margin-bottom:16px">'+esc(extra||"Error desconocido.")+'</p>'+ 
  '<p style="color:#888;font-size:14px;margin-bottom:20px">La app carga Leaflet y Supabase desde CDN (unpkg.com y cdn.jsdelivr.net). Revisa tu conexion a internet o desactiva bloqueadores.</p>'+
  '<div style="display:flex;gap:12px;justify-content:center"><button class="btn btn-primary" id="boot-retry">Reintentar</button></div></div>';
  var retry=document.getElementById("boot-retry");if(retry)retry.onclick=function(){location.reload();};
}
function startWatchdog(){
  if(window.__fusapet_watchdog)return;
  window.__fusapet_watchdog=true;
  setTimeout(function(){
    var app=document.getElementById("app");
    var loading=app&&app.querySelector(".loading-screen");
    if(loading){renderBootError("La pagina tardo demasiado en arrancar y se detuvo.");}
  },8000);
}
window.addEventListener("error",function(e){
  var app=document.getElementById("app");
  if(app&&app.querySelector(".loading-screen")){
    renderBootError("Error durante el inicio: "+(e.message||"desconocido")+".");
  }
});
function getPageFromHash(){
  var h=window.location.hash.slice(1)||"";
  if(!h||h==="login")return"login";
  if(h==="reports/new")return"report-form";
  if(h.startsWith("reports/"))return"report-detail";
  if(["map","reports","pets","admin","profile","dashboard"].indexOf(h)>=0)return h;
  return"dashboard";
}

window.addEventListener("hashchange",function(){
  var page=getPageFromHash();
  route(page);
});
window.addEventListener("load",function(){
  startWatchdog();
  if(!window.location.hash)window.location.hash="login";
  if(!supabase){renderBootError("No se pudo conectar con Supabase.");return;}
  route(getPageFromHash());
});

async function route(page){
  var app=$("#app");
  try{
    await AuthService.init();
    var authed=await AuthService.isAuthenticated();
    if(authed){
      var currentProfile=await AuthService.profile();
      if(currentProfile&&currentProfile.activo===false){
        await AuthService.logout();cachedUser=null;cachedProfile=null;authed=false;
        showToast("Tu cuenta está desactivada. Contacta al administrador.","error");
      }
    }
    if(!authed&&["map","reports","report-detail"].indexOf(page)<0){initLoginPage();return;}
    if(page==="login"){window.location.hash="dashboard";return;}
    switch(page){
      case"dashboard":await initDashboard();break;
      case"map":await initMapPage();break;
      case"pets":await initPetsPage();break;
      case"reports":await initReportsList();break;
      case"report-form":await initReportForm();break;
      case"report-detail":await initReportDetail();break;
      case"admin":
        var profile=await AuthService.profile();
        if(profile&&profile.rol==="administrador"){await initAdminPage();}
        else{showToast("Acceso denegado","error");window.location.hash="dashboard";}
        break;
      case"profile":await initProfilePage();break;
      default:window.location.hash="dashboard";break;
    }
    linkFormLabels(app);
    normalizeHeadings(app);
    var pageMain=app&&app.querySelector("main");if(pageMain)pageMain.id="app-main";
    updatePageMetadata(app);
  }catch(err){
    console.error(err);
    if(document.getElementById("app")&&document.getElementById("app").querySelector(".loading-screen")){
      renderBootError("Error: "+(err.message||"desconocido")+".");
    }
  }
}

})();
