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

// ========== UTILS ==========
function generateReportCode(){
  var ts=Date.now().toString(36).toUpperCase();
  var rnd=Math.random().toString(36).substring(2,6).toUpperCase();
  return "FSP-"+ts+"-"+rnd;
}
function formatDate(d){return d?new Date(d).toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}):"-";}
function timeAgo(d){if(!d)return"-";var s=Math.floor((Date.now()-new Date(d))/1000);if(s<60)return"hace un momento";if(s<3600)return"hace "+Math.floor(s/60)+" min";if(s<86400)return"hace "+Math.floor(s/3600)+" h";if(s<604800)return"hace "+Math.floor(s/86400)+" d";return formatDate(d);}
function getTypeLabel(t){return{lost:"Perdida",found:"Encontrada",sighting:"Avistamiento"}[t]||t;}
function getTypeClass(t){return{lost:"type-lost",found:"type-found",sighting:"type-sighting"}[t]||"";}
function getStatusLabel(s){return{active:"Activo",closed:"Cerrado",cancelled:"Cancelado"}[s]||s;}
function getStatusClass(s){return{active:"status-active",closed:"status-closed",cancelled:"status-moderated"}[s]||"";}
function navigateTo(p){window.location.hash=p;}
function showToast(msg,type){
  var c=document.getElementById("toast-container");
  if(!c){c=document.createElement("div");c.id="toast-container";c.className="toast-container";document.body.appendChild(c);}
  var t=document.createElement("div");t.className="toast toast-"+(type||"info");
  t.innerHTML='<span class="toast-message">'+msg+'</span><button class="toast-close">&times;</button>';
  t.querySelector(".toast-close").onclick=function(){t.remove();};
  c.appendChild(t);
  requestAnimationFrame(function(){t.classList.add("show");});
  setTimeout(function(){t.classList.remove("show");setTimeout(function(){t.remove();},300);},5000);
}
function showModal(id){var m=document.getElementById(id);if(m){m.classList.add("show");m.hidden=false;document.body.style.overflow="hidden";}}
function hideModal(id){var m=document.getElementById(id);if(m){m.classList.remove("show");m.hidden=true;document.body.style.overflow="";}}
function $(s,p){return(p||document).querySelector(s);}
function $$(s,p){return Array.from((p||document).querySelectorAll(s));}
function esc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}

// ========== AUTH SERVICE ==========
var AuthService={
  _user:null,
  async init(){
    var self=this;
    var res=await supabase.auth.getSession();
    self._user=res.data.session?res.data.session.user:null;
    supabase.auth.onAuthStateChange(function(event,session){
      if(session){self._user=session.user;}
    });
    return self._user;
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
    var {data,error}=await supabase.from("usuarios").select("*").eq("id",user.id).single();
    if(error||!data){
      // intentar crear perfil si falta
      var {error:err2}=await supabase.from("usuarios").insert([{id:user.id,nombre:user.user_metadata.nombre||user.email,email:user.email,telefono:user.user_metadata.telefono||"",rol:"usuario"}]);
      if(!err2){var r2=await supabase.from("usuarios").select("*").eq("id",user.id).single();return r2.data||null;}
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
    var q=supabase.from("reportes").select("*, usuario:usuarios(nombre,email,telefono), barrio:barrios(nombre,comuna_id), mascota:mascotas(nombre,color,raza)");
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
    if(filters.query){
      var term=filters.query;
      var names=[];
      var {data:m}=await supabase.from("mascotas").select("id").ilike("nombre","%"+term+"%");
      if(m&&m.length)names=m.map(function(x){return x.id;});
      var nameCond=names.length?"mascota_id.in.("+names.join(",")+")":"true.eq.true";
      q=q.or("descripcion.ilike.%"+term+"%,color.ilike.%"+term+"%,"+nameCond);
    }
    q=q.order("created_at",{ascending:false});
    var {data,error}=await q;
    if(error){console.error(error);return{reports:[],total:0};}
    var reports=this.decorateReports(data||[]);
    return{reports:reports,total:reports.length};
  },
  async getMyReports(){
    var user=await AuthService.me();
    if(!user)return[];
    var {data,error}=await supabase.from("reportes").select("*, barrio:barrios(nombre,comuna_id), mascota:mascotas(nombre,color,raza)").eq("usuario_id",user.id).order("created_at",{ascending:false});
    if(error)return[];
    return this.decorateReports(data||[]);
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
        breed:"",
        color:r.color||"",
        size:TAMANO_REV[r.tamano]||"",
        characteristics:r.senas_particulares||"",
        commune:barrio?String(barrio.comuna_id):"",
        neighborhood:barrio?barrio.nombre:"",
        barrioId:r.barrio_id,
        location:r.descripcion||"",
        date:r.fecha_publicacion||r.created_at,
        status:ESTADO_REV[r.estado]||"active",
        contactName:r.usuario&&r.usuario.nombre||"",
        contactPhone:r.usuario&&r.usuario.telefono||"",
        authorName:r.usuario&&r.usuario.nombre||"",
        userId:r.usuario_id,
        lat:r.latitud?Number(r.latitud):null,
        lng:r.longitud?Number(r.longitud):null,
        photos:[],
        showContact:true,
        createdAt:r.created_at,
        sightings:[]
      };
    });
  },
  async getReportById(id){
    var {data,error}=await supabase.from("reportes").select("*, usuario:usuarios(nombre,email,telefono), barrio:barrios(nombre,comuna_id), mascota:mascotas(nombre,especie_id,raza,color)").eq("id",id).single();
    if(error){console.error(error);return null;}
    var r=data;
    var barrio=Array.isArray(r.barrio)?r.barrio[0]:(r.barrio||null);
    var fotosRes=await supabase.from("fotos_reporte").select("url").eq("reporte_id",id).order("orden");
    var fotos=(fotosRes.data||[]).map(function(f){return f.url;});
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
      contactName:r.usuario&&r.usuario.nombre||"",
      contactPhone:r.usuario&&r.usuario.telefono||"",
      authorName:r.usuario&&r.usuario.nombre||"",
      userId:r.usuario_id,
      lat:r.latitud?Number(r.latitud):null,
      lng:r.longitud?Number(r.longitud):null,
      photos:fotos,
      showContact:true,
      createdAt:r.created_at,
      sightings:(avistRes.data||[]).map(function(a){
        var ab=Array.isArray(a.barrio)?a.barrio[0]:(a.barrio||null);
        return{id:a.id,description:a.descripcion||a.informacion_adicional||"",location:a.descripcion||"",commune:comunaName(ab?ab.comuna_id:null),neighborhood:ab?ab.nombre:"",date:a.fecha||a.created_at,photos:[]};
      })
    };
  },
  async createReport(data){
    var user=await AuthService.me();
    if(!user)throw new Error("Debes iniciar sesión");
    var estadoActivo="publicado";
    var {data:inserted,error}=await supabase.from("reportes").insert([{
      codigo_unico:data.code||generateReportCode(),
      usuario_id:user.id,
      tipo:TIPO_MAP[data.type]||"otro",
      estado:estadoActivo,
      color:data.color||"",
      tamano:TAMANO_MAP[data.size]||null,
      senas_particulares:data.characteristics||"",
      descripcion:data.location||"",
      barrio_id:data.barrioId||null,
      latitud:data.lat||null,
      longitud:data.lng||null,
      fecha_publicacion:data.date||new Date().toISOString()
    }]).select();
    if(error)throw new Error(error.message);
    var report=inserted[0];
    if(data.photos&&data.photos.length){
      var photoRows=data.photos.map(function(url,i){return{reporte_id:report.id,url:url,orden:i};});
      await supabase.from("fotos_reporte").insert(photoRows);
    }
    if(data.petName){
      var {data:masc,error:merr}=await supabase.from("mascotas").insert([{
        usuario_id:user.id,
        nombre:data.petName,
        especie_id:data.speciesId||null,
        raza:"",
        color:data.color||"",
        tamano:TAMANO_MAP[data.size]||null,
        senas_particulares:data.characteristics||""
      }]).select("id").single();
      if(!merr&&masc){
        await supabase.from("reportes").update({mascota_id:masc.id}).eq("id",report.id);
      }
    }
    return report;
  },
  async closeReport(id){
    var {error}=await supabase.from("reportes").update({estado:"recuperada",fecha_cierre:new Date().toISOString()}).eq("id",id);
    if(error)throw new Error(error.message);
  },
  async addSighting(reportId,data){
    var user=await AuthService.me();
    if(!user)throw new Error("Debes iniciar sesión");
    var {data:rows,error}=await supabase.from("avistamientos").insert([{
      reporte_id:reportId,
      usuario_id:user.id,
      descripcion:data.description||"",
      informacion_adicional:data.description||"",
      barrio_id:data.barrioId||null,
      latitud:data.lat||null,
      longitud:data.lng||null,
      fecha:data.date||new Date().toISOString()
    }]).select();
    if(error)throw new Error(error.message);
    // notificar al dueño
    var report=await supabase.from("reportes").select("usuario_id").eq("id",reportId).single();
    if(report.data){
      await supabase.from("notificaciones").insert([{
        usuario_id:report.data.usuario_id,
        reporte_id:reportId,
        avistamiento_id:rows[0].id,
        mensaje:"Hay un nuevo avistamiento en tu reporte"
      }]);
    }
    return rows[0];
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
  async getMyPets(){
    var user=await AuthService.me();
    if(!user)return[];
    var {data,error}=await supabase.from("mascotas").select("*, especie:especies(nombre)").eq("usuario_id",user.id).order("created_at",{ascending:false});
    if(error)return[];
    return (data||[]).map(function(p){
      var e=Array.isArray(p.especie)?p.especie[0]:(p.especie||null);
      return{id:p.id,name:p.nombre,species:e?e.nombre:String(p.especie_id),speciesId:p.especie_id,breed:p.raza||"",color:p.color||"",size:TAMANO_REV[p.tamano]||"",gender:"",characteristics:p.senas_particulares||"",photos:[]};
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
    var {error}=await supabase.from("mascotas").delete().eq("id",id);
    if(error)throw new Error(error.message);
  },
  async getAdminUsers(){
    var {data,error}=await supabase.from("usuarios").select("*").order("created_at",{ascending:false});
    if(error)return[];
    return data||[];
  },
  async updateUser(id,data){
    var upd={nombre:data.name,telefono:data.phone||""};
    if(data.role)upd.rol=ROL_MAP[data.role];
    var {error}=await supabase.from("usuarios").update(upd).eq("id",id);
    if(error)throw new Error(error.message);
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
    var {error}=await supabase.from("denuncias").update({estado:FLAG_MAP[status]||status}).eq("id",flagId);
    if(error)throw new Error(error.message);
  },
  async createCommune(name,neighborhoods){
    var {data:c,error}=await supabase.from("comunas").insert([{nombre:name}]).select();
    if(error)throw new Error(error.message);
    if(neighborhoods.length){
      var rows=neighborhoods.map(function(n){return{nombre:n,comuna_id:c[0].id};});
      await supabase.from("barrios").insert(rows);
    }
    return c[0];
  },
  async deleteCommune(id){
    await supabase.from("barrios").delete().eq("comuna_id",id);
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
    await supabase.from("notificaciones").update({leido:true}).eq("id",id);
  }
};

// ========== PAGES HTML ==========
var PAGES={};

PAGES.login='<div class="main-container"><header class="auth-header"><h1>FusaPet</h1><p class="subtitle">Tu comunidad de mascotas perdidas y encontradas</p></header>'+
'<div class="tab-buttons"><button class="tab-btn active" id="login-tab">Iniciar Sesión</button><button class="tab-btn" id="register-tab">Crear Cuenta</button></div>'+
'<form id="login-form"><div class="form-group"><label>Correo electrónico</label><input type="email" id="login-email" name="email" required placeholder="tu@email.com"></div>'+
'<div class="form-group"><label>Contraseña</label><input type="password" id="login-password" name="password" required placeholder="••••••••"></div>'+
'<div class="form-options"><label class="checkbox-label"><input type="checkbox"> Recordarme</label><a href="#" id="forgot-password-link" class="forgot-link">¿Olvidaste tu contraseña?</a></div>'+
'<button type="submit" class="btn btn-primary">Ingresar</button></form>'+
'<form id="register-form" hidden><div class="form-group"><label>Nombre</label><input type="text" id="register-name" name="name" required placeholder="Tu nombre completo"></div>'+
'<div class="form-group"><label>Correo</label><input type="email" id="register-email" name="email" required placeholder="tu@email.com"></div>'+
'<div class="form-group"><label>Teléfono</label><input type="tel" id="register-phone" name="phone" placeholder="+56 9 1234 5678"></div>'+
'<div class="form-group"><label>Contraseña</label><input type="password" id="register-password" name="password" required minlength="8" placeholder="••••••••"><span class="field-hint">Mínimo 8 caracteres</span></div>'+
'<div class="form-group"><label>Confirmar contraseña</label><input type="password" id="register-confirm-password" name="confirmPassword" required placeholder="••••••••"></div>'+
'<button type="submit" class="btn btn-primary">Registrarse</button></form>'+
'<div class="auth-footer"><p>Al continuar, aceptas nuestros <a href="#">Términos</a></p></div></div>'+
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
  return '<header class="app-header"><div class="header-content">'+
  '<a href="#dashboard" class="logo"><svg class="logo-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg><span class="logo-text">FusaPet</span></a>'+
  '<nav class="main-nav"><button class="nav-toggle" aria-expanded="false"><span class="hamburger"></span></button>'+
  '<ul class="nav-menu">'+
  '<li><a href="#dashboard" class="nav-link" data-page="dashboard"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg><span>Inicio</span></a></li>'+
  '<li><a href="#map" class="nav-link" data-page="map"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg><span>Mapa</span></a></li>'+
  '<li><a href="#reports" class="nav-link" data-page="reports"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span>Reportes</span></a></li>'+
  '<li><a href="#pets" class="nav-link" data-page="pets"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/></svg><span>Mis Mascotas</span></a></li>'+
  adminLink+
  '<li><a href="#reports/new" class="nav-link btn-report" data-page="report-form"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg><span>Reportar</span></a></li>'+
  '</ul></nav>'+
  '<div class="user-menu"><button class="user-avatar" aria-expanded="false"><span class="avatar-text">'+initial+'</span></button>'+
  '<div class="user-dropdown"><div class="user-info"><span class="user-name">'+name+'</span><span class="user-email">'+email+'</span></div><div class="dropdown-divider"></div>'+
  '<a href="#profile" class="dropdown-item"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>Mi perfil</a>'+
  '<button id="logout-btn" class="dropdown-item dropdown-danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>Cerrar sesión</button></div></div>'+
  '</div></header>';
}

function communeOptionsHTML(communes,selected){
  var h='<option value="">Seleccionar comuna</option>';
  communes.forEach(function(c){h+='<option value="'+c.id+'"'+(String(c.id)===String(selected)?' selected':'')+'>'+c.nombre+'</option>';});
  return h;
}
function barrioOptionsHTML(barrios,communeId,selected){
  var inComuna=barrios.filter(function(b){return String(b.comuna_id)===String(communeId);});
  if(!inComuna.length)return'<option value="">Sin barrios</option>';
  var h='<option value="">Seleccionar barrio</option>';
  inComuna.forEach(function(b){h+='<option value="'+b.id+'"'+(String(b.id)===String(selected)?' selected':'')+'>'+b.nombre+'</option>';});
  return h;
}

var cachedCommunes=[];
var cachedBarrios=[];
var cachedEspecies=[];
async function ensureCatalogs(){
  if(!cachedCommunes.length) cachedCommunes=await Data.getCommunes();
  if(!cachedBarrios.length) cachedBarrios=await Data.getBarrios();
  if(!cachedEspecies.length) cachedEspecies=await Data.getEspecies();
}

// ========== PAGE INIT FUNCTIONS ==========
function bindNavLinks(){
  var toggle=$(".nav-toggle");var menu=$(".nav-menu");
  if(toggle&&menu){toggle.onclick=function(){var ex=toggle.getAttribute("aria-expanded")==="true";toggle.setAttribute("aria-expanded",!ex);menu.classList.toggle("open");};}
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
  var active=reports.reports.filter(function(r){return r.status==="active";}).length;
  var recent=reports.reports.slice(0,5);
  var cards='';
  recent.forEach(function(r){
    var comunaName=r.communeId?communeNameNative(r.communeId):"";
    var b=profile;
    cards+='<article class="report-card" data-id="'+r.id+'" tabindex="0"><div class="report-type '+getTypeClass(r.type)+'">'+getTypeLabel(r.type)+'</div>'+
    '<div class="report-info"><div class="report-header"><h4>'+r.petName+'</h4><span class="report-status '+getStatusClass(r.status)+'">'+getStatusLabel(r.status)+'</span></div>'+
    '<p class="report-location">'+(r.neighborhood||"")+'</p><p class="report-date">'+timeAgo(r.createdAt)+'</p></div><div class="report-code">'+r.code+'</div></article>';
  });
  if(!cards)cards='<div class="empty-state"><h3>Sin reportes aún</h3><p>Crea tu primer reporte</p><a href="#reports/new" class="btn-hero"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Crear reporte</a></div>';
  var container=$("#app");
  container.innerHTML=navHTML(user,profile)+'<main class="app-main"><div class="dashboard-content">'+
  '<div class="dashboard-welcome"><h1>Hola, '+name+'</h1><p>Bienvenido a FusaPet</p></div>'+
  '<div class="stats-grid"><div class="stat-card" style="--stat-color:#1976d2"><div class="stat-icon" style="background:#1976d220;color:#1976d2"><span>🔍</span></div><div class="stat-info"><span class="stat-value">'+active+'</span><span class="stat-label">Activos</span></div></div>'+
  '<div class="stat-card" style="--stat-color:#7b1fa2"><div class="stat-icon" style="background:#7b1fa220;color:#7b1fa2"><span>📋</span></div><div class="stat-info"><span class="stat-value">'+reports.total+'</span><span class="stat-label">Total</span></div></div>'+
  '<div class="stat-card" style="--stat-color:#2e7d32"><div class="stat-icon" style="background:#2e7d3220;color:#2e7d32"><span>🐾</span></div><div class="stat-info"><span class="stat-value">'+myReports.length+'</span><span class="stat-label">Mis reportes</span></div></div></div>'+
  '<div class="dashboard-section"><div class="section-header"><h2>Reportes recientes</h2><a href="#reports" class="btn btn-secondary btn-sm">Ver todos</a></div><div class="recent-reports">'+cards+'</div></div>'+
  '<div class="dashboard-section"><div class="map-cta"><div><h3>Reportes en tu comunidad</h3><p>Explora el mapa con todos los avistamientos y mascotas perdidas.</p></div><a href="#map" class="btn-hero"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>Ver mapa de reportes</a></div></div>'+
  '</div></main><footer class="app-footer"><p>FusaPet © 2024</p></footer>';
  bindNavLinks();
  $$(".report-card").forEach(function(c){c.onclick=function(){navigateTo("reports/"+c.dataset.id);};});
}
function communeNameNative(cid){var c=cachedCommunes.find(function(x){return String(x.id)===String(cid);});return c?c.nombre:"";}
var mapInstance=null;

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
'<div class="filter-section"><h3>Comuna</h3><select id="map-commune" name="commune">'+communeOptionsHTML(cachedCommunes,"")+'</select></div>'+
  '<div class="map-legend"><h4>Leyenda</h4><div class="legend-items"><div class="legend-item"><span class="marker-icon lost"></span>Perdida</div><div class="legend-item"><span class="marker-icon found"></span>Encontrada</div><div class="legend-item"><span class="marker-icon sighting"></span>Avistamiento</div></div></div></form></aside>'+
  '<main class="map-main"><div id="map" class="map-container"></div><div class="map-controls"><button class="btn btn-primary" id="locate-me-btn">Mi ubicación</button></div></main></main>';
  bindNavLinks();
  if(typeof L==="undefined"){showToast("Mapa no disponible (sin conexión a internet)","warning");return;}
  if(mapInstance){mapInstance.remove();mapInstance=null;}
  var map=L.map("map",{center:[4.3364,-74.3639],zoom:14,zoomControl:true});
  mapInstance=map;
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",{subdomains:"abcd",maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'}).addTo(map);
  L.control.scale({imperial:false}).addTo(map);
  var markersLayer=L.layerGroup().addTo(map);
  var typeColors={lost:"#d32f2f",found:"#2e7d32",sighting:"#1976d2"};
  var icons={lost:"🐕",found:"⚠️",sighting:"👁️"};
  var reports=await Data.getReports({statuses:["active"]});
  function renderMarkers(list){
    markersLayer.clearLayers();
    list.forEach(function(r){
      if(!r.lat||!r.lng)return;
      var color=typeColors[r.type]||"#757575";
      var icon=L.divIcon({className:"custom-marker",html:'<div class="marker-pin" style="background:'+color+'"><span>'+(icons[r.type]||"📍")+'</span></div>',iconSize:[36,42],iconAnchor:[18,42]});
      var marker=L.marker([r.lat,r.lng],{icon:icon}).addTo(markersLayer);
      var photosTxt=(r.photos&&r.photos.length)?'<div class="popup-photos">'+r.photos.slice(0,3).map(function(u){return '<img src="'+esc(u)+'" alt="foto">';}).join("")+'</div>':"";
      var placeTxt=(r.neighborhood||r.commune||r.location)?'<p class="popup-place">📍 '+(r.neighborhood?esc(r.neighborhood)+" ":"")+(r.commune?'<strong>'+esc(communeNameNative(r.commune))+'</strong>':"")+"</p>":"";
      marker.bindPopup('<div class="map-popup-card"><div class="popup-content">'+
        '<div class="popup-type '+getTypeClass(r.type)+'">'+getTypeLabel(r.type)+"</div>"+
        '<h4>'+esc(r.petName)+"</h4>"+
        (r.location?'<p class="popup-location">'+esc(r.location)+"</p>":"")+
        placeTxt+
        photosTxt+
        '<button class="btn btn-primary btn-sm" onclick="window.location.hash=\'reports/'+r.id+'\'">Ver detalle</button>'+
        "</div></div>",{maxWidth:280,minWidth:220});
    });
    if(list.length>0){var layerList=markersLayer.getLayers();var group=L.featureGroup(layerList);map.fitBounds(group.getBounds().pad(0.15));}
  }
  renderMarkers(reports.reports);
  var communeSel=$("#map-commune");
  if(communeSel){
    communeSel.onchange=async function(){
      var f={statuses:["active"]};
      if(communeSel.value)f.commune=communeSel.value;
      var rr=await Data.getReports(f);
      renderMarkers(rr.reports);
    };
  }
  if($("#locate-me-btn")){$("#locate-me-btn").onclick=function(){navigator.geolocation.getCurrentPosition(function(p){map.setView([p.coords.latitude,p.coords.longitude],14);showToast("Ubicación encontrada","success");},function(){showToast("No se pudo obtener ubicación","error");},{enableHighAccuracy:true});};}
}

async function initPetsPage(){
  bindNavLinks();
  var user=await AuthService.me();
  var profile=await AuthService.profile();
  await ensureCatalogs();
  var container=$("#app");
  container.innerHTML=navHTML(user,profile)+'<main class="app-main">'+
  '<div class="page-header"><div><h1>Mis Mascotas</h1><p class="page-subtitle">Registra tus mascotas</p></div><button class="btn btn-primary" id="add-pet-btn">+ Añadir mascota</button></div>'+
  '<div id="pets-grid" class="pets-grid"></div>'+
  '<div id="pet-modal" class="modal" hidden><div class="modal-backdrop"></div><div class="modal-content modal-lg"><header class="modal-header"><h2 id="pet-modal-title">Registrar mascota</h2><button class="modal-close">&times;</button></header>'+
  '<form id="pet-form" class="modal-body"><input type="hidden" name="id">'+
  '<div class="form-row"><div class="form-group"><label>Nombre *</label><input type="text" name="name" required maxlength="100"></div><div class="form-group"><label>Especie *</label><select name="speciesId" required><option value="">Seleccionar</option>'+cachedEspecies.map(function(e){return '<option value="'+e.id+'">'+e.nombre+'</option>';}).join("")+'</select></div></div>'+
  '<div class="form-row"><div class="form-group"><label>Raza</label><input type="text" name="breed" maxlength="100"></div><div class="form-group"><label>Color *</label><input type="text" name="color" required maxlength="100"></div></div>'+
  '<div class="form-row"><div class="form-group"><label>Tamaño *</label><select name="size" required><option value="">Seleccionar</option><option value="small">Pequeño</option><option value="medium">Mediano</option><option value="large">Grande</option></select></div><div class="form-group"><label>Sexo</label><select name="gender"><option value="">No especificado</option><option value="male">Macho</option><option value="female">Hembra</option></select></div></div>'+
  '<div class="form-group"><label>Señas particulares</label><textarea name="characteristics" rows="3" maxlength="500"></textarea></div>'+
  '<div class="modal-actions"><button type="button" class="btn btn-secondary modal-close">Cancelar</button><button type="submit" class="btn btn-primary">Guardar</button></div></form></div></div>'+
  '</main>';
  bindNavLinks();
  var pets=await Data.getMyPets();
  var grid=$("#pets-grid");
  function renderPets(){
    if(!pets.length){grid.innerHTML='<div class="empty-state"><p>No tienes mascotas registradas</p><button class="btn btn-primary" id="first-pet-btn">Registrar mascota</button></div>';var fpb=$("#first-pet-btn");if(fpb)fpb.onclick=function(){openPetModal();};return;}
    grid.innerHTML=pets.map(function(p){return '<article class="pet-card"><div class="pet-info"><h3 class="pet-name">'+p.name+'</h3><p class="pet-details">'+(p.species||"")+' • '+(p.breed||"Sin raza")+' • '+(p.color||"")+'</p><div class="pet-meta"><span class="pet-size">'+({small:"Pequeño",medium:"Mediano",large:"Grande"}[p.size]||"")+'</span></div></div><div class="pet-actions"><button class="icon-btn edit-pet" data-id="'+p.id+'" aria-label="Editar">✏️</button><button class="icon-btn danger delete-pet" data-id="'+p.id+'" aria-label="Eliminar">🗑️</button></div></article>';}).join("");
    $$(".edit-pet").forEach(function(b){b.onclick=function(){var pet=pets.find(function(x){return x.id===b.dataset.id;});openPetModal(pet);};});
    $$(".delete-pet").forEach(function(b){b.onclick=async function(){var pet=pets.find(function(x){return x.id===b.dataset.id;});if(pet&&confirm("¿Eliminar a "+pet.name+"?")){try{await Data.deletePet(pet.id);pets=await Data.getMyPets();renderPets();showToast("Mascota eliminada","success");}catch(e){showToast(e.message,"error");}}};});
  }
  function openPetModal(pet){
    showModal("pet-modal");
    var f=$("#pet-form");f.reset();
    $("#pet-modal-title").textContent=pet?"Editar mascota":"Registrar mascota";
    $('input[name="id"]').value=pet?pet.id:"";
    if(pet){
      f.name.value=pet.name;f.speciesId.value=pet.speciesId||"";f.breed.value=pet.breed||"";f.color.value=pet.color||"";f.size.value=pet.size||"";f.characteristics.value=pet.characteristics||"";
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
      hideModal("pet-modal");pets=await Data.getMyPets();renderPets();
    }catch(err){showToast(err.message,"error");}
  };
  renderPets();
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
  '<div class="filter-section"><h3>Búsqueda</h3><div class="form-group"><input type="search" id="search-query" name="query" placeholder="Nombre, color, ubicación..."></div></div>'+
  '<div class="filter-section"><h3>Tipo</h3><div class="filter-options"><label class="filter-option"><input type="checkbox" name="type" value="lost" checked><span>Perdida</span></label><label class="filter-option"><input type="checkbox" name="type" value="found" checked><span>Encontrada</span></label><label class="filter-option"><input type="checkbox" name="type" value="sighting" checked><span>Avistamiento</span></label></div></div>'+
  '<div class="filter-section"><h3>Comuna</h3><select id="filter-commune" name="commune">'+communeOptionsHTML(cachedCommunes,"")+'</select></div>'+
  '<div class="filter-actions"><button type="button" class="btn btn-secondary" id="clear-filters">Limpiar</button><button type="submit" class="btn btn-primary">Filtrar</button></div></form></aside>'+
  '<main class="reports-results"><div class="results-header"><span id="results-count">Cargando...</span></div>'+
  '<div id="reports-container" class="reports-container reports-list"></div></main></div></main>';
  bindNavLinks();
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
    ctr.innerHTML=reports.map(function(r){return '<article class="report-card" data-id="'+r.id+'" tabindex="0"><div class="report-type '+getTypeClass(r.type)+'">'+getTypeLabel(r.type)+'</div><div class="report-info"><div class="report-header"><h4>'+r.petName+'</h4><span class="report-status '+getStatusClass(r.status)+'">'+getStatusLabel(r.status)+'</span></div><p class="report-location">'+(r.neighborhood||"")+'</p><p class="report-date">'+timeAgo(r.createdAt)+'</p></div><div class="report-code">'+r.code+'</div></article>';}).join("");
    $$(".report-card").forEach(function(c){c.onclick=function(){navigateTo("reports/"+c.dataset.id);};});
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
  '<div class="page-header"><h1>Nuevo Reporte</h1><p class="page-subtitle">Ayuda a encontrar una mascota</p></div>'+
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
  '<div class="form-group"><label>Ubicación / referencia *</label><input type="text" name="location" required maxlength="200"></div>'+
  '<div class="form-group"><label>Señas / descripción</label><textarea name="characteristics" rows="3" maxlength="500"></textarea></div></div>'+
  '<div class="form-section"><h2>Información de contacto</h2>'+
  '<div class="form-row"><div class="form-group"><label>Tu nombre *</label><input type="text" name="contactName" required maxlength="100" value="'+(profile?profile.nombre:"")+'"></div><div class="form-group"><label>Teléfono *</label><input type="tel" name="contactPhone" required value="'+(profile?profile.telefono||"":"")+'"></div></div>'+
  '<div class="form-group"><label class="checkbox-label"><input type="checkbox" name="showContact" checked> Mostrar mi contacto</label></div></div>'+
  '<div class="form-actions"><button type="submit" class="btn btn-primary">Publicar reporte</button></div></form>'+
  '<div id="success-modal" class="modal" hidden><div class="modal-backdrop"></div><div class="modal-content"><header class="modal-header"><h2>¡Publicado!</h2><button class="modal-close">&times;</button></header><div class="modal-body success-content"><div class="success-icon">✅</div><h3>Tu reporte ha sido publicado</h3><p>Código: <strong id="published-code"></strong></p><div class="success-actions"><button class="btn btn-primary" id="share-report-btn">Compartir</button><button class="btn btn-secondary modal-close">Cerrar</button></div></div></div></div>'+
  '</main>';
  bindNavLinks();
  var form=$("#report-form");
  var communeSel=$("#report-commune");
  var barrioSel=$("#report-neighborhood");
  communeSel.onchange=function(){barrioSel.innerHTML=barrioOptionsHTML(cachedBarrios,communeSel.value);barrioSel.disabled=!communeSel.value;};
  $$("#success-modal .modal-close, #success-modal .modal-backdrop").forEach(function(el){el.onclick=function(){hideModal("success-modal");};});
  form.onsubmit=async function(e){
    e.preventDefault();
    var d=new FormData(form);
    var type=d.get("type"),petName=d.get("petName"),speciesId=d.get("speciesId"),color=d.get("color"),size=d.get("size"),commune=d.get("commune"),barrio=d.get("barrio"),location=d.get("location"),contactName=d.get("contactName"),contactPhone=d.get("contactPhone");
    if(!type||!petName||!speciesId||!color||!size||!commune||!barrio||!location||!contactName||!contactPhone){showToast("Completa todos los campos obligatorios","error");return;}
    var lat=null,lng=null;
    if(navigator.geolocation){
      try{
        var pos=await new Promise(function(res,rej){navigator.geolocation.getCurrentPosition(res,rej,{timeout:3000});});
        lat=pos.coords.latitude;lng=pos.coords.longitude;
      }catch(err){}
    }
    var reportData={type:type,petName:petName,speciesId:speciesId,color:color,size:size,barrioId:parseInt(barrio),location:location,characteristics:d.get("characteristics")||"",date:d.get("date")||null,lat:lat,lng:lng};
    try{
      var rep=await Data.createReport(reportData);
      var code=$("#published-code");if(code)code.textContent=rep.codigo_unico;
      showModal("success-modal");showToast("Reporte publicado","success");
      if($("#share-report-btn")){$("#share-report-btn").onclick=function(){var url=window.location.origin+"#reports/"+rep.id;if(navigator.clipboard){navigator.clipboard.writeText(url);showToast("Enlace copiado","success");}};}
    }catch(err){showToast(err.message,"error");}
  };
}

async function initReportDetail(){
  bindNavLinks();
  var hash=window.location.hash.split("/");var id=hash[hash.length-1];
  var user=await AuthService.me();
  var profile=await AuthService.profile();
  var report=await Data.getReportById(id);
  var container=$("#app");
  if(!report){showToast("Reporte no encontrado","error");navigateTo("reports");return;}
  var isAuthor=user&&report.userId===user.id;
  var sightings=report.sightings||[];
  container.innerHTML=navHTML(user,profile)+'<main class="app-main">'+
  '<div class="page-header"><div><h1>Detalle del Reporte</h1><p class="page-subtitle" id="report-code-display">'+report.code+'</p></div><div class="header-actions"><button class="btn btn-secondary" id="back-btn">Volver</button></div></div>'+
  '<div class="detail-grid"><div class="detail-main"><div class="detail-info"><div class="detail-header"><div class="report-type '+getTypeClass(report.type)+'">'+getTypeLabel(report.type)+'</div><span class="report-status '+getStatusClass(report.status)+'">'+getStatusLabel(report.status)+'</span></div>'+
  '<h2>'+report.petName+'</h2><div class="detail-meta"><span><strong>Color:</strong> '+(report.color||"-")+'</span><span><strong>Tamaño:</strong> '+(report.size||"-")+'</span></div>'+
  (report.characteristics?'<div class="detail-section"><h3>Señas</h3><p>'+report.characteristics+'</p></div>':"")+
  '<div class="detail-section"><h3>Ubicación</h3><p>'+(report.location||"")+', '+(report.neighborhood||"")+', '+(report.commune||"")+'</p></div>'+
  '<div class="detail-section"><h3>Fecha</h3><p>'+formatDate(report.date||report.createdAt)+'</p></div></div></div>'+
  '<div class="detail-sidebar"><div class="sidebar-card"><h3>Contacto</h3><p><strong>'+report.contactName+'</strong></p><p><a href="tel:'+report.contactPhone+'">'+report.contactPhone+'</a></p></div>'+
  '<div class="sidebar-card"><h3>Acciones</h3><div class="action-buttons">'+
  '<button class="btn btn-secondary btn-sm" id="add-sighting-btn">Señalar avistamiento</button>'+
  '<button class="btn btn-secondary btn-sm" id="share-btn">Compartir</button>'+
  (isAuthor&&report.status==="active"?'<button class="btn btn-success btn-sm" id="close-report-btn">Cerrar reporte</button>':"")+
  '<button class="btn btn-danger btn-sm" id="flag-btn">Denunciar</button>'+
  '</div></div></div></div>'+
  (sightings.length?'<div class="sightings-section"><h3>Avistamientos ('+sightings.length+')</h3><div class="sightings-list">'+sightings.map(function(s){return '<div class="sighting-card"><div class="sighting-header"><span class="sighting-date">'+formatDate(s.date)+'</span><span class="sighting-location">'+(s.location||"")+'</span></div>'+(s.description?'<p class="sighting-desc">'+s.description+'</p>':"")+'</div>';}).join('')+'</div></div>':"")+
  '<div id="add-sighting-modal" class="modal" hidden><div class="modal-backdrop"></div><div class="modal-content modal-lg"><header class="modal-header"><h2>Registrar avistamiento</h2><button class="modal-close">&times;</button></header>'+
  '<form id="sighting-form" class="modal-body"><input type="hidden" name="reportId" value="'+report.id+'">'+
  '<div class="form-row"><div class="form-group"><label>Fecha *</label><input type="datetime-local" name="date" required value="'+new Date().toISOString().slice(0,16)+'"></div><div class="form-group"><label>Comuna *</label><select id="sighting-commune" name="commune" required>'+communeOptionsHTML(cachedCommunes,"")+'</select></div></div>'+
  '<div class="form-group"><label>Barrio *</label><select id="sighting-neighborhood" name="barrio" required disabled><option value="">Seleccione comuna</option></select></div>'+
  '<div class="form-group"><label>Ubicación *</label><input type="text" name="location" required maxlength="200"></div>'+
  '<div class="form-group"><label>Descripción</label><textarea name="description" rows="3" maxlength="500"></textarea></div>'+
  '<div class="modal-actions"><button type="button" class="btn btn-secondary modal-close">Cancelar</button><button type="submit" class="btn btn-primary">Registrar</button></div></form></div></div>'+
  '<div id="flag-modal" class="modal" hidden><div class="modal-backdrop"></div><div class="modal-content"><header class="modal-header"><h2>Denunciar</h2><button class="modal-close">&times;</button></header>'+
  '<form id="flag-form" class="modal-body"><input type="hidden" name="reportId" value="'+report.id+'">'+
  '<div class="form-group"><label>Motivo *</label><div class="radio-group"><label class="radio-option"><input type="radio" name="reason" value="fake" required> Información falsa</label><label class="radio-option"><input type="radio" name="reason" value="inappropriate"> Contenido inapropiado</label><label class="radio-option"><input type="radio" name="reason" value="spam"> Spam</label></div></div>'+
  '<div class="modal-actions"><button type="button" class="btn btn-secondary modal-close">Cancelar</button><button type="submit" class="btn btn-danger">Enviar</button></div></form></div></div>'+
  '</main>';
  bindNavLinks();
  var sCommune=$("#sighting-commune");var sBarrio=$("#sighting-neighborhood");
  if(sCommune){sCommune.onchange=function(){sBarrio.innerHTML=barrioOptionsHTML(cachedBarrios,sCommune.value);sBarrio.disabled=!sCommune.value;};}
  $("#add-sighting-btn").onclick=function(){showModal("add-sighting-modal");};
  $("#share-btn").onclick=function(){var url=window.location.origin+"#reports/"+report.id;if(navigator.clipboard){navigator.clipboard.writeText(url);showToast("Enlace copiado","success");}};
  $("#flag-btn").onclick=function(){showModal("flag-modal");};
  $("#back-btn").onclick=function(){history.back();};
  if($("#close-report-btn")){$("#close-report-btn").onclick=async function(){if(confirm("¿Cerrar reporte? La mascota fue recuperada.")){try{await Data.closeReport(report.id);showToast("Reporte cerrado","success");navigateTo("reports");}catch(e){showToast(e.message,"error");}}};}
  $$("#add-sighting-modal .modal-close, #add-sighting-modal .modal-backdrop").forEach(function(el){el.onclick=function(){hideModal("add-sighting-modal");};});
  $$("#flag-modal .modal-close, #flag-modal .modal-backdrop").forEach(function(el){el.onclick=function(){hideModal("flag-modal");};});
  $("#sighting-form").onsubmit=async function(e){
    e.preventDefault();var d=new FormData(e.target);var data={date:d.get("date"),commune:d.get("commune"),barrioId:parseInt(d.get("barrio")),location:d.get("location"),description:d.get("description")||""};if(!data.date||!data.commune||!data.barrioId||!data.location){showToast("Completa los campos","error");return;}
    try{await Data.addSighting(report.id,data);showToast("Avistamiento registrado. El dueño será notificado.","success");hideModal("add-sighting-modal");await initReportDetail();}catch(err){showToast(err.message,"error");}
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
  '<nav class="admin-tabs"><button class="admin-tab active" data-tab="users">Usuarios</button><button class="admin-tab" data-tab="reports">Denuncias</button><button class="admin-tab" data-tab="communes">Comunas</button><button class="admin-tab" data-tab="stats">Estadísticas</button></nav>'+
  '<div class="admin-content">'+
  '<div id="tab-users" class="admin-tab-panel"><div class="table-container"><table class="admin-table"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody id="users-table-body"></tbody></table></div></div>'+
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
    if(tab==="reports")await renderFlags();
    if(tab==="communes")await renderCommunes();
    if(tab==="stats")await renderStats();
  }
  async function renderUsers(){
    var users=await Data.getAdminUsers();var tbody=$("#users-table-body");if(!tbody)return;
    tbody.innerHTML=users.map(function(u){return '<tr><td><strong>'+u.nombre+'</strong></td><td>'+u.email+'</td><td><span class="badge badge-'+u.rol+'">'+(ROLE_LABEL[u.rol]||u.rol)+'</span></td><td><span class="badge badge-'+(u.activo?"active":"inactive")+'">'+(u.activo?"Activo":"Inactivo")+'</span></td><td><button class="icon-btn toggle-role" data-id="'+u.id+'" data-rol="'+u.rol+'">🔄</button> <button class="icon-btn danger del-user" data-id="'+u.id+'">🗑️</button></td></tr>';}).join("");
    $$(".toggle-role").forEach(function(b){b.onclick=async function(){var newRole=b.dataset.rol==="administrador"?"usuario":"administrador";try{await Data.updateUser(b.dataset.id,{role:newRole==="administrador"?"admin":"user"});showToast("Rol actualizado","success");await renderUsers();}catch(e){showToast(e.message,"error");}};});
    $$(".del-user").forEach(function(b){b.onclick=async function(){if(confirm("¿Eliminar usuario?")){try{await Data.deleteUser(b.dataset.id);showToast("Usuario eliminado","success");await renderUsers();}catch(e){showToast(e.message,"error");}}};});
  }
  async function renderFlags(){
    var flags=await Data.getFlags();var tbody=$("#flags-table-body");if(!tbody)return;
    if(!flags.length){tbody.innerHTML='<tr><td colspan="4" class="text-center">Sin denuncias</td></tr>';return;}
    tbody.innerHTML=flags.map(function(f){
      var actions=f.status==="pending"?'<button class="icon-btn approve-flag" data-id="'+f.id+'">✅</button><button class="icon-btn danger dismiss-flag" data-id="'+f.id+'">❌</button>':"";
      return '<tr><td>'+f.petName+'</td><td>'+f.reason+'</td><td><span class="badge badge-'+(f.status==="pending"?"pending":f.status)+'">'+f.status+'</span></td><td>'+actions+'</td></tr>';
    }).join("");
    $$(".approve-flag").forEach(function(b){b.onclick=async function(){try{await Data.moderateFlag(b.dataset.id,"reviewed");showToast("Revisado","success");await renderFlags();}catch(e){showToast(e.message,"error");}};});
    $$(".dismiss-flag").forEach(function(b){b.onclick=async function(){try{await Data.moderateFlag(b.dataset.id,"dismissed");showToast("Desestimado","success");await renderFlags();}catch(e){showToast(e.message,"error");}};});
  }
  async function renderCommunes(){
    var communes=cachedCommunes.length?cachedCommunes:await Data.getCommunes();
    cachedCommunes=communes;
    if(!cachedBarrios.length) cachedBarrios=await Data.getBarrios();
    var ctr=$("#communes-list");if(!ctr)return;
    ctr.innerHTML=communes.map(function(c){
      var barrios=cachedBarrios.filter(function(b){return String(b.comuna_id)===String(c.id);});
      return '<div class="commune-card"><div class="commune-header"><h4>'+c.nombre+'</h4><button class="icon-btn danger del-commune" data-id="'+c.id+'">🗑️</button></div><div class="neighborhoods-tags">'+barrios.map(function(b){return '<span class="tag">'+b.nombre+'</span>';}).join("")+'</div></div>';
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
  '<div class="profile-avatar-section"><div class="profile-avatar">'+((profile?profile.nombre:"U").charAt(0).toUpperCase())+'</div><h2>'+(profile?profile.nombre:"")+'</h2><p class="text-muted">'+(profile?profile.email:"")+'</p></div>'+
  '<div class="form-section" style="padding:24px"><h3>Información</h3><p><strong>Nombre:</strong> '+(profile?profile.nombre:"")+'</p><p><strong>Correo:</strong> '+(profile?profile.email:"")+'</p><p><strong>Teléfono:</strong> '+(profile?profile.telefono||"No registrado":"")+'</p><p><strong>Rol:</strong> '+(profile&&profile.rol==="administrador"?"Administrador":"Usuario")+'</p></div>'+
  '</div><aside class="profile-sidebar"><div class="sidebar-card"><h3>Cuenta</h3><p class="text-muted">Miembro de FusaPet</p></div></aside></div></main>';
  bindNavLinks();
}

// ========== LOGIN INIT ==========
function initLoginPage(){
  var app=$("#app");
  if(app)app.innerHTML='<div class="auth-page">'+PAGES.login+'</div>';
  var loginTab=$("#login-tab");var registerTab=$("#register-tab");
  var loginForm=$("#login-form");var registerForm=$("#register-form");
  if(loginTab){loginTab.onclick=function(){loginTab.classList.add("active");registerTab.classList.remove("active");loginForm.hidden=false;registerForm.hidden=true;};}
  if(registerTab){registerTab.onclick=function(){registerTab.classList.add("active");loginTab.classList.remove("active");registerForm.hidden=false;loginForm.hidden=true;};}
  if(loginForm){loginForm.onsubmit=async function(e){e.preventDefault();var email=$("#login-email").value;var pass=$("#login-password").value;var btn=$("button[type=submit]",loginForm);btn.disabled=true;btn.textContent="Ingresando...";try{await AuthService.login(email,pass);cachedUser=null;cachedProfile=null;showToast("Bienvenido","success");window.location.hash="dashboard";}catch(err){showToast(err.message,"error");btn.disabled=false;btn.textContent="Ingresar";}};}
  if(registerForm){registerForm.onsubmit=async function(e){e.preventDefault();var name=$("#register-name").value;var email=$("#register-email").value;var pass=$("#register-password").value;var confirm=$("#register-confirm-password").value;if(pass!==confirm){showToast("Las contraseñas no coinciden","error");return;}var btn=$("button[type=submit]",registerForm);btn.disabled=true;btn.textContent="Registrando...";try{var res=await AuthService.register(name,email,pass,$("#register-phone").value);cachedUser=null;cachedProfile=null;if(res&&res.emailConfirmation){showToast("Revisa tu correo para confirmar tu cuenta","info");}else{showToast("Cuenta creada","success");window.location.hash="dashboard";}}catch(err){showToast(err.message,"error");btn.disabled=false;btn.textContent="Registrarse";}};}
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
  '<p style="color:#c62828;margin-bottom:16px">'+String(extra||"Error desconocido.")+'</p>'+
  '<p style="color:#888;font-size:14px;margin-bottom:20px">La app carga Leaflet y Supabase desde CDN (unpkg.com y cdn.jsdelivr.net). Revisa tu conexion a internet o desactiva bloqueadores.</p>'+
  '<div style="display:flex;gap:12px;justify-content:center"><button class="btn btn-primary" onclick="location.reload()">Reintentar</button></div></div>';
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
    var authed=await AuthService.isAuthenticated();
    if(!authed){initLoginPage();return;}
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
  }catch(err){
    console.error(err);
    if(document.getElementById("app")&&document.getElementById("app").querySelector(".loading-screen")){
      renderBootError("Error: "+(err.message||"desconocido")+".");
    }
  }
}

})();