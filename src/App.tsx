import React, { useState, useEffect, useCallback } from 'react';
import { signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import {
  WifiOff,
  ShieldAlert,
  LogOut,
  RefreshCw,
  Boxes,
  Factory,
  ArrowRightLeft,
  FileSpreadsheet,
  Lock,
  UserCheck,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { auth, googleAuthProvider } from './lib/firebase.ts';
import {
  WorkspaceData,
  formatInt,
  translateRole,
  formatBoliviaDateTime,
} from './types.ts';
import { CatalogAndStockView } from './components/CatalogAndStockView.tsx';
import { ProductionAndPickupView } from './components/ProductionAndPickupView.tsx';
import { OperationsAuditAndPrivateView } from './components/OperationsAuditAndPrivateView.tsx';

export default function App() {
  // Authentication token stored strictly in React memory (never localStorage)
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [simulatedUserId, setSimulatedUserId] = useState<number | null>(null);
  const [availableProfiles, setAvailableProfiles] = useState<
    { id: number; username: string; fullName: string; role: string }[]
  >([]);

  // Login Form State
  const [loginUsername, setLoginUsername] = useState('propietario');
  const [loginPassword, setLoginPassword] = useState('operacion2026');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Strict Online-Only State & Simulated Network Cut Toggle
  const [browserOnline, setBrowserOnline] = useState<boolean>(navigator.onLine);
  const [simulateOfflineCut, setSimulateOfflineCut] = useState<boolean>(false);
  const isOnline = browserOnline && !simulateOfflineCut;

  // Workspace Data State
  const [workspaceData, setWorkspaceData] = useState<WorkspaceData | null>(null);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  // Primary Navigation Section
  const [activeNav, setActiveNav] = useState<
    | 'INVENTARIO_CATALOGO'
    | 'PRODUCCION_RECOGIDA'
    | 'TRASLADOS_CONTEOS'
    | 'KARDEX_REPORTES'
    | 'ZONA_PRIVADA'
  >('INVENTARIO_CATALOGO');

  useEffect(() => {
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const apiFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      if (!isOnline && options.method && options.method !== 'GET') {
        throw new Error(
          'Sin conexión a Internet: Operación bloqueada. Ningún movimiento se guarda localmente ni en cola offline.'
        );
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      };
      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }
      if (simulatedUserId) {
        headers['x-simulate-user-id'] = String(simulatedUserId);
      }

      const response = await fetch(url, {
        ...options,
        headers,
      });

      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const err: any = new Error(json.error || `Error del servidor (${response.status})`);
        Object.assign(err, json);
        throw err;
      }
      return json;
    },
    [authToken, simulatedUserId, isOnline]
  );

  const loadWorkspace = useCallback(async () => {
    if (!authToken) return;
    setLoadingWorkspace(true);
    setWorkspaceError(null);
    try {
      const [meRes, wsRes] = await Promise.all([
        apiFetch('/api/auth/me'),
        apiFetch('/api/workspace'),
      ]);
      setAvailableProfiles(meRes.availableTestProfiles || []);
      setWorkspaceData(wsRes);

      // First-load auto-verification if balances are empty so the user immediately sees Cases A-H ready
      if (wsRes.balances.length === 0 && (wsRes.user.role === 'OWNER' || wsRes.user.role === 'ADMIN')) {
        await apiFetch('/api/Verification/run-suite', { method: 'POST' });
        const refreshed = await apiFetch('/api/workspace');
        setWorkspaceData(refreshed);
      }
    } catch (err: any) {
      setWorkspaceError(err.message);
    } finally {
      setLoadingWorkspace(false);
    }
  }, [authToken, apiFetch]);

  useEffect(() => {
    if (authToken) {
      loadWorkspace();
    }
  }, [authToken, simulatedUserId, loadWorkspace]);

  const handleLocalLogin = async (e?: React.FormEvent, presetUser?: string) => {
    if (e) e.preventDefault();
    if (!isOnline) {
      setLoginError('Sin conexión a Internet: no es posible iniciar sesión.');
      return;
    }
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: presetUser || loginUsername,
          password: loginPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error de autenticación');
      }
      setSimulatedUserId(null);
      setAuthToken(data.token);
    } catch (err: any) {
      setLoginError(err.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (!isOnline) {
      setLoginError('Sin conexión a Internet: no es posible iniciar sesión con Google.');
      return;
    }
    setLoginLoading(true);
    setLoginError(null);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      setSimulatedUserId(null);
      setAuthToken(idToken);
    } catch (err: any) {
      setLoginError(
        err.message || 'No se pudo completar el inicio de sesión con Google.'
      );
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await firebaseSignOut(auth).catch(() => {});
    } finally {
      setAuthToken(null);
      setWorkspaceData(null);
      setSimulatedUserId(null);
    }
  };

  // =========================================================================
  // LOGIN VIEW (When no session is active)
  // =========================================================================
  if (!authToken) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
        {!isOnline && (
          <div className="mb-4 max-w-md w-full bg-red-600 text-white p-3.5 rounded-lg flex items-center gap-3 text-xs font-medium">
            <WifiOff className="w-5 h-5 shrink-0" />
            <span>
              Sin conexión: operaciones deshabilitadas. Esta aplicación requiere conexión en línea
              con el servidor central.
            </span>
          </div>
        )}

        <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-7 space-y-6">
          <div>
            <div className="text-xs font-mono font-semibold text-sky-700">
              SISTEMA TRANSACCIONAL CENTRALIZADO (100% EN LÍNEA)
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mt-1">
              ControlStock Pro
            </h1>
            <p className="text-xs text-slate-600 mt-1">
              Gestión de Insumos Tecnológicos, Almacenes (Sencata, Villa Dolores, Puente Bolivia),
              Recetas de Ensamblaje (BOM) y Órdenes de Producción.
            </p>
          </div>

          {loginError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800">
              {loginError}
            </div>
          )}

          {/* Local Username & Password Form */}
          <form onSubmit={(e) => handleLocalLogin(e)} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Usuario Individual
              </label>
              <input
                type="text"
                value={loginUsername}
                onChange={(e) => setLoginUsername(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-2"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Contraseña
              </label>
              <input
                type="password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-2"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loginLoading || !isOnline}
              className="w-full py-2.5 px-4 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors"
            >
              {loginLoading ? 'Verificando en servidor...' : 'Iniciar Sesión Operativa'}
            </button>
          </form>

          {/* Google Sign-In for Owner */}
          <div className="pt-4 border-t border-slate-200 space-y-3">
            <button
              type="button"
              disabled={loginLoading || !isOnline}
              onClick={handleGoogleLogin}
              className="w-full py-2.5 px-4 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
            >
              Iniciar Sesión con Google (Propietario / Superadmin)
            </button>
          </div>

          {/* Quick Test Role Access Strip */}
          <div className="pt-4 border-t border-slate-200 space-y-2">
            <div className="text-[11px] font-semibold text-slate-600">
              Acceso rápido para pruebas de permisos por rol y almacén (Clave: operacion2026):
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleLocalLogin(undefined, 'propietario')}
                className="px-2.5 py-1.5 text-left text-[11px] bg-slate-100 hover:bg-slate-200 rounded font-medium text-slate-800"
              >
                1. Propietario (Global + Costos)
              </button>
              <button
                type="button"
                onClick={() => handleLocalLogin(undefined, 'almacen_sencata')}
                className="px-2.5 py-1.5 text-left text-[11px] bg-slate-100 hover:bg-slate-200 rounded font-medium text-slate-800"
              >
                2. Encargado Solo Sencata
              </button>
              <button
                type="button"
                onClick={() => handleLocalLogin(undefined, 'prod_villadolores')}
                className="px-2.5 py-1.5 text-left text-[11px] bg-slate-100 hover:bg-slate-200 rounded font-medium text-slate-800"
              >
                3. Producción Villa Dolores
              </button>
              <button
                type="button"
                onClick={() => handleLocalLogin(undefined, 'auditor_puente')}
                className="px-2.5 py-1.5 text-left text-[11px] bg-slate-100 hover:bg-slate-200 rounded font-medium text-slate-800"
              >
                4. Receptor Puente Bolivia
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // AUTHENTICATED WORKSPACE
  // =========================================================================
  const currentUser = workspaceData?.user;
  const canSeePrivateZone =
    currentUser?.role === 'OWNER' || currentUser?.canViewPrivateCosts;

  // Compute global KPI summary without inflating or double-counting states
  const totalAvailableUnits = (workspaceData?.balances || [])
    .filter((b) => b.status === 'AVAILABLE')
    .reduce((s, b) => s + b.quantity, 0);
  const totalReservedUnits = (workspaceData?.balances || [])
    .filter((b) => b.status === 'RESERVED_ORDER')
    .reduce((s, b) => s + b.quantity, 0);
  const totalInProductionUnits = (workspaceData?.balances || [])
    .filter(
      (b) =>
        b.status === 'IN_PRODUCTION_CUSTODY' || b.status === 'IN_TRANSIT_PRODUCTION'
    )
    .reduce((s, b) => s + b.quantity, 0);
  const totalFinishedPendingPickup = (workspaceData?.balances || [])
    .filter(
      (b) =>
        b.status === 'FINISHED_PENDING_PICKUP' || b.status === 'FINISHED_IN_TRANSIT'
    )
    .reduce((s, b) => s + b.quantity, 0);
  const totalDiscrepancyUnits = (workspaceData?.balances || [])
    .filter((b) => b.status === 'DISCREPANCY_HOLD')
    .reduce((s, b) => s + b.quantity, 0);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* STRICT OFFLINE BANNER (Section 17 & Criteria Non-Negotiable) */}
      {!isOnline && (
        <div className="bg-red-600 text-white px-6 py-3 flex items-center justify-between gap-4 text-xs font-semibold">
          <div className="flex items-center gap-2.5">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>
              Sin conexión: operaciones deshabilitadas. No se guardan movimientos en el navegador ni
              existen colas offline. Reconecte para confirmar en el servidor.
            </span>
          </div>
          {simulateOfflineCut && (
            <button
              onClick={() => setSimulateOfflineCut(false)}
              className="px-3 py-1 bg-white text-red-700 rounded font-bold shrink-0"
            >
              Restaurar Conexión (Fin Prueba Caso F)
            </button>
          )}
        </div>
      )}

      {/* TOP BAR CONTRACT: Strictly 3 zones separated by gap-8 */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveNav('INVENTARIO_CATALOGO');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          ControlStock Pro
        </a>

        {/* Zone 2: 4–5 concise single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <a
            href="#inventario"
            onClick={(e) => {
              e.preventDefault();
              setActiveNav('INVENTARIO_CATALOGO');
            }}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
              activeNav === 'INVENTARIO_CATALOGO'
                ? 'text-slate-900 underline underline-offset-8 decoration-2 decoration-sky-600'
                : ''
            }`}
          >
            Inventario y Catálogo
          </a>
          <a
            href="#produccion"
            onClick={(e) => {
              e.preventDefault();
              setActiveNav('PRODUCCION_RECOGIDA');
            }}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
              activeNav === 'PRODUCCION_RECOGIDA'
                ? 'text-slate-900 underline underline-offset-8 decoration-2 decoration-sky-600'
                : ''
            }`}
          >
            Producción y Recogida
          </a>
          <a
            href="#traslados"
            onClick={(e) => {
              e.preventDefault();
              setActiveNav('TRASLADOS_CONTEOS');
            }}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
              activeNav === 'TRASLADOS_CONTEOS'
                ? 'text-slate-900 underline underline-offset-8 decoration-2 decoration-sky-600'
                : ''
            }`}
          >
            Traslados y Conteos
          </a>
          <a
            href="#kardex"
            onClick={(e) => {
              e.preventDefault();
              setActiveNav('KARDEX_REPORTES');
            }}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
              activeNav === 'KARDEX_REPORTES'
                ? 'text-slate-900 underline underline-offset-8 decoration-2 decoration-sky-600'
                : ''
            }`}
          >
            Kardex y Reportes
          </a>
          <a
            href="#privado"
            onClick={(e) => {
              e.preventDefault();
              setActiveNav('ZONA_PRIVADA');
            }}
            className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 ${
              activeNav === 'ZONA_PRIVADA'
                ? 'text-slate-900 underline underline-offset-8 decoration-2 decoration-sky-600'
                : ''
            }`}
          >
            Zona Privada Dueño
          </a>
        </nav>

        {/* Zone 3: 1 primary action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={handleLogout}
            className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Cerrar Sesión
          </button>
        </div>
      </header>

      {/* Mobile Navigation Bar */}
      <div className="md:hidden bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-2 overflow-x-auto">
        <button
          onClick={() => setActiveNav('INVENTARIO_CATALOGO')}
          className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap shrink-0 ${
            activeNav === 'INVENTARIO_CATALOGO'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600'
          }`}
        >
          Inventario
        </button>
        <button
          onClick={() => setActiveNav('PRODUCCION_RECOGIDA')}
          className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap shrink-0 ${
            activeNav === 'PRODUCCION_RECOGIDA'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600'
          }`}
        >
          Producción
        </button>
        <button
          onClick={() => setActiveNav('TRASLADOS_CONTEOS')}
          className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap shrink-0 ${
            activeNav === 'TRASLADOS_CONTEOS'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600'
          }`}
        >
          Traslados
        </button>
        <button
          onClick={() => setActiveNav('KARDEX_REPORTES')}
          className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap shrink-0 ${
            activeNav === 'KARDEX_REPORTES'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600'
          }`}
        >
          Kardex
        </button>
        <button
          onClick={() => setActiveNav('ZONA_PRIVADA')}
          className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap shrink-0 ${
            activeNav === 'ZONA_PRIVADA'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600'
          }`}
        >
          Zona Privada
        </button>
      </div>

      {/* WORKSPACE CONTEXT & ROLE SIMULATOR TOOLBAR */}
      <div className="bg-slate-100 border-b border-slate-200 px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex flex-wrap items-center gap-3 text-slate-700">
          <span>
            Usuario Activo:{' '}
            <strong className="text-slate-900">{currentUser?.fullName}</strong>
          </span>
          <span>·</span>
          <span>
            Rol: <strong className="text-sky-800">{translateRole(currentUser?.role || '')}</strong>
          </span>
          <span>·</span>
          <span>
            Costos Privados:{' '}
            <strong>{canSeePrivateZone ? 'Autorizado' : 'Bloqueado en Servidor'}</strong>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Quick Role Switcher for Testing Permissions */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-600 font-medium">Cambiar Rol de Prueba:</span>
            <select
              value={simulatedUserId || currentUser?.id || ''}
              onChange={(e) => setSimulatedUserId(Number(e.target.value))}
              className="text-xs border border-slate-300 rounded px-2 py-1 bg-white font-medium text-slate-900"
            >
              {availableProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.fullName} — [{p.role}]
                </option>
              ))}
            </select>
          </div>

          {/* Simulate Offline Mode Button (Case F) */}
          <button
            type="button"
            onClick={() => setSimulateOfflineCut(!simulateOfflineCut)}
            className={`px-2.5 py-1 rounded border text-xs font-medium whitespace-nowrap shrink-0 ${
              simulateOfflineCut
                ? 'bg-red-600 text-white border-red-700'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {simulateOfflineCut
              ? 'Modo Sin Red Activo (Click para Reconectar)'
              : 'Simular Corte de Internet (Caso F)'}
          </button>

          <button
            type="button"
            onClick={loadWorkspace}
            className="px-2.5 py-1 bg-white border border-slate-300 rounded text-slate-700 hover:bg-slate-50 flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingWorkspace ? 'animate-spin' : ''}`} />
            Sincronizar
          </button>
        </div>
      </div>

      {/* MAIN VIEWPORT CONTAINER */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {workspaceError && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-xs text-red-900">
            {workspaceError}
          </div>
        )}

        {/* Global Non-Inflated State Summary Strip */}
        {workspaceData && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <div className="text-xs text-slate-500">Stock Disponible Libre</div>
              <div className="text-xl font-mono font-bold text-emerald-700 mt-1 tabular-nums">
                {formatInt(totalAvailableUnits)}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                En almacenes autorizados
              </div>
            </div>

            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <div className="text-xs text-slate-500">Reservado en Órdenes (Origen)</div>
              <div className="text-xl font-mono font-bold text-amber-700 mt-1 tabular-nums">
                {formatInt(totalReservedUnits)}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Apartado sin consumir aún
              </div>
            </div>

            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <div className="text-xs text-slate-500">En Custodia de Producción</div>
              <div className="text-xl font-mono font-bold text-sky-700 mt-1 tabular-nums">
                {formatInt(totalInProductionUnits)}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                UDP / microSD en taller
              </div>
            </div>

            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <div className="text-xs text-slate-500">Terminados Listos p/ Recoger</div>
              <div className="text-xl font-mono font-bold text-indigo-700 mt-1 tabular-nums">
                {formatInt(totalFinishedPendingPickup)}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Pendientes de recepción formal
              </div>
            </div>

            <div className="bg-white p-4 rounded-lg border border-slate-200">
              <div className="text-xs text-slate-500">Retenido por Discrepancia</div>
              <div
                className={`text-xl font-mono font-bold mt-1 tabular-nums ${
                  totalDiscrepancyUnits > 0 ? 'text-red-600' : 'text-slate-400'
                }`}
              >
                {formatInt(totalDiscrepancyUnits)}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                Diferencias por conciliar
              </div>
            </div>
          </div>
        )}

        {/* Active Module Content */}
        {workspaceData && activeNav === 'INVENTARIO_CATALOGO' && (
          <CatalogAndStockView
            data={workspaceData}
            isOnline={isOnline}
            apiFetch={apiFetch}
            onRefresh={loadWorkspace}
          />
        )}

        {workspaceData && activeNav === 'PRODUCCION_RECOGIDA' && (
          <ProductionAndPickupView
            data={workspaceData}
            isOnline={isOnline}
            apiFetch={apiFetch}
            onRefresh={loadWorkspace}
          />
        )}

        {workspaceData &&
          (activeNav === 'TRASLADOS_CONTEOS' ||
            activeNav === 'KARDEX_REPORTES' ||
            activeNav === 'ZONA_PRIVADA') && (
            <OperationsAuditAndPrivateView
              data={workspaceData}
              isOnline={isOnline}
              activeSection={
                activeNav === 'TRASLADOS_CONTEOS'
                  ? 'TRANSFERS_COUNTS'
                  : activeNav === 'KARDEX_REPORTES'
                  ? 'KARDEX_REPORTS'
                  : 'OWNER_PRIVATE'
              }
              apiFetch={apiFetch}
              onRefresh={loadWorkspace}
            />
          )}
      </main>

      {/* Clean Minimal Footer */}
      <footer className="bg-white border-t border-slate-200 px-6 py-4 text-xs text-slate-500 flex flex-wrap items-center justify-between gap-4">
        <div>
          ControlStock Pro · Contabilidad de Origen Único y Transacciones ACID en PostgreSQL
        </div>
        <div>
          Zona Horaria Operativa: America/La_Paz · Última sincronización:{' '}
          <span className="font-mono">
            {formatBoliviaDateTime(workspaceData?.serverTimestamp)}
          </span>
        </div>
      </footer>
    </div>
  );
}
