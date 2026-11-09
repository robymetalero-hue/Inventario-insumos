import React, { useState, useEffect, useCallback } from 'react';
import {
  Package,
  Factory,
  Truck,
  ArrowLeftRight,
  History,
  Lock,
  LogOut,
  Wifi,
  WifiOff,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Tags,
  Layers,
  Building2,
  Users,
  Menu,
  X,
  ShieldCheck,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile, WorkspaceData, translateRole } from './types.ts';
import { CatalogAndStockView } from './components/CatalogAndStockView.tsx';
import { ProductionAndPickupView } from './components/ProductionAndPickupView.tsx';
import { OperationsAuditAndPrivateView } from './components/OperationsAuditAndPrivateView.tsx';
import { PWAInstallButton } from './components/PWAInstallButton.tsx';

type ActiveModule =
  | 'STOCK_CATALOG'
  | 'CATEGORIES'
  | 'WAREHOUSES_LOCATIONS'
  | 'PRODUCTION_ORDERS'
  | 'BOM_RECIPES'
  | 'PICKUPS_DELIVERIES'
  | 'TRANSFERS_COUNTS'
  | 'KARDEX_REPORTS'
  | 'USERS_MANAGEMENT'
  | 'OWNER_PRIVATE';

const STORAGE_TOKEN_KEY = 'controlstock_session_token_v2';
const STORAGE_USER_KEY = 'controlstock_session_user_v2';
const STORAGE_MODULE_KEY = 'controlstock_active_module_v2';

export default function App() {
  const [token, setToken] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_TOKEN_KEY) || '';
    } catch {
      return '';
    }
  });

  const [user, setUser] = useState<UserProfile | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [activeModule, setActiveModule] = useState<ActiveModule>(() => {
    try {
      return (localStorage.getItem(STORAGE_MODULE_KEY) as ActiveModule) || 'STOCK_CATALOG';
    } catch {
      return 'STOCK_CATALOG';
    }
  });

  const [data, setData] = useState<WorkspaceData | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [loading, setLoading] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  // Login form state (defaults to admin / 1234 for fast entry)
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('1234');
  const [authError, setAuthError] = useState('');

  // Toast notifications
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  const notify = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => {
      setToast((prev) => (prev?.msg === msg ? null : prev));
    }, 4500);
  }, []);

  const handleSelectModule = (mod: ActiveModule) => {
    setActiveModule(mod);
    setMobileMenuOpen(false);
    try {
      localStorage.setItem(STORAGE_MODULE_KEY, mod);
    } catch {
      // Ignore storage error
    }
  };

  const clearSession = useCallback(() => {
    setToken('');
    setUser(null);
    setData(null);
    try {
      localStorage.removeItem(STORAGE_TOKEN_KEY);
      localStorage.removeItem(STORAGE_USER_KEY);
    } catch {
      // Ignore storage error
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const apiFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const headers = new Headers(options.headers || {});
      if (!headers.has('Content-Type') && options.body) {
        headers.set('Content-Type', 'application/json');
      }
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      const res = await fetch(url, { ...options, headers });
      const json = await res.json().catch(() => ({}));
      if (res.status === 401) {
        clearSession();
        throw new Error(json.error || 'Sesión expirada. Inicie sesión nuevamente.');
      }
      if (!res.ok) {
        throw new Error(json.error || 'Error en la comunicación con el servidor');
      }
      return json;
    },
    [token, clearSession]
  );

  const fetchWorkspace = useCallback(
    async (currentToken?: string) => {
      const tk = currentToken || token;
      if (!tk) return;
      setLoading(true);
      try {
        const res = await fetch('/api/workspace', {
          headers: { Authorization: `Bearer ${tk}` },
        });
        if (res.status === 401) {
          clearSession();
          return;
        }
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Error cargando datos del sistema');
        setData(json);
        setUser(json.user);
        try {
          localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(json.user));
        } catch {
          // Ignore storage error
        }
      } catch (err: any) {
        notify(err.message, 'error');
      } finally {
        setLoading(false);
      }
    },
    [token, notify, clearSession]
  );

  // Automatically restore workspace when refreshing page with an active token
  useEffect(() => {
    if (token && !data) {
      fetchWorkspace(token);
    }
  }, [token, data, fetchWorkspace]);

  const handleCredentialsLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Usuario o contraseña incorrectos');

      setToken(json.token);
      setUser(json.user);
      try {
        localStorage.setItem(STORAGE_TOKEN_KEY, json.token);
        localStorage.setItem(STORAGE_USER_KEY, JSON.stringify(json.user));
      } catch {
        // Ignore storage error
      }
      await fetchWorkspace(json.token);
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // PANTALLA DE INICIO DE SESION (PRODUCCION)
  // ============================================================================
  if (!user || !token) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex flex-col justify-center items-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="max-w-md w-full bg-white rounded-3xl border border-slate-200/80 shadow-2xl overflow-hidden"
        >
          <div className="bg-gradient-to-b from-slate-900 to-slate-950 p-8 text-white text-center border-b border-slate-800 relative overflow-hidden">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.08, type: 'spring', stiffness: 260, damping: 20 }}
              className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-sky-500 flex items-center justify-center mx-auto mb-3.5 shadow-xl shadow-blue-600/30 ring-4 ring-white/10"
            >
              <Package className="w-8 h-8 text-white" />
            </motion.div>
            <h1 className="text-2xl font-bold tracking-tight">ControlStock Pro</h1>
            <p className="text-xs text-slate-400 mt-1.5 flex items-center justify-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
              Inventario, Almacenes, Producción y Entregas
            </p>
          </div>

          <div className="p-7 space-y-5">
            {!isOnline && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700 font-semibold">
                <WifiOff className="w-4 h-4 shrink-0" />
                Sin conexión a internet. El sistema requiere conexión activa.
              </div>
            )}

            {authError && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700 font-semibold"
              >
                <AlertCircle className="w-4 h-4 shrink-0" />
                {authError}
              </motion.div>
            )}

            <form onSubmit={handleCredentialsLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Usuario de Acceso
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full px-4 py-3 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 transition-shadow"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Contraseña
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••"
                  className="w-full px-4 py-3 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 transition-shadow"
                />
              </div>
              <motion.button
                whileTap={{ scale: 0.98 }}
                type="submit"
                disabled={loading || !isOnline}
                className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-700 hover:to-sky-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-all shadow-md shadow-blue-600/20 cursor-pointer flex items-center justify-center gap-2"
              >
                <span>{loading ? 'Ingresando al sistema...' : 'Iniciar Sesión'}</span>
                {!loading && <ChevronRight className="w-4 h-4" />}
              </motion.button>
            </form>

            <div className="pt-2 border-t border-slate-100">
              <PWAInstallButton variant="login" />
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  const navItems: {
    id: ActiveModule;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    group: string;
    badge?: number;
    roles?: string[];
  }[] = [
    {
      id: 'STOCK_CATALOG',
      label: 'Inventario y Productos',
      icon: Package,
      group: 'INVENTARIO',
      badge: data?.products.length,
    },
    {
      id: 'CATEGORIES',
      label: 'Clasificaciones (Dptos.)',
      icon: Tags,
      group: 'INVENTARIO',
      badge: data?.categories.length,
    },
    {
      id: 'WAREHOUSES_LOCATIONS',
      label: 'Almacenes y Estantes',
      icon: Building2,
      group: 'INVENTARIO',
      badge: data?.warehouses.length,
    },
    {
      id: 'PRODUCTION_ORDERS',
      label: 'Producción y Órdenes',
      icon: Factory,
      group: 'PRODUCCIÓN Y SALIDAS',
      badge: data?.productionOrders.length,
    },
    {
      id: 'BOM_RECIPES',
      label: 'Recetas de Ensamblaje',
      icon: Layers,
      group: 'PRODUCCIÓN Y SALIDAS',
      badge: data?.recipes.length,
    },
    {
      id: 'PICKUPS_DELIVERIES',
      label: 'Recogida de Terminados',
      icon: Truck,
      group: 'PRODUCCIÓN Y SALIDAS',
    },
    {
      id: 'TRANSFERS_COUNTS',
      label: 'Traslados y Conteos',
      icon: ArrowLeftRight,
      group: 'CONTROL Y ADMINISTRACIÓN',
    },
    {
      id: 'KARDEX_REPORTS',
      label: 'Historial (Kardex)',
      icon: History,
      group: 'CONTROL Y ADMINISTRACIÓN',
    },
    {
      id: 'USERS_MANAGEMENT',
      label: 'Usuarios y Accesos',
      icon: Users,
      group: 'CONTROL Y ADMINISTRACIÓN',
      roles: ['OWNER', 'ADMIN'],
    },
    {
      id: 'OWNER_PRIVATE',
      label: 'Costos Privados (Owner)',
      icon: Lock,
      group: 'CONTROL Y ADMINISTRACIÓN',
      roles: ['OWNER'],
    },
  ];

  const visibleNavItems = navItems.filter(
    (item) => !item.roles || item.roles.includes(user.role)
  );

  const groups = Array.from(new Set(visibleNavItems.map((i) => i.group)));

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col lg:flex-row">
      {/* Off-line blocker */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ scale: 0.92 }}
              animate={{ scale: 1 }}
              className="bg-white rounded-2xl max-w-md w-full p-6 text-center shadow-2xl border border-red-200"
            >
              <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-3">
                <WifiOff className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">Conexión Perdida</h2>
              <p className="text-xs text-slate-600 mt-1">
                Para evitar errores de inventario, las operaciones están pausadas hasta recuperar internet.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.95 }}
            className="fixed bottom-5 right-5 z-50 max-w-md"
          >
            <div
              className={`px-4 py-3.5 rounded-xl shadow-xl border flex items-center gap-2.5 text-xs font-bold ${
                toast.type === 'success'
                  ? 'bg-emerald-950 text-white border-emerald-800'
                  : 'bg-red-950 text-white border-red-800'
              }`}
            >
              {toast.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span>{toast.msg}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile Header */}
      <div className="lg:hidden bg-slate-950 text-white px-4 py-3.5 flex items-center justify-between sticky top-0 z-30 border-b border-slate-800 shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-sky-500 flex items-center justify-center shadow-sm">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div>
            <span className="font-bold text-sm block leading-none">ControlStock Pro</span>
            <span className="text-[10px] text-emerald-400 font-medium flex items-center gap-1 mt-0.5">
              <Wifi className="w-2.5 h-2.5" /> Conectado en línea
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => fetchWorkspace()}
            className="p-2 rounded-xl bg-slate-800/80 text-slate-300 hover:text-white cursor-pointer"
            title="Sincronizar"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-400' : ''}`} />
          </button>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-xl bg-blue-600 text-white cursor-pointer shadow-xs"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Left Sidebar Navigation */}
      <aside
        className={`${
          mobileMenuOpen ? 'block' : 'hidden'
        } lg:flex lg:flex-col lg:w-68 bg-slate-950 text-slate-200 shrink-0 border-r border-slate-800/80 lg:min-h-screen sticky top-0 z-20`}
      >
        {/* Brand */}
        <div className="p-5 border-b border-slate-800/80 hidden lg:flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-blue-600 to-sky-500 flex items-center justify-center shadow-lg shadow-blue-600/25 ring-2 ring-white/10">
            <Package className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-tight flex items-center gap-1.5">
              ControlStock Pro
              <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            </h1>
            <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400 font-medium mt-0.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Sincronizado en línea
            </span>
          </div>
        </div>

        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
          {groups.map((grp) => (
            <div key={grp}>
              <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {grp}
              </div>
              <div className="space-y-1">
                {visibleNavItems
                  .filter((i) => i.group === grp)
                  .map((item) => {
                    const Icon = item.icon;
                    const active = activeModule === item.id;
                    return (
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        key={item.id}
                        onClick={() => handleSelectModule(item.id)}
                        className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                          active
                            ? 'bg-gradient-to-r from-blue-600 to-sky-600 text-white shadow-md shadow-blue-600/20'
                            : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Icon
                            className={`w-4 h-4 shrink-0 ${
                              active ? 'text-white' : 'text-slate-400'
                            }`}
                          />
                          <span className="truncate">{item.label}</span>
                        </div>
                        {item.badge !== undefined && (
                          <span
                            className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-bold ${
                              active
                                ? 'bg-white/20 text-white'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {item.badge}
                          </span>
                        )}
                      </motion.button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>

        {/* User Footer */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-900/50">
          <PWAInstallButton variant="sidebar" />
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="min-w-0">
              <div className="text-xs font-bold text-white truncate">{user.fullName}</div>
              <div className="text-[11px] text-sky-400 font-medium truncate">
                {translateRole(user.role)}
              </div>
            </div>
            <button
              onClick={() => fetchWorkspace()}
              title="Actualizar datos"
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-400' : ''}`} />
            </button>
          </div>
          <button
            onClick={clearSession}
            className="w-full py-2.5 px-3 rounded-xl bg-slate-800/90 hover:bg-red-600 text-slate-200 hover:text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
        {!data ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-sm text-slate-500 flex flex-col items-center justify-center gap-3 shadow-xs">
            <RefreshCw className="w-6 h-6 text-blue-600 animate-spin" />
            <span>Sincronizando inventario en tiempo real...</span>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeModule}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
            >
              {(activeModule === 'STOCK_CATALOG' ||
                activeModule === 'CATEGORIES' ||
                activeModule === 'WAREHOUSES_LOCATIONS') && (
                <CatalogAndStockView
                  data={data}
                  isOnline={isOnline}
                  initialSubView={
                    activeModule === 'STOCK_CATALOG'
                      ? 'PRODUCTS'
                      : activeModule === 'CATEGORIES'
                      ? 'CATEGORIES'
                      : 'WAREHOUSES'
                  }
                  apiFetch={apiFetch}
                  onRefresh={() => fetchWorkspace()}
                />
              )}

              {(activeModule === 'PRODUCTION_ORDERS' ||
                activeModule === 'BOM_RECIPES' ||
                activeModule === 'PICKUPS_DELIVERIES') && (
                <ProductionAndPickupView
                  data={data}
                  isOnline={isOnline}
                  initialSubView={
                    activeModule === 'PRODUCTION_ORDERS'
                      ? 'ORDENES'
                      : activeModule === 'BOM_RECIPES'
                      ? 'RECETAS'
                      : 'RECOGIDA'
                  }
                  apiFetch={apiFetch}
                  onRefresh={() => fetchWorkspace()}
                />
              )}

              {(activeModule === 'TRANSFERS_COUNTS' ||
                activeModule === 'KARDEX_REPORTS' ||
                activeModule === 'USERS_MANAGEMENT' ||
                activeModule === 'OWNER_PRIVATE') && (
                <OperationsAuditAndPrivateView
                  data={data}
                  isOnline={isOnline}
                  initialSubView={
                    activeModule === 'TRANSFERS_COUNTS'
                      ? 'TRANSFERS'
                      : activeModule === 'KARDEX_REPORTS'
                      ? 'KARDEX'
                      : activeModule === 'USERS_MANAGEMENT'
                      ? 'USERS'
                      : 'PRIVATE_OWNER'
                  }
                  apiFetch={apiFetch}
                  onRefresh={() => fetchWorkspace()}
                />
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </main>
    </div>
  );
}
