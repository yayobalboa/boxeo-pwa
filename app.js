// ==========================================
// CONFIGURACIÓN DE LA PWA Y LA API
// ==========================================
// ¡Tu URL ya está insertada aquí correctamente!
const GAS_URL = "https://script.google.com/macros/s/AKfycbyI0-gSyeSI4UpBWQINfatmK8iULJBPwRJE-BVIpXIp57SXbeM-vrO2VP739yGdWpKM/exec";

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('PWA Lista y registrada', reg))
      .catch(err => console.warn('PWA Falló', err));
  });
}

const server = {
    getDatos: async function(successCallback, failureCallback) {
        try {
            const res = await fetch(GAS_URL + "?action=getDatos", {
                method: "GET",
                redirect: "follow"
            });
            const text = await res.text(); 
            const data = JSON.parse(text); 
            if(successCallback) successCallback(data);
        } catch (e) {
            console.error("Error en getDatos:", e);
            if(failureCallback) failureCallback(e);
        }
    },
    postData: async function(payload, successCallback, failureCallback) {
        try {
            const res = await fetch(GAS_URL, {
                method: "POST",
                redirect: "follow", 
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify(payload)
            });
            const text = await res.text();
            const data = JSON.parse(text);
            if(successCallback) successCallback(data);
        } catch (e) {
            console.error("Error en postData:", e);
            if(failureCallback) failureCallback(e);
        }
    }
};

// ==========================================
// VARIABLES GLOBALES
// ==========================================
const form = document.getElementById('formReporte');
const btnSubmit = document.getElementById('btnFinalizar');

let bdGimnasios = {};
let catEdoMun = {};
let urlsArchivosSubidos = {}; 
let archivosEnProceso = 0; 
let geo_lat = "-";
let geo_lon = "-";
let geo_acc = "-";
let killReasonGlobal = "";
let pendientesCountGlobal = 0; 

// ==========================================
// NORMALIZACIÓN DE TEXTO
// ==========================================
document.addEventListener('input', function (e) {
    const el = e.target;
    if ((el.tagName === 'INPUT' && el.type === 'text' || el.tagName === 'TEXTAREA') && !el.classList.contains('clean-direccion')) {
        let start = el.selectionStart;
        let end = el.selectionEnd;
        let texto = el.value.toUpperCase();
        const mapaAcentos = { 'Á': 'A', 'É': 'E', 'Í': 'I', 'Ó': 'O', 'Ú': 'U', 'À': 'A', 'È': 'E', 'Ì': 'I', 'Ò': 'O', 'Ù': 'U', 'Ä': 'A', 'Ë': 'E', 'Ï': 'I', 'Ö': 'O', 'Ü': 'U' };
        el.value = texto.split('').map(letra => mapaAcentos[letra] || letra).join('');
        el.setSelectionRange(start, end);
    }
});

document.addEventListener('blur', function(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        e.target.value = e.target.value.trim().replace(/\s+/g, ' ');
    }
}, true);

// ==========================================
// EVENTOS DE CARGA (ONLOAD)
// ==========================================
window.addEventListener('load', () => {
    capturarGeolocalizacion();
    revisarPendientes();
    configurarBloqueoCasillas(); 
    
    window.addEventListener('online', () => {
        document.getElementById('offline-alert').style.display = 'none';
        revisarPendientes();
    });
    window.addEventListener('offline', () => {
        document.getElementById('offline-alert').style.display = 'block';
    });

    const ahora = new Date();
    const str = ahora.toLocaleString('es-MX').replace(/,/g, "");
    if(document.getElementById('timestamp')) document.getElementById('timestamp').value = str;
    
    const banner = document.getElementById('bannerFecha');
    if(banner) {
        banner.innerText = "Sincronizando con base de datos...";
    }

    // Llamada al Backend de Google
    server.getDatos(
        (data) => {
            if(data.ERROR) { 
                console.error(data.ERROR);
                if(banner) banner.innerHTML = "❌ Error de conexión. <button onclick='location.reload()'>Reintentar</button>";
                return; 
            }
            if(banner) banner.innerText = "Fecha y hora de inicio: " + str;
            
            bdGimnasios = data.bdGimnasios || {};
            catEdoMun = data.catEdoMun || {};
            inicializarBuscador();
            inicializarBuscadorDireccion();
        },
        (err) => {
            if(banner) banner.innerHTML = "❌ Fallo de red. <button class='btn btn-sm btn-danger' onclick='location.reload()'>Reintentar</button>";
        }
    );

    generarTablaHorarios();

    document.querySelectorAll('input[type="file"]').forEach(input => {
        input.addEventListener('change', dispararSubidaAsincrona);
    });
});

function capturarGeolocalizacion() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
        (pos) => { geo_lat = pos.coords.latitude; geo_lon = pos.coords.longitude; geo_acc = pos.coords.accuracy; },
        (err) => console.warn("Error GPS: " + err.message),
        { enableHighAccuracy: true, timeout: 15000 }
    );
}

// ==========================================
// LÓGICA ANTI-CONTRADICCIÓN DE CASILLAS
// ==========================================
function configurarBloqueoCasillas() {
    const eqChecks = document.querySelectorAll('.check-equipamiento');
    const eqNinguno = Array.from(eqChecks).find(c => c.value === 'Ninguno de los anteriores');
    if(eqNinguno) {
        eqChecks.forEach(c => c.addEventListener('change', (e) => {
            if (e.target === eqNinguno && e.target.checked) {
                eqChecks.forEach(o => { if(o !== eqNinguno) o.checked = false; });
            } else if (e.target !== eqNinguno && e.target.checked) {
                eqNinguno.checked = false;
            }
        }));
    }

    const difChecks = document.querySelectorAll('.check-difusion');
    const difNinguno = Array.from(difChecks).find(c => c.value === 'Ninguno');
    const divOtroDif = document.getElementById('divOtroDifusion');
    const inOtroDif = document.getElementById('inputOtroDifusion');

    if(difNinguno) {
        difChecks.forEach(c => c.addEventListener('change', (e) => {
            if (e.target === difNinguno && e.target.checked) {
                difChecks.forEach(o => { if(o !== difNinguno) o.checked = false; });
                if(divOtroDif) divOtroDif.style.display = 'none';
                if(inOtroDif) { inOtroDif.required = false; inOtroDif.value = ""; }
            } else if (e.target !== difNinguno && e.target.checked) {
                difNinguno.checked = false;
            }
        }));
    }
}

// ==========================================
// COMPRESIÓN MÁXIMA PARA OFFLINE Y SUBIDA
// ==========================================
function procesarArchivoAsync(file, maxWidth = 800, quality = 0.4) {
    return new Promise((resolve, reject) => {
        if (file.type.startsWith('image/') && !file.type.includes('heic')) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    try {
                        const canvas = document.createElement('canvas');
                        let width = img.width, height = img.height;
                        if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
                        canvas.width = width; canvas.height = height;
                        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                        resolve(canvas.toDataURL('image/jpeg', quality)); 
                    } catch (e) { resolve(event.target.result); }
                };
                img.onerror = () => resolve(event.target.result);
                img.src = event.target.result; 
            };
            reader.onerror = () => reject(new Error("Error lectura"));
            reader.readAsDataURL(file);
        } else {
            const reader = new FileReader();
            reader.onload = (event) => resolve(event.target.result);
            reader.onerror = () => reject(new Error("Error lectura"));
            reader.readAsDataURL(file);
        }
    });
}

async function dispararSubidaAsincrona(event) {
    const input = event.target;
    const file = input.files[0];
    if (!file) return;

    let statusBadge = document.getElementById(`status_${input.id}`);
    if (!statusBadge) {
        statusBadge = document.createElement('span');
        statusBadge.id = `status_${input.id}`;
        input.parentNode.insertBefore(statusBadge, input.nextSibling);
    }

    statusBadge.className = 'badge bg-warning ms-2 text-dark mt-1 d-block text-start text-wrap';
    statusBadge.innerHTML = '⏳ Comprimiendo y Subiendo...';
    
    archivosEnProceso++;
    btnSubmit.disabled = true;
    if(btnSubmit.innerText.indexOf("ENVIAR") === -1) btnSubmit.innerText = "ESPERANDO CARGA DE ARCHIVOS...";

    try {
        const base64Data = await procesarArchivoAsync(file);
        const mimeType = file.type || (base64Data.includes('application/pdf') ? 'application/pdf' : 'image/jpeg');
        const ext = mimeType === 'application/pdf' ? '.pdf' : '.jpg';
        
        const gym = document.getElementById('selectGimnasio')?.value || "Gym";
        const tutor = document.getElementById('inputTutorRegistro')?.value || "Tutor";
        const fecha = new Date().toISOString().slice(0,10).replace(/-/g,"");
        const nombreArchivo = `${gym}_${tutor}_${input.id}_${fecha}${ext}`.replace(/\s+/g, '_');

        if (!navigator.onLine) {
            urlsArchivosSubidos[input.id] = base64Data; 
            statusBadge.className = 'badge bg-info ms-2 mt-1 d-block text-start text-wrap text-dark';
            statusBadge.innerHTML = '💾 Listo para guardar offline';
            liberarBotonSubmit();
            return;
        }

        const payload = { action: "upload", base64: base64Data, mimeType: mimeType, filename: nombreArchivo, sufijo: input.id };
        
        server.postData(payload, 
            (res) => {
                if (res.success) {
                    urlsArchivosSubidos[input.id] = res.url;
                    statusBadge.className = 'badge bg-success ms-2 mt-1 d-block text-start text-wrap';
                    statusBadge.innerHTML = '✅ Archivo en la nube';
                } else {
                    urlsArchivosSubidos[input.id] = base64Data; 
                    statusBadge.className = 'badge bg-info ms-2 mt-1 d-block text-start text-wrap text-dark';
                    statusBadge.innerHTML = `⚠️ Falló subida de Google. Se guardará offline.`;
                }
                liberarBotonSubmit();
            },
            (err) => {
                urlsArchivosSubidos[input.id] = base64Data; 
                statusBadge.className = 'badge bg-info ms-2 mt-1 d-block text-start text-wrap text-dark';
                statusBadge.innerHTML = `⚠️ Falló subida. Se guardará offline.`;
                liberarBotonSubmit();
            }
        );
    } catch (error) {
        statusBadge.className = 'badge bg-danger ms-2 mt-1 d-block text-start text-wrap';
        statusBadge.innerHTML = `❌ Error: ${error.message}`;
        input.value = ""; delete urlsArchivosSubidos[input.id];
        liberarBotonSubmit();
    }
}

function liberarBotonSubmit() {
    archivosEnProceso--;
    if (archivosEnProceso <= 0) {
        archivosEnProceso = 0;
        btnSubmit.disabled = false;
        evaluarKillSwitches(); 
    }
}

// ==========================================
// TABLA DE HORARIOS
// ==========================================
function obtenerOpcionesHoras() {
    let opciones = '<option value="" selected disabled>Seleccione...</option>';
    const horas = ["06:00-07:00", "07:00-08:00", "08:00-09:00", "09:00-10:00", "10:00-11:00", "11:00-12:00", "12:00-13:00", "13:00-14:00", "14:00-15:00", "15:00-16:00", "16:00-17:00", "17:00-18:00", "18:00-19:00", "19:00-20:00", "20:00-21:00", "NINGUNO"];
    horas.forEach(h => opciones += `<option value="${h}">${h === 'NINGUNO' ? 'Ninguno' : h}</option>`);
    return opciones;
}

function generarTablaHorarios() {
    const d = "Lunes_Viernes"; 
    const cuerpo = document.getElementById('tablaCuerpoHorarios');
    if(!cuerpo) return;
    cuerpo.innerHTML = `<tr id="fila-${d}"><td class="fw-bold text-center align-middle">LUNES A VIERNES</td><td><div id="box-horas-${d}" class="d-flex flex-column gap-2 mb-2"><select required class="form-select form-select-sm select-hora" onchange="validarDuplicado('${d}')">${obtenerOpcionesHoras()}</select></div><button type="button" class="btn btn-sm btn-outline-primary w-100 fw-bold" onclick="agregarSelect('${d}')" id="btn-add-${d}">+ Agregar otra clase</button></td><td class="text-center align-middle"><input type="checkbox" class="form-check-input" style="transform: scale(1.5);" onchange="bloquearFila('${d}', this)"></td></tr>`;
}

function agregarSelect(dia) {
    const contenedor = document.getElementById(`box-horas-${dia}`);
    if(contenedor.querySelectorAll('select').length >= 6) return alert("⚠️ Máximo 6 clases.");
    const nuevoSelect = document.createElement('select');
    nuevoSelect.className = "form-select form-select-sm select-hora";
    nuevoSelect.innerHTML = obtenerOpcionesHoras();
    nuevoSelect.required = true; 
    nuevoSelect.onchange = function() { validarDuplicado(dia); };
    contenedor.appendChild(nuevoSelect);
}

function validarDuplicado(dia) {
    const contenedor = document.getElementById(`box-horas-${dia}`);
    const selects = Array.from(contenedor.querySelectorAll('select'));
    const valores = selects.map(s => s.value).filter(v => v !== "" && v !== "NINGUNO");
    const duplicados = valores.some((val, index) => valores.indexOf(val) !== index);
    if (duplicados) { alert(`⚠️ Error: Horario duplicado.`); if(event) event.target.value = ""; }
}

function bloquearFila(dia, cb) {
    const fila = document.getElementById(`fila-${dia}`);
    fila.querySelectorAll('select').forEach(s => { s.disabled = cb.checked; if (cb.checked) s.value = ""; });
    document.getElementById(`btn-add-${dia}`).disabled = cb.checked;
}

// ==========================================
// LOGICA DE CAMPOS Y DESPLEGABLES
// ==========================================
function inicializarBuscador() {
    const selectEstado = document.getElementById('selectEstado');
    if(!selectEstado) return;
    selectEstado.innerHTML = '<option value="" disabled selected>Seleccione Estado...</option>';
    Object.keys(bdGimnasios).sort().forEach(edo => selectEstado.add(new Option(edo, edo)));
}

function cargarMunicipios() {
    const estadoSel = document.getElementById('selectEstado').value;
    const selectMun = document.getElementById('selectMunicipio');
    const selectGim = document.getElementById('selectGimnasio');
    selectMun.innerHTML = '<option value="" disabled selected>Seleccione Municipio...</option>';
    selectGim.innerHTML = '<option value="" disabled selected>Seleccione...</option>';
    selectGim.disabled = true;
    if (bdGimnasios && bdGimnasios[estadoSel]) {
        Object.keys(bdGimnasios[estadoSel]).sort().forEach(mun => selectMun.add(new Option(mun, mun)));
        selectMun.disabled = false;
    }
}

function cargarGimnasios() {
    const estadoSel = document.getElementById('selectEstado').value;
    const municipioSel = document.getElementById('selectMunicipio').value;
    const selectGim = document.getElementById('selectGimnasio');
    selectGim.innerHTML = '<option value="" disabled selected>Seleccione...</option>';
    if (bdGimnasios[estadoSel] && bdGimnasios[estadoSel][municipioSel]) {
        selectGim.disabled = false;
        bdGimnasios[estadoSel][municipioSel].forEach(gim => {
            let opt = new Option(gim.nombre, gim.nombre);
            opt.dataset.tutor = gim.tutor; 
            selectGim.add(opt);
        });
    }
    selectGim.onchange = function() { document.getElementById('inputTutorRegistro').value = this.options[this.selectedIndex].dataset.tutor || ""; };
}

function togglePilares() {
    if(document.getElementById('selectTipoEspacio').value === "Inmueble gubernamental") toggleSubTipoEspacio();
}

function toggleSubTipoEspacio() {
    const tipo = document.getElementById('selectTipoEspacio').value;
    const estado = document.getElementById('selectEstado').value;
    const divSubTipo = document.getElementById('divSubTipoEspacio');
    const selSubTipo = document.getElementById('selectSubTipoEspacio');
    const divObs = document.getElementById('divObsSubTipo');
    const txtObs = document.getElementById('obs_subtipo');

    selSubTipo.innerHTML = '<option value="" disabled selected>Seleccione...</option>';

    if (tipo === "Propiedad privada") {
        divSubTipo.style.display = "none"; divObs.style.display = "none";
        selSubTipo.required = false; txtObs.required = false;
        selSubTipo.value = ""; txtObs.value = "";
    } else {
        divSubTipo.style.display = "block"; divObs.style.display = "block";
        selSubTipo.required = true; txtObs.required = true;

        if (tipo === "Espacio público") {
            ["Cancha pública", "Parque", "Calle"].forEach(opt => selSubTipo.add(new Option(opt, opt)));
        } else if (tipo === "Inmueble gubernamental") {
            ["Edificio municipal", "Edificio de gobierno", "Comisaría", "Deportivo Gubernamental"].forEach(opt => selSubTipo.add(new Option(opt, opt)));
            if (estado === "CIUDAD DE MÉXICO") selSubTipo.add(new Option("PILARES", "PILARES"));
        }
    }
}

function evaluarDomicilio() {
    const corresponde = document.getElementById('selectCorresponde').value === 'SÍ';
    const bloqueOtros = document.getElementById('campoDireccionOtros');
    bloqueOtros.style.display = corresponde ? 'none' : 'block';
    bloqueOtros.querySelectorAll('input:not([id="dir_int"]):not([type="hidden"]), select').forEach(i => i.required = !corresponde);
    if (corresponde) document.getElementById('inputDireccionOtros').value = "El domicilio registrado correspondía";
    else document.getElementById('inputDireccionOtros').value = "";
}

function inicializarBuscadorDireccion() {
    const selectEdo = document.getElementById('dir_estado');
    if(!selectEdo) return;
    selectEdo.innerHTML = '<option value="" disabled selected>Estado...</option>';
    Object.keys(catEdoMun).sort().forEach(edo => selectEdo.add(new Option(edo, edo)));
}

function cargarMunicipiosDireccion() {
    const edoSel = document.getElementById('dir_estado').value;
    const selectMun = document.getElementById('dir_municipio');
    selectMun.innerHTML = '<option value="" disabled selected>Municipio...</option>';
    if (catEdoMun[edoSel]) catEdoMun[edoSel].sort().forEach(mun => selectMun.add(new Option(mun, mun)));
    concatenarDireccion();
}

function concatenarDireccion() {
    const getV = (id) => document.getElementById(id) ? document.getElementById(id).value.toUpperCase().trim() : "";
    const fullDir = `CALLE: ${getV('dir_calle')} NO.EXT: ${getV('dir_ext')} NO.INT: ${getV('dir_int')} COL: ${getV('dir_colonia')} CP: ${getV('dir_cp')} EDO: ${getV('dir_estado')} MUN: ${getV('dir_municipio')}`;
    const inp = document.getElementById('inputDireccionOtros');
    if(inp) inp.value = fullDir;
}

function actualizarContador(el, min, counterId) {
    const count = el.value.length;
    document.getElementById(counterId).innerText = `${count} / ${min}`;
    el.style.borderColor = count < min ? "red" : "green";
}

function validarNombres() {
    const srv = document.getElementById('nombre_visitante').value.trim().toUpperCase();
    const atn = document.getElementById('nombrePersonaAtiende').value.trim().toUpperCase();
    if (srv !== "" && srv === atn) {
        alert("El Servidor Público visitante y la persona que atiende no pueden ser la misma.");
        document.getElementById('nombrePersonaAtiende').value = "";
    }
}

function toggleCuotaDetalles() {
    const si = document.getElementById('selectCuota').value === "SÍ";
    document.getElementById('divCuotaDetalles').style.display = si ? "block" : "none";
    document.getElementById('selectQuienCuota').required = si;
    document.getElementById('observacionesCuota').required = si;
    if(!si) toggleOtroCuota();
}

function toggleOtroCuota() {
    const esOtro = document.getElementById('selectQuienCuota').value === "Otro";
    document.getElementById('divOtroCuota').style.display = esOtro ? "block" : "none";
    document.getElementById('inputOtroCuota').required = esOtro;
}

function gestionarCargaCodigo() {
    const no = document.getElementById('selectCodigoFirmado').value === 'NO';
    document.getElementById('contenedorDocumentacion').style.display = no ? 'none' : 'flex';
    document.getElementById('fotoCodigoAnverso').required = !no;
    document.getElementById('fotoCodigoReverso').required = !no;
}

// ==========================================
// KILL SWITCHES (Lógica de "Barredora")
// ==========================================
function evaluarKillSwitches() {
    if (archivosEnProceso > 0) return; 

    rehabilitarTodo();
    killReasonGlobal = "";
    
    let killId = null;
    let exceptions = [];

    if (document.getElementById('selectAbierta').value === "NO") {
        killReasonGlobal = "Cuestionario cerrado debido a encontrarse la sucursal cerrada";
        killId = "selectAbierta";
        btnSubmit.innerText = "ENVIAR - SUCURSAL CERRADA";
    } else if (document.getElementById('selectTutorPresente').value === "NO") {
        killReasonGlobal = "Cuestionario cerrado debido a no encontrarse el tutor";
        killId = "selectTutorPresente";
        exceptions = ["nombrePersonaAtiende", "observaciones_generales"];
        btnSubmit.innerText = "ENVIAR - TUTOR AUSENTE";
    } else if (document.getElementById('selectQuiere').value === "NO") {
        killReasonGlobal = "Cuestionario cerrado debido a que el Tutor declara no querer participar";
        killId = "selectQuiere";
        btnSubmit.innerText = "ENVIAR - TUTOR DECLINA";
    } else {
        btnSubmit.innerText = "FINALIZAR REPORTE";
    }

    if (killId) {
        aplicarBarredoraDOM(killId, killReasonGlobal, exceptions);
    }
}

function aplicarBarredoraDOM(triggerId, reason, exceptIDs) {
    const allElements = Array.from(form.querySelectorAll('input:not([type="hidden"]), select, textarea'));
    const triggerIndex = allElements.findIndex(el => el.id === triggerId);
    
    for (let i = triggerIndex + 1; i < allElements.length; i++) {
        const el = allElements[i];
        if (exceptIDs.includes(el.id)) continue; 

        el.required = false;
        const box = el.closest('div[class^="col-"], div.box-validation');
        if(box) box.classList.add('section-disabled');

        if (el.type === "file") {
            urlsArchivosSubidos[el.id] = reason;
        } else if (el.tagName === "SELECT") {
            if (!Array.from(el.options).some(o => o.value === reason)) el.add(new Option(reason, reason));
            el.value = reason;
        } else if (el.type === "checkbox" || el.type === "radio") {
            el.checked = false;
        } else {
            el.value = reason;
        }
    }
}

function rehabilitarTodo() {
    form.querySelectorAll('.section-disabled').forEach(el => el.classList.remove('section-disabled'));
    const allElements = form.querySelectorAll('input:not([type="hidden"]), select, textarea');
    allElements.forEach(el => {
        if (el.value && el.value.startsWith("Cuestionario cerrado")) {
            if (el.tagName === "SELECT") el.value = "";
            else el.value = "";
        }
        if (el.type === "file" && urlsArchivosSubidos[el.id] && urlsArchivosSubidos[el.id].startsWith("Cuestionario cerrado")) {
            delete urlsArchivosSubidos[el.id];
        }
    });
    
    toggleSubTipoEspacio();
    evaluarDomicilio();
    toggleCuotaDetalles();
    gestionarCargaCodigo();
}

// ==========================================
// INDEXED DB (MOTOR DE ALMACENAMIENTO MASIVO)
// ==========================================
const DB_NAME = "BoxeandoDB_v2";
const STORE_NAME = "reportes_pendientes";

function initDB() {
    return new Promise((resolve, reject) => {
        try {
            if (!window.indexedDB) return reject(new Error("IndexedDB no soportado"));
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: "id_local" });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        } catch (err) {
            reject(err);
        }
    });
}

async function guardarEnLocal(datos) {
    datos.id_local = Date.now().toString(); 
    try {
        const db = await initDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(datos);
        tx.oncomplete = () => {
            actualizarContadorCola();
        };
    } catch (error) {
        console.error("Fallo de IndexedDB:", error);
        let cola = JSON.parse(localStorage.getItem('fallback_boxeo') || "[]");
        cola.push(datos);
        localStorage.setItem('fallback_boxeo', JSON.stringify(cola));
        actualizarContadorCola();
    }
}

let isSyncing = false;
async function revisarPendientes() {
    if (!navigator.onLine || isSyncing) return;
    
    try {
        const db = await initDB();
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        
        request.onsuccess = () => {
            const pendientes = request.result;
            if (pendientes.length === 0) {
                actualizarContadorCola();
                return;
            }

            isSyncing = true;
            const itemToSync = pendientes[0];

            server.postData({ action: "submit", data: itemToSync }, 
                async (res) => {
                    if (res.success) {
                        const db2 = await initDB();
                        const tx2 = db2.transaction(STORE_NAME, "readwrite");
                        tx2.objectStore(STORE_NAME).delete(itemToSync.id_local);
                        tx2.oncomplete = () => {
                            isSyncing = false;
                            revisarPendientes(); 
                        };
                    } else {
                        isSyncing = false; 
                    }
                },
                (err) => {
                    isSyncing = false; 
                }
            );
        };
    } catch (e) {
        console.error("Error leyendo IndexedDB", e);
        isSyncing = false;
    }
}

async function actualizarContadorCola() {
    try {
        const db = await initDB();
        const tx = db.transaction(STORE_NAME, "readonly");
        const request = tx.objectStore(STORE_NAME).getAll();
        
        request.onsuccess = () => {
            pendientesCountGlobal = request.result.length;
            let fallback = JSON.parse(localStorage.getItem('fallback_boxeo') || "[]");
            pendientesCountGlobal += fallback.length;
            const badge = document.getElementById('badgeQueue');
            if (pendientesCountGlobal > 0) {
                badge.style.display = 'block';
                document.getElementById('queueCount').innerText = pendientesCountGlobal;
            } else {
                badge.style.display = 'none';
            }
        };
    } catch (e) {
        console.warn("No se pudo actualizar badge", e);
    }
}

// ==========================================
// PREPARACIÓN DE DATOS Y ENVÍO FINAL
// ==========================================
function finalizarYEnviar(formulario) {
    if (archivosEnProceso > 0) return alert("⏳ Aún hay fotos subiéndose. Espera a que terminen.");

    const datosObj = recopilarDatos(formulario);
    datosObj.geo_latitud = geo_lat;
    datosObj.geo_longitud = geo_lon;
    datosObj.geo_precision = geo_acc;

    if (!navigator.onLine) {
        guardarEnLocal(datosObj);
        alert("💾 SIN INTERNET: El reporte y sus fotos se guardaron en la memoria profunda del teléfono. No borres los datos del navegador y sube cuando tengas señal.");
        reiniciarFormularioCompleto();
        return;
    }

    btnSubmit.disabled = true;
    btnSubmit.innerText = "ENVIANDO REPORTE FINAL..."; 
    
    server.postData({ action: "submit", data: datosObj },
        (res) => {
            alert(res.mensaje);
            if(res.success) reiniciarFormularioCompleto();
            else { btnSubmit.disabled = false; guardarEnLocal(datosObj); }
        },
        (err) => {
            alert("⚠️ Se cortó el internet justo al enviar. Guardando copia local...");
            guardarEnLocal(datosObj);
            reiniciarFormularioCompleto();
        }
    ); 
}

function recopilarDatos(formulario) {
    const d = {};
    const fd = new FormData(formulario);
    for (const [key, value] of fd.entries()) {
        if (!(value instanceof File)) d[key] = value;
    }

    if (killReasonGlobal !== "") {
        if (document.getElementById('boxInfra').classList.contains('section-disabled')) d.equipamiento_gimnasio = killReasonGlobal;
        if (document.getElementById('boxDifusion').classList.contains('section-disabled')) d.medios_difusion = killReasonGlobal;
        if (document.getElementById('contenedorMatriz').classList.contains('section-disabled')) d.selectCumpleHorario = killReasonGlobal;
    } else {
        d.equipamiento_gimnasio = Array.from(document.querySelectorAll('.check-equipamiento:checked')).map(c => c.value).join(', ') || "-";
        d.medios_difusion = Array.from(document.querySelectorAll('.check-difusion:checked')).map(c => {
            if(c.id === 'difOtro') return "Otro (" + document.getElementById('inputOtroDifusion').value.trim().toUpperCase() + ")";
            return c.value;
        }).join(', ') || "-";

        const fila = document.getElementById('fila-Lunes_Viernes');
        if (fila) {
            if(fila.querySelector('.form-check-input').checked) {
                d.selectCumpleHorario = "LUNES A VIERNES: NO PUEDE";
            } else {
                const horas = Array.from(fila.querySelectorAll('.select-hora')).map(s => s.value).filter(v => v && v !== "NINGUNO");
                d.selectCumpleHorario = horas.length > 0 ? `LUNES A VIERNES: ${horas.join(", ")}` : "LUNES A VIERNES: S/D";
            }
        }
    }

    for (const key in urlsArchivosSubidos) d["url_" + key] = urlsArchivosSubidos[key];
    
    return d;
}

function reiniciarFormularioCompleto() {
    form.reset();
    form.classList.remove('was-validated');
    form.removeAttribute('data-cdd-bypass');
    urlsArchivosSubidos = {};
    document.querySelectorAll('span[id^="status_"]').forEach(el => el.remove());
    
    ['divSubTipoEspacio', 'divObsSubTipo', 'campoDireccionOtros', 'divCuotaDetalles', 'divOtroCuota', 'divOtroDifusion'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.style.display = 'none';
    });

    rehabilitarTodo();
    new bootstrap.Tab(document.getElementById('btnTab1')).show();
    evaluarKillSwitches(); 
    actualizarContadorCola();
    btnSubmit.disabled = false;
    btnSubmit.innerText = "FINALIZAR REPORTE";
}

form.addEventListener("submit", function(e) {
    e.preventDefault();
    
    const obsSub = document.getElementById('obs_subtipo');
    if (obsSub.required && obsSub.value.length < 20) {
        new bootstrap.Tab(document.getElementById('btnTab1')).show();
        return alert("⚠️ Las observaciones del sub-tipo de espacio deben tener al menos 20 caracteres.");
    }

    const obsGral = document.getElementById('observaciones_generales');
    if (obsGral.required && obsGral.value.length < 50) {
        new bootstrap.Tab(document.getElementById('btnTab2')).show();
        return alert("⚠️ Las observaciones generales deben tener al menos 50 caracteres.");
    }

    if (!form.checkValidity()) {
        form.classList.add('was-validated');
        return alert("⚠️ Falta llenar campos obligatorios.");
    } 

    const cddInput = document.getElementById('fotoComprobante');
    if (cddInput && cddInput.parentElement.style.display !== 'none' && !urlsArchivosSubidos['fotoComprobante'] && !form.dataset.cddBypass) {
        const modalCDD = new bootstrap.Modal(document.getElementById('modalConfirmacionCDD'));
        modalCDD.show();
        document.getElementById('btnConfirmarEnvioSinCDD').onclick = function() {
            modalCDD.hide();
            form.dataset.cddBypass = 'true'; 
            finalizarYEnviar(form); 
        };
        return; 
    }
    
    finalizarYEnviar(form); 
});

window.onbeforeunload = function(e) {
    if (!navigator.onLine) {
        const warningOffline = "ESTÁS SIN SEÑAL. Si recargas o cierras la página, LA APLICACIÓN DESAPARECERÁ y no podrás continuar hasta buscar internet. ¿Seguro que quieres salir?";
        e.returnValue = warningOffline;
        return warningOffline;
    }
    
    if (pendientesCountGlobal > 0) {
        const warningQueue = "Tienes reportes pendientes de envío. Si cierras, se enviarán automáticamente cuando vuelvas a abrir la página con internet. ¿Salir de todas formas?";
        e.returnValue = warningQueue;
        return warningQueue;
    }
};
