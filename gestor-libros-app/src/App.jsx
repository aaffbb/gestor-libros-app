import React, { useEffect, useMemo, useRef, useState } from "react";
// Se carga la librería de escaneo dinámicamente para evitar errores de compilación.
import { X, AlertTriangle, CheckCircle, Plus, BookOpen, Users, Upload, Download, Trash2, Edit, Camera, Zap, ZapOff, Check, Circle, Settings, ChevronsRight, ArrowUp, ArrowDown, Loader } from 'lucide-react';

// ------------------------------------------------------------
// App de aula v2.2.1: Búsqueda automática de títulos por ISBN + Fix ZXing URL
// - FIX: URL de ZXing corregida y con fallback/sanitización para evitar el error de build.
// - Al escanear un libro, busca su título automáticamente usando la Google Books API.
// - Reordena la lista de libros de un curso.
// - Elimina libros, clases y cursos.
// - Crea Cursos y añade libros a cada uno escaneándolos.
// - Crea Clases y asígnalas a un Curso.
// - Añade Alumnos a cada Clase.
// - En Control, selecciona Clase y Alumno para ver su progreso.
// - Diseño optimizado para móviles.
// - Persistencia local (localStorage).
// - NUEVO: Pequeño "Test Runner" embebido para validar utilidades/reducer y la sanitización de la URL.
// ------------------------------------------------------------

// Tipos
/** @typedef {{ id: string, nombre: string, libros: {isbn: string, title: string}[] }} Curso */
/** @typedef {{ id: string, nombre: string, cursoId: string }} Clase */
/** @typedef {{ id: string, nombre: string, claseId: string, librosEntregados: string[] }} Alumno */

const STORAGE_KEY = "aula_libros_clases_v2";

// --- Utilidades ---
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { cursos: [], clases: [], alumnos: [], seleccion: { cursoId: null, claseId: null, alumnoId: null } };
    const parsed = JSON.parse(raw);
    if (!parsed.cursos || !parsed.clases || !parsed.alumnos) {
        return { cursos: [], clases: [], alumnos: [], seleccion: { cursoId: null, claseId: null, alumnoId: null } };
    }
    return parsed;
  } catch (e) {
    console.error("Error cargando estado", e);
    return { cursos: [], clases: [], alumnos: [], seleccion: { cursoId: null, claseId: null, alumnoId: null } };
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.error("Error guardando estado", e);
  }
}

let audioCtx;
function playBeep() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.15);
    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.15);
  } catch(e) {
    console.error("Error al reproducir sonido", e);
  }
}

// --- Utilidades ZXing ---
// URL ESM recomendada (correcta):
const ZXING_ESM_URL = "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/esm/index.js";
// Fallbacks razonables (algunos bundlers agregan "+esm"): 
const ZXING_FALLBACK_URLS = [
  ZXING_ESM_URL,
  "https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm",
  "https://esm.sh/@zxing/browser@0.1.5"
];

// El error reportado se debió a que la URL quedó así:
//   https://cdn.jsdelivr.net/npm/https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/esm/index.js/+esm
// Esta función la sanea y además elimina "+esm" al final si aparece en esa combinación concreta.
function sanitizeCdnUrl(url) {
  if (!url) return ZXING_ESM_URL;
  let out = String(url);
  out = out.replace(
    /https:\/\/cdn\.jsdelivr\.net\/npm\/https:\/\/cdn\.jsdelivr\.net\/npm\//,
    "https://cdn.jsdelivr.net/npm/"
  );
  // Si quedó "/+esm" después del index, lo quitamos (usaremos la variante limpia como primaria)
  out = out.replace(/\/+esm$/, "");
  return out;
}

async function loadZXing() {
  let lastErr = null;
  for (const candidate of ZXING_FALLBACK_URLS) {
    const url = sanitizeCdnUrl(candidate);
    try {
      // Nota: algunos bundlers necesitan la pista para no preprocesar la URL dinámica
      const mod = await import(/* @vite-ignore */ url);
      if (mod?.BrowserMultiFormatReader) return mod;
    } catch (e) {
      lastErr = e;
      // Continúa con el siguiente candidato
    }
  }
  throw lastErr || new Error("No se pudo cargar @zxing/browser desde CDN.");
}

// --- Componente Principal ---
export default function App() {
  const [state, setState] = useState(loadState);
  const [modo, setModo] = useState("control");
  const [msg, setMsg] = useState({ text: "", type: "success" });

  useEffect(() => {
    saveState(state);
    document.body.style.touchAction = 'manipulation';
  }, [state]);

  useEffect(() => {
    if (msg.text) {
      const timer = setTimeout(() => setMsg({ text: "", type: "success" }), 3000);
      return () => clearTimeout(timer);
    }
  }, [msg]);

  function dispatch(action) {
    const newState = reducer(state, action);
    setState(newState);
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 font-sans flex flex-col">
      <header className="bg-white/80 backdrop-blur-lg border-b border-slate-200 w-full">
        <div className="max-w-2xl mx-auto p-4 flex items-center gap-3">
          <BookOpen className="w-7 h-7 text-indigo-600" />
          <span className="text-lg font-bold text-slate-800">Gestor de Libros</span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 w-full flex-grow">
        {modo === "control" && <SeccionControl state={state} dispatch={dispatch} setMsg={setMsg} />}
        {modo === "alumnos" && <SeccionAlumnos state={state} dispatch={dispatch} />}
        {modo === "gestion" && <SeccionGestion state={state} dispatch={dispatch} setMsg={setMsg} />}
      </main>

      <nav className="sticky bottom-0 z-20 bg-white/80 backdrop-blur-lg border-t border-slate-200 w-full">
        <div className="max-w-2xl mx-auto p-2 flex items-center justify-around">
            <TabButton icon={<Camera />} active={modo === "control"} onClick={() => setModo("control")}>Control</TabButton>
            <TabButton icon={<Users />} active={modo === "alumnos"} onClick={() => setModo("alumnos")}>Alumnos</TabButton>
            <TabButton icon={<Settings />} active={modo === "gestion"} onClick={() => setModo("gestion")}>Gestión</TabButton>
        </div>
      </nav>

      {msg.text && (
        <div className={`fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg text-white ${msg.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
          <div className="flex items-center gap-2">
            {msg.type === 'success' ? <CheckCircle size={20}/> : <AlertTriangle size={20}/>}
            <span>{msg.text}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Reducer ---
function reducer(state, action) {
  switch (action.type) {
    // CURSOS
    case 'ADD_CURSO': {
        const nuevo = { id: uid(), nombre: action.payload.trim(), libros: [] };
        return { ...state, cursos: [...state.cursos, nuevo], seleccion: {...state.seleccion, cursoId: nuevo.id} };
    }
    case 'DEL_CURSO': {
        const cursoId = action.payload;
        return {
            ...state,
            cursos: state.cursos.filter(c => c.id !== cursoId),
            seleccion: {...state.seleccion, cursoId: state.seleccion.cursoId === cursoId ? null : state.seleccion.cursoId}
        };
    }
    case 'ADD_LIBRO_A_CURSO': {
        const { cursoId, isbn, title } = action.payload;
        return {
            ...state,
            cursos: state.cursos.map(c => {
                if (c.id !== cursoId) return c;
                if (c.libros.some(l => l.isbn === isbn)) return c; // Evitar duplicados
                return {...c, libros: [...c.libros, { isbn, title: title || `Libro ${isbn}` }]} ;
            })
        };
    }
    case 'DEL_LIBRO_DE_CURSO': {
        const { cursoId, isbn } = action.payload;
        return {
            ...state,
            cursos: state.cursos.map(c => {
                if (c.id !== cursoId) return c;
                return { ...c, libros: c.libros.filter(l => l.isbn !== isbn) };
            })
        };
    }
    case 'REORDER_LIBROS': {
        const { cursoId, isbn, direction } = action.payload;
        return {
            ...state,
            cursos: state.cursos.map(c => {
                if (c.id !== cursoId) return c;

                const index = c.libros.findIndex(l => l.isbn === isbn);
                if (index === -1) return c;

                const newLibros = [...c.libros];

                if (direction === 'up' && index > 0) {
                    [newLibros[index - 1], newLibros[index]] = [newLibros[index], newLibros[index - 1]];
                } else if (direction === 'down' && index < newLibros.length - 1) {
                    [newLibros[index + 1], newLibros[index]] = [newLibros[index], newLibros[index + 1]];
                }

                return { ...c, libros: newLibros };
            })
        };
    }
    // CLASES
    case 'ADD_CLASE': {
        const { cursoId, nombre } = action.payload;
        const nueva = { id: uid(), nombre: nombre.trim(), cursoId };
        return { ...state, clases: [...state.clases, nueva] };
    }
    case 'DEL_CLASE': {
        const claseId = action.payload;
        return {
            ...state,
            clases: state.clases.filter(c => c.id !== claseId),
            seleccion: {...state.seleccion, claseId: state.seleccion.claseId === claseId ? null : state.seleccion.claseId}
        };
    }
    // ALUMNOS
    case 'ADD_ALUMNO': {
      const { claseId, nombre } = action.payload;
      const nuevo = { id: uid(), nombre: nombre.trim(), claseId, librosEntregados: [] };
      return { ...state, alumnos: [...state.alumnos, nuevo], seleccion: {...state.seleccion, alumnoId: nuevo.id} };
    }
    case 'DEL_ALUMNO': {
      return {
        ...state,
        alumnos: state.alumnos.filter((a) => a.id !== action.payload),
        seleccion: {...state.seleccion, alumnoId: state.seleccion.alumnoId === action.payload ? null : state.seleccion.alumnoId},
      };
    }
    // SELECCION
    case 'SELECT_CURSO': return {...state, seleccion: { ...state.seleccion, cursoId: action.payload, claseId: null, alumnoId: null }};
    case 'SELECT_CLASE': return {...state, seleccion: { ...state.seleccion, claseId: action.payload, alumnoId: null }};
    case 'SELECT_ALUMNO': return {...state, seleccion: { ...state.seleccion, alumnoId: action.payload }};
    // LIBROS ENTREGADOS
    case 'MARCAR_LIBRO': {
      const { alumnoId, barcode } = action.payload;
      return {
        ...state,
        alumnos: state.alumnos.map((a) => {
          if (a.id !== alumnoId) return a;
          if (a.librosEntregados.includes(barcode)) return a;
          return { ...a, librosEntregados: [...a.librosEntregados, barcode] };
        }),
      };
    }
    case 'DESMARCAR_LIBRO': {
      const { alumnoId, barcode } = action.payload;
      return {
        ...state,
        alumnos: state.alumnos.map((a) =>
          a.id === alumnoId ? { ...a, librosEntregados: a.librosEntregados.filter((b) => b !== barcode) } : a
        ),
      };
    }
    // DATOS
    case 'IMPORT_STATE': return action.payload;
    case 'RESET_STATE': return { cursos: [], clases: [], alumnos: [], seleccion: { cursoId: null, claseId: null, alumnoId: null } };
    default: return state;
  }
}


// --- Componentes de Secciones ---

function SeccionControl({ state, dispatch, setMsg }) {
  const [scanActivo, setScanActivo] = useState(false);

  const claseSel = useMemo(() => state.clases.find(c => c.id === state.seleccion.claseId), [state.clases, state.seleccion.claseId]);
  const alumnosEnClase = useMemo(() => state.alumnos.filter(a => a.claseId === state.seleccion.claseId), [state.alumnos, state.seleccion.claseId]);
  const alumnoSel = useMemo(() => alumnosEnClase.find(a => a.id === state.seleccion.alumnoId), [alumnosEnClase, state.seleccion.alumnoId]);
  const cursoDeClase = useMemo(() => state.cursos.find(c => c.id === claseSel?.cursoId), [state.cursos, claseSel]);

  function handleScan(barcode) {
    if (!alumnoSel || !cursoDeClase) return;

    const libroRequerido = cursoDeClase.libros.find(l => l.isbn === barcode);

    if (libroRequerido) {
        dispatch({ type: 'MARCAR_LIBRO', payload: { alumnoId: alumnoSel.id, barcode } });
        setMsg({ text: `"${libroRequerido.title}" marcado.`, type: 'success' });
    } else {
        setMsg({ text: 'Libro no encontrado en la lista del curso.', type: 'error' });
    }
  }

  return (
    <div className="grid gap-6">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 grid gap-4">
            <div>
                <label className="text-sm font-medium text-slate-600">1. Selecciona una clase</label>
                <select
                    className="w-full rounded-lg border border-slate-300 p-3 bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none text-base mt-1"
                    value={state.seleccion.claseId || ""}
                    onChange={(e) => dispatch({ type: 'SELECT_CLASE', payload: e.target.value || null })}
                >
                    <option value="">— Elige una clase —</option>
                    {state.clases.map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                </select>
            </div>
            {claseSel && (
                <div>
                    <label className="text-sm font-medium text-slate-600">2. Selecciona un alumno</label>
                    <select
                        className="w-full rounded-lg border border-slate-300 p-3 bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none text-base mt-1"
                        value={state.seleccion.alumnoId || ""}
                        onChange={(e) => dispatch({ type: 'SELECT_ALUMNO', payload: e.target.value || null })}
                    >
                        <option value="">— Elige un alumno —</option>
                        {alumnosEnClase.map((a) => (
                        <option key={a.id} value={a.id}>{a.nombre}</option>
                        ))}
                    </select>
                </div>
            )}
        </div>

      {alumnoSel && cursoDeClase ? (
        <>
          <button
              className="w-full justify-center text-base font-semibold flex items-center gap-2 rounded-lg px-4 py-3 bg-indigo-600 text-white hover:bg-indigo-700 active:bg-indigo-800"
              onClick={() => setScanActivo(true)}
            >
              <Camera size={20}/> Escanear libros de {alumnoSel.nombre}
            </button>

          <div className="mt-2">
            <h3 className="font-semibold text-lg mb-2">Lista de Libros ({cursoDeClase.nombre})</h3>
            <ListaControlLibros
              alumnoSel={alumnoSel}
              curso={cursoDeClase}
              dispatch={dispatch}
            />
          </div>
        </>
      ) : (
        <div className="p-6 text-center text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
          {claseSel ? 'Selecciona un alumno para ver su progreso.' : 'Selecciona una clase para empezar.'}
        </div>
      )}
      {scanActivo && <Escaner
        onDetect={handleScan}
        setMsg={setMsg}
        setActivo={setScanActivo}
      />}
    </div>
  );
}

function ListaControlLibros({ alumnoSel, curso, dispatch }) {
  if (!alumnoSel || !curso) return null;

  return (
    <div className="grid gap-3">
      {curso.libros.map((libro) => {
        const entregado = alumnoSel.librosEntregados.includes(libro.isbn);
        return (
            <div key={libro.isbn} className={`flex items-center gap-3 rounded-lg border p-3 transition-all ${entregado ? 'bg-green-50 border-green-200' : 'bg-white border-slate-200'}`}>
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${entregado ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-500'}`}>
                    {entregado ? <Check size={20}/> : <Circle size={20}/>}
                </div>
                <div className="flex-1">
                    <p className="font-medium text-slate-800">{libro.title}</p>
                    <p className="text-xs text-slate-500 font-mono">{libro.isbn}</p>
                </div>
                {entregado && (
                    <button 
                        onClick={() => dispatch({type: 'DESMARCAR_LIBRO', payload: {alumnoId: alumnoSel.id, barcode: libro.isbn}})} 
                        className="p-2 rounded-md hover:bg-red-100 text-red-500"
                    >
                        <X size={16}/>
                    </button>
                )}
            </div>
        )
      })}
    </div>
  );
}

function SeccionAlumnos({ state, dispatch }) {
  const [nuevo, setNuevo] = useState("");
  const [claseSeleccionada, setClaseSeleccionada] = useState(state.clases[0]?.id || null);

  const alumnosEnClase = useMemo(() => 
    state.alumnos.filter(a => a.claseId === claseSeleccionada),
  [state.alumnos, claseSeleccionada]);

  return (
    <div className="grid gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <h3 className="font-semibold mb-2">Selecciona una clase</h3>
            <select
                className="w-full rounded-lg border border-slate-300 p-3 bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none text-base"
                value={claseSeleccionada || ""}
                onChange={(e) => setClaseSeleccionada(e.target.value)}
            >
                <option value="">— Elige una clase —</option>
                {state.clases.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
            </select>
        </div>

      {claseSeleccionada && (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <h3 className="font-semibold mb-2">Añadir alumno a {state.clases.find(c => c.id === claseSeleccionada)?.nombre}</h3>
            <div className="flex gap-2">
                <input
                    className="flex-1 rounded-lg border border-slate-300 p-3 text-base"
                    placeholder="Nombre del alumno"
                    value={nuevo}
                    onChange={(e) => setNuevo(e.target.value)}
                    onKeyDown={(e) => {
                    if (e.key === "Enter" && nuevo.trim()) {
                        dispatch({type: 'ADD_ALUMNO', payload: {nombre: nuevo, claseId: claseSeleccionada}});
                        setNuevo("");
                    }
                    }}
                />
                <button
                    className="flex items-center gap-2 px-4 py-3 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700"
                    onClick={() => {
                    if (!nuevo.trim()) return;
                    dispatch({type: 'ADD_ALUMNO', payload: {nombre: nuevo, claseId: claseSeleccionada}});
                    setNuevo("");
                    }}
                >
                    <Plus size={20}/>
                </button>
            </div>
        </div>
      )}

      <div className="grid gap-2">
        {alumnosEnClase.map((a) => (
          <div key={a.id} className="flex items-center gap-3 bg-white rounded-lg border p-3 border-slate-200">
            <div className="flex-1">
              <div className="font-medium">{a.nombre}</div>
            </div>
            <button onClick={() => dispatch({type: 'DEL_ALUMNO', payload: a.id})} className="p-2 rounded-md hover:bg-red-100 text-red-600"><Trash2 size={18}/></button>
          </div>
        ))}
      </div>
    </div>
  );
}

async function buscarLibroPorISBN(isbn) {
  try {
    const response = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    if (!response.ok) {
      throw new Error('La respuesta de la red no fue correcta');
    }
    const data = await response.json();
    if (data.totalItems > 0 && data.items[0].volumeInfo.title) {
      return data.items[0].volumeInfo.title;
    }
    return null;
  } catch (error) {
    console.error("Error al buscar libro:", error);
    return null;
  }
}

function SeccionGestion({ state, dispatch, setMsg }) {
    const [scanActivo, setScanActivo] = useState(false);
    const [isBuscando, setIsBuscando] = useState(false);
    const [modal, setModal] = useState({ type: null, data: null });

    const cursoSel = useMemo(() => state.cursos.find(c => c.id === state.seleccion.cursoId), [state.cursos, state.seleccion.cursoId]);
    const clasesEnCurso = useMemo(() => state.clases.filter(c => c.id && c.cursoId === state.seleccion.cursoId), [state.clases, state.seleccion.cursoId]);

    async function handleScan(barcode) {
        if (!cursoSel) return;
        setIsBuscando(true);
        const tituloEncontrado = await buscarLibroPorISBN(barcode);
        setIsBuscando(false);

        if (tituloEncontrado) {
            dispatch({type: 'ADD_LIBRO_A_CURSO', payload: {cursoId: cursoSel.id, isbn: barcode, title: tituloEncontrado}});
            setMsg({text: `Libro "${tituloEncontrado}" añadido.`, type: 'success'});
        } else {
            setModal({ type: 'addLibroManualmente', data: { barcode } });
        }
    }
    
    function confirmarBorradoCurso(curso) {
        const isUsed = state.clases.some(c => c.cursoId === curso.id);
        if (isUsed) {
            setMsg({text: 'No se puede borrar un curso que está en uso por una clase.', type: 'error'});
        } else {
            dispatch({type: 'DEL_CURSO', payload: curso.id});
        }
        setModal({type: null});
    }

    function confirmarBorradoClase(clase) {
        const isUsed = state.alumnos.some(a => a.claseId === clase.id);
        if (isUsed) {
            setMsg({text: 'No se puede borrar una clase con alumnos. Mueve o elimina los alumnos primero.', type: 'error'});
        } else {
            dispatch({type: 'DEL_CLASE', payload: clase.id});
        }
        setModal({type: null});
    }

    return (
        <div className="grid gap-6">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="font-semibold text-lg">Cursos</h3>
                    <button onClick={() => setModal({type: 'addCurso'})} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">
                        <Plus size={16}/> Nuevo Curso
                    </button>
                </div>
                <div className="grid gap-2">
                    {state.cursos.map(c => (
                        <div key={c.id} className={`flex items-center gap-2 p-3 rounded-lg border ${state.seleccion.cursoId === c.id ? 'bg-indigo-50 border-indigo-300' : 'bg-white'}`}>
                           <div onClick={() => dispatch({type: 'SELECT_CURSO', payload: c.id})} className="flex-1 flex items-center gap-2 cursor-pointer">
                                <span className="font-medium">{c.nombre}</span>
                                <span className="text-xs bg-slate-200 text-slate-600 font-semibold px-2 py-1 rounded-full">{c.libros.length} libros</span>
                           </div>
                           <button onClick={() => setModal({type: 'delCurso', data: c})} className="p-2 text-red-500 hover:bg-red-100 rounded-md"><Trash2 size={16}/></button>
                           <ChevronsRight size={20} className="text-slate-400 cursor-pointer" onClick={() => dispatch({type: 'SELECT_CURSO', payload: c.id})}/>
                        </div>
                    ))}
                </div>
            </div>

            {cursoSel && (
                <>
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                         <div className="flex justify-between items-center mb-2">
                            <h3 className="font-semibold text-lg">Libros de {cursoSel.nombre}</h3>
                            <button onClick={() => setScanActivo(true)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700">
                                <Camera size={16}/> Añadir con escáner
                            </button>
                        </div>
                        {isBuscando && (
                            <div className="flex items-center justify-center gap-2 p-4 text-slate-500">
                                <Loader className="animate-spin"/>
                                <span>Buscando libro...</span>
                            </div>
                        )}
                        <div className="grid gap-2">
                            {cursoSel.libros.map((l, index) => (
                                <div key={l.isbn} className="flex items-center gap-2 p-2 border-b border-slate-100">
                                    <div className="flex-1">
                                        <p className="font-medium text-sm">{l.title}</p>
                                        <p className="text-xs text-slate-500 font-mono">{l.isbn}</p>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            disabled={index === 0}
                                            onClick={() => dispatch({type: 'REORDER_LIBROS', payload: {cursoId: cursoSel.id, isbn: l.isbn, direction: 'up'}})}
                                            className="p-2 text-slate-500 hover:bg-slate-100 rounded-md disabled:opacity-30 disabled:cursor-not-allowed"
                                        >
                                            <ArrowUp size={16}/>
                                        </button>
                                        <button
                                            disabled={index === cursoSel.libros.length - 1}
                                            onClick={() => dispatch({type: 'REORDER_LIBROS', payload: {cursoId: cursoSel.id, isbn: l.isbn, direction: 'down'}})}
                                            className="p-2 text-slate-500 hover:bg-slate-100 rounded-md disabled:opacity-30 disabled:cursor-not-allowed"
                                        >
                                            <ArrowDown size={16}/>
                                        </button>
                                        <button
                                            onClick={() => dispatch({type: 'DEL_LIBRO_DE_CURSO', payload: {cursoId: cursoSel.id, isbn: l.isbn}})}
                                            className="p-2 text-red-500 hover:bg-red-100 rounded-md"
                                        >
                                            <Trash2 size={16}/>
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {cursoSel.libros.length === 0 && !isBuscando && <p className="text-sm text-slate-500 text-center p-4">No hay libros en este curso. ¡Añade uno!</p>}
                        </div>
                    </div>
                     <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                         <div className="flex justify-between items-center mb-2">
                            <h3 className="font-semibold text-lg">Clases con este curso</h3>
                             <button onClick={() => setModal({type: 'addClase', data: cursoSel.id})} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">
                                <Plus size={16}/> Nueva Clase
                            </button>
                        </div>
                        <div className="grid gap-2">
                            {clasesEnCurso.map(c => (
                                <div key={c.id} className="flex items-center gap-2 p-2 bg-slate-50 rounded-md">
                                    <p className="flex-1 font-medium text-sm">{c.nombre}</p>
                                    <button onClick={() => setModal({type: 'delClase', data: c})} className="p-2 text-red-500 hover:bg-red-100 rounded-md"><Trash2 size={16}/></button>
                                </div>
                            ))}
                             {clasesEnCurso.length === 0 && <p className="text-sm text-slate-500 text-center p-4">No hay clases asignadas a este curso.</p>}
                        </div>
                    </div>
                </>
            )}
            
            <SeccionExportar state={state} dispatch={dispatch} setMsg={setMsg} />
            <SeccionPruebas />

            {scanActivo && <Escaner onDetect={handleScan} setMsg={setMsg} setActivo={setScanActivo} />}
            {modal.type === 'addCurso' && <ModalInput
                titulo="Crear Nuevo Curso"
                mensaje="Dale un nombre al nuevo curso (ej: Libros 1º ESO)."
                onConfirm={(nombre) => {
                    if (nombre) dispatch({type: 'ADD_CURSO', payload: nombre});
                    setModal({type: null});
                }}
                onCancel={() => setModal({type: null})}
            />}
             {modal.type === 'addClase' && <ModalInput
                titulo="Crear Nueva Clase"
                mensaje={`Dale un nombre a la nueva clase para el curso "${cursoSel?.nombre}" (ej: 1º A).`}
                onConfirm={(nombre) => {
                    if (nombre) dispatch({type: 'ADD_CLASE', payload: {nombre, cursoId: modal.data}});
                    setModal({type: null});
                }}
                onCancel={() => setModal({type: null})}
            />}
            {modal.type === 'addLibroManualmente' && <ModalInput
                titulo="Añadir Libro Manualmente"
                mensaje={`No se encontró título para ${modal.data.barcode}. Introduce el título.`}
                valorInicial={`Libro ${modal.data.barcode}`}
                onConfirm={(titulo) => {
                    if (titulo) {
                        dispatch({type: 'ADD_LIBRO_A_CURSO', payload: {cursoId: cursoSel.id, isbn: modal.data.barcode, title: titulo}});
                    }
                    setModal({type: null});
                }}
                onCancel={() => setModal({type: null})}
            />}
            {modal.type === 'delCurso' && <ModalConfirm
                titulo="Eliminar Curso"
                mensaje={`¿Estás seguro de que quieres eliminar el curso "${modal.data.nombre}"? No se puede deshacer.`}
                onConfirm={() => confirmarBorradoCurso(modal.data)}
                onCancel={() => setModal({type: null})}
            />}
            {modal.type === 'delClase' && <ModalConfirm
                titulo="Eliminar Clase"
                mensaje={`¿Estás seguro de que quieres eliminar la clase "${modal.data.nombre}"? No se puede deshacer.`}
                onConfirm={() => confirmarBorradoClase(modal.data)}
                onCancel={() => setModal({type: null})}
            />}
        </div>
    );
}

function SeccionExportar({ state, dispatch, setMsg }) {
  const fileInputRef = useRef(null);

  function exportar(formato) {
    const hoy = new Date().toISOString().slice(0, 10);
    let blob, filename;

    if (formato === 'json') {
      blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      filename = `libros_alumnos_${hoy}.json`;
    } else {
      const filas = [["alumno_nombre", "clase_nombre", "curso_nombre", "libro_isbn", "libro_titulo", "entregado"]];
      state.alumnos.forEach(a => {
        const clase = state.clases.find(c => c.id === a.claseId);
        const curso = state.cursos.find(c => c.id === clase?.cursoId);
        if (clase && curso) {
            curso.libros.forEach(l => {
              const entregado = a.librosEntregados.includes(l.isbn) ? '1' : '0';
              filas.push([a.nombre, clase.nombre, curso.nombre, l.isbn, l.title, entregado]);
            });
        }
      });
      const csv = filas.map(f => f.map(s => `"${String(s).replace(/"/g, '""')}"`).join(",")).join("\n");
      blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      filename = `libros_alumnos_${hoy}.csv`;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importarJSON(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (!parsed || !parsed.cursos || !parsed.clases || !parsed.alumnos) throw new Error("Formato no válido.");
        dispatch({type: 'IMPORT_STATE', payload: parsed});
        setMsg({text: "Datos importados correctamente.", type: 'success'});
      } catch (err) {
        setMsg({text: `Error al importar: ${err.message}`, type: 'error'});
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div className="grid gap-4">
      <div className="p-4 bg-white rounded-xl shadow-sm border border-slate-200">
        <h3 className="font-semibold mb-2">Importar y Exportar</h3>
        <div className="flex gap-2 flex-wrap">
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 text-white hover:bg-slate-900 text-sm" onClick={() => exportar('json')}>
            <Download size={16}/> Exportar JSON
          </button>
          <input type="file" accept=".json" onChange={importarJSON} className="hidden" ref={fileInputRef} />
          <button className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-100 text-sm" onClick={() => fileInputRef.current?.click()}>
            <Upload size={16}/> Importar JSON
          </button>
        </div>
      </div>
      <div className="p-4 bg-white rounded-xl border border-red-200">
        <h3 className="font-semibold mb-2 text-red-700">Zona Peligrosa</h3>
        <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 text-sm" onClick={() => dispatch({type: 'RESET_STATE'})}>
            <AlertTriangle size={16}/> Borrar todos los datos
        </button>
      </div>
    </div>
  );
}

function SeccionPruebas() {
  const [resultados, setResultados] = useState([]);
  const [running, setRunning] = useState(false);

  function assert(name, condition) {
    return { name, pass: !!condition };
  }

  function ejecutarPruebas() {
    setRunning(true);
    const casos = [];

    // 1) Sanitización de URL duplicada + /+esm
    const malformed = "https://cdn.jsdelivr.net/npm/https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/esm/index.js/+esm";
    casos.push(assert("Sanitiza URL ZXing duplicada", sanitizeCdnUrl(malformed) === ZXING_ESM_URL));

    // 2) Sanitización no altera la correcta
    casos.push(assert("URL correcta permanece igual", sanitizeCdnUrl(ZXING_ESM_URL) === ZXING_ESM_URL));

    // 3) Reducer: añadir curso -> clase -> libro -> alumno -> marcar libro
    const base = { cursos: [], clases: [], alumnos: [], seleccion: { cursoId: null, claseId: null, alumnoId: null } };
    let s = reducer(base, { type: 'ADD_CURSO', payload: 'Prueba Curso' });
    const cursoId = s.seleccion.cursoId;
    s = reducer(s, { type: 'ADD_CLASE', payload: { nombre: '1ºA', cursoId } });
    const claseId = s.clases[0].id;
    s = reducer(s, { type: 'ADD_LIBRO_A_CURSO', payload: { cursoId, isbn: '9788499890944', title: 'El Quijote' } });
    s = reducer(s, { type: 'ADD_ALUMNO', payload: { nombre: 'Ana', claseId } });
    const alumnoId = s.seleccion.alumnoId;
    s = reducer(s, { type: 'MARCAR_LIBRO', payload: { alumnoId, barcode: '9788499890944' } });
    const alumno = s.alumnos.find(a => a.id === alumnoId);
    casos.push(assert("MARCAR_LIBRO añade el ISBN a entregados", alumno?.librosEntregados.includes('9788499890944')));

    setResultados(casos);
    setRunning(false);
  }

  const passed = resultados.filter(r => r.pass).length;

  return (
    <div className="p-4 bg-white rounded-xl shadow-sm border border-slate-200">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">Pruebas internas</h3>
        <button disabled={running} onClick={ejecutarPruebas} className="px-3 py-1.5 rounded-lg text-sm bg-slate-900 text-white disabled:opacity-50">
          {running ? 'Ejecutando…' : 'Ejecutar pruebas'}
        </button>
      </div>
      {resultados.length > 0 && (
        <div className="text-sm">
          <p className="mb-2">{passed}/{resultados.length} pruebas OK</p>
          <ul className="space-y-1">
            {resultados.map((r, i) => (
              <li key={i} className={r.pass ? 'text-green-700' : 'text-red-700'}>
                {r.pass ? '✓' : '✗'} {r.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// --- Componentes UI reutilizables ---

function TabButton({ icon, children, active, ...props }) {
  return (
    <button
      className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors w-24 ${
        active
          ? "text-indigo-600"
          : "text-slate-500 hover:bg-slate-100"
      }`}
      {...props}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function ModalConfirm({titulo, mensaje, onConfirm, onCancel}) {
    return (
        <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
                <h3 className="text-lg font-bold text-slate-800">{titulo}</h3>
                <p className="text-sm text-slate-600 mt-2">{mensaje}</p>
                <div className="flex justify-end gap-2 mt-6">
                    <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm border border-slate-300 hover:bg-slate-100">Cancelar</button>
                    <button onClick={onConfirm} className="px-4 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700">Confirmar</button>
                </div>
            </div>
        </div>
    )
}

function ModalInput({titulo, mensaje, valorInicial = "", onConfirm, onCancel}) {
    const [valor, setValor] = useState(valorInicial);
    const inputRef = useRef(null);

    useEffect(() => {
        inputRef.current?.focus();
    }, [])

    function handleConfirm() {
        onConfirm(valor.trim());
    }

    return (
        <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
                <h3 className="text-lg font-bold text-slate-800">{titulo}</h3>
                <p className="text-sm text-slate-600 mt-2 mb-4">{mensaje}</p>
                <input
                    ref={inputRef}
                    value={valor}
                    onChange={e => setValor(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleConfirm()}
                    className="w-full rounded-lg border border-slate-300 p-3 text-base"
                />
                <div className="flex justify-end gap-2 mt-6">
                    <button onClick={onCancel} className="px-4 py-2 rounded-lg text-sm border border-slate-300 hover:bg-slate-100">Cancelar</button>
                    <button onClick={handleConfirm} className="px-4 py-2 rounded-lg text-sm bg-indigo-600 text-white hover:bg-indigo-700">Aceptar</button>
                </div>
            </div>
        </div>
    )
}

function Escaner({ setActivo, onDetect, setMsg }) {
  const videoRef = useRef(null);
  const codeReaderRef = useRef(null);
  const [flash, setFlash] = useState(false);
  const ultimoLeidoRef = useRef({ code: "", ts: 0 });

  async function iniciar() {
    try {
      if (!codeReaderRef.current) {
        // Carga robusta con sanitización y fallbacks
        const mod = await loadZXing();
        const { BrowserMultiFormatReader } = mod;
        codeReaderRef.current = new BrowserMultiFormatReader();
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      videoRef.current.srcObject = stream;
      
      codeReaderRef.current.decodeFromStream(stream, videoRef.current, (result, err) => {
        if (result) {
          const code = result.getText();
          const now = Date.now();
          if (code && (code !== ultimoLeidoRef.current.code || now - ultimoLeidoRef.current.ts > 2500)) {
            playBeep();
            ultimoLeidoRef.current = { code, ts: now };
            onDetect(code);
          }
        }
      });
    } catch (e) {
      console.error(e);
      setMsg({ text: "Error de cámara o de carga de ZXing. Revisa los permisos.", type: 'error' });
      detener();
    }
  }

  function detener() {
    try {
      codeReaderRef.current?.reset();
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(track => track.stop());
      }
    } catch {}
    setActivo(false);
  }

  useEffect(() => {
    iniciar();
    return () => detener();
  }, []);

  async function toggleFlash() {
      if (!videoRef.current?.srcObject) return;
      const stream = videoRef.current.srcObject;
      const track = stream.getVideoTracks()[0];
      try {
          await track.applyConstraints({ advanced: [{ torch: !flash }] });
          setFlash(f => !f);
      } catch (e) {
          setMsg({text: "La linterna no está disponible.", type: 'error'});
      }
  }

  return (
    <div className="fixed inset-0 bg-black z-30 flex flex-col">
        <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div className="w-3/4 max-w-sm h-1/4 border-4 border-dashed border-emerald-400/70 rounded-2xl" />
        </div>
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-black/50 backdrop-blur-sm">
            <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
                <button onClick={toggleFlash} className="p-3 rounded-full bg-white/20 text-white">
                    {flash ? <ZapOff size={24} /> : <Zap size={24} />}
                </button>
                <button onClick={detener} className="px-6 py-3 rounded-full bg-red-600 text-white font-semibold">
                    Cerrar
                </button>
            </div>
        </div>
    </div>
  );
}
