import React, { useState, useEffect, useCallback } from 'react';
import {
  Package,
  Factory,
  History,
  LogOut,
  Wifi,
  WifiOff,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Tags,
  Building2,
  Users,
  Menu,
  X,
  ShieldCheck,
  Sparkles,
  ChevronRight,
  LayoutDashboard,
  Settings,
  ArrowLeftRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile, WorkspaceData, translateRole } from './types.ts';
import { CatalogAndStockView } from './components/CatalogAndStockView.tsx';
import { ProductionAndPickupView } from './components/ProductionAndPickupView.tsx';
import { OperationsAuditAndPrivateView } from './components/OperationsAuditAndPrivateView.tsx';
import { PWAInstallButton } from './components/PWAInstallButton.tsx';

export type ActiveModule =
  | 'SUMMARY'
  | 'STOCK_CATALOG'
  | 'PRODUCTION_ORDERS'
  | 'KARDEX_REPORTS'
  | 'WAREHOUSES_LOCATIONS'
  | 'CATEGORIES'
  | 'USERS_MANAGEMENT';

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
      const saved = localStorage.getItem(STORAGE_MODULE_KEY) as string;
      const valid: ActiveModule[] = [
        'SUMMARY',
        'STOCK_CATALOG',
        'PRODUCTION_ORDERS',
        'KARDEX_REPORTS',
        'WAREHOUSES_LOCATIONS',
        'CATEGORIES',
        'USERS_MANAGEMENT',
      ];
      if (valid.includes(saved as ActiveModule)) {
        return saved as ActiveModule;
      }
      return 'STOCK_CATALOG';
    } catch {
      return 'STOCK_CATALOG';
    }
  });
  const [productionInitialSubTab, setProductionInitialSubTab] = useState<'ORDENES' | 'RECOGIDA'>(
    'ORDENES'
  );

  const [data, setData] = useState<WorkspaceData | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [loading, setLoading] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  // Cross-module context state
  const [preselectedWithdrawOrderId, setPreselectedWithdrawOrderId] = useState<number | null>(null);
  const [kardexFilterProductId, setKardexFilterProductId] = useState<number | null>(null);
  const [kardexFilterOrderId, setKardexFilterOrderId] = useState<number | null>(null);

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

  // Helper to support legacy or sub-module navigation from child views
  const handleChildNavigate = (
    target:
      | 'SUMMARY'
      | 'STOCK_CATALOG'
      | 'PRODUCTION_ORDERS'
      | 'PICKUPS_DELIVERIES'
      | 'KARDEX_REPORTS'
      | 'WAREHOUSES_LOCATIONS',
    options?: { productId?: number; orderId?: number }
  ) => {
    if (options?.productId) {
      setKardexFilterProductId(options.productId);
    }
    if (options?.orderId) {
      setKardexFilterOrderId(options.orderId);
    }
    if (target === 'PICKUPS_DELIVERIES') {
      setProductionInitialSubTab('RECOGIDA');
      handleSelectModule('PRODUCTION_ORDERS');
      return;
    }
    if (target === 'PRODUCTION_ORDERS') {
      setProductionInitialSubTab('ORDENES');
      handleSelectModule('PRODUCTION_ORDERS');
      return;
    }
    if (target === 'WAREHOUSES_LOCATIONS') {
      handleSelectModule('WAREHOUSES_LOCATIONS');
      return;
    }
    handleSelectModule(target);
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
      const res = await fetch(url, { ...options, headers, cache: 'no-store' });
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
          cache: 'no-store',
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
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="max-w-md w-full bg-white rounded-3xl border border-slate-200/80 shadow-2xl overflow-hidden"
        >
          <div className="bg-gradient-to-b from-slate-900 to-slate-950 p-8 text-white text-center border-b border-slate-800 relative overflow-hidden">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-blue-600 to-sky-500 flex items-center justify-center mx-auto mb-3.5 shadow-xl shadow-blue-600/30 ring-4 ring-white/10">
              <Package className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">ControlStock Pro</h1>
            <p className="text-xs text-slate-400 mt-1.5 flex items-center justify-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
              Control de Insumos, Ingresos, Retiros y Producción
            </p>
          </div>

          <div className="p-7 space-y-5">
            {!isOnline && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700 font-semibold">
                <WifiOff className="w-4 h-4 shrink-0" />
                Sin conexión: no se pueden registrar movimientos.
              </div>
            )}

            {authError && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700 font-semibold">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {authError}
              </div>
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
              <button
                type="submit"
                disabled={loading || !isOnline}
                className="w-full py-3.5 bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-700 hover:to-sky-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-all shadow-md shadow-blue-600/20 cursor-pointer flex items-center justify-center gap-2"
              >
                <span>{loading ? 'Ingresando al sistema...' : 'Iniciar Sesión'}</span>
                {!loading && <ChevronRight className="w-4 h-4" />}
              </button>
            </form>

            <div className="pt-2 border-t border-slate-100">
              <PWAInstallButton variant="login" />
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  const isAdmin = user.role === 'OWNER' || user.role === 'ADMIN';

  // ============================================================================
  // NAVEGACIÓN PRINCIPAL DIRECTA (CON GESTIÓN DE USUARIOS VISIBLE)
  // ============================================================================
  const navItems: {
    id: ActiveModule;
    label: string;
    subtitle: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }[] = [
    {
      id: 'SUMMARY',
      label: 'Inicio',
      subtitle: 'Resumen y estado general',
      icon: LayoutDashboard,
    },
    {
      id: 'STOCK_CATALOG',
      label: 'Inventario y Productos',
      subtitle: 'Ingresar, retirar y existencias',
      icon: Package,
      badge: data?.products.length,
    },
    {
      id: 'PRODUCTION_ORDERS',
      label: 'Órdenes de Producción',
      subtitle: 'Entrega UDP, lotes y recogida',
      icon: Factory,
      badge: data?.productionOrders.length,
    },
    {
      id: 'KARDEX_REPORTS',
      label: 'Historial y Kardex',
      subtitle: 'Entradas, salidas y saldos',
      icon: History,
    },
    {
      id: 'WAREHOUSES_LOCATIONS',
      label: 'Almacenes y Subalmacenes',
      subtitle: 'Sucursales, cuartos y estantes',
      icon: Building2,
      badge: data?.warehouses.length,
    },
    {
      id: 'CATEGORIES',
      label: 'Departamentos',
      subtitle: 'Categorías de productos',
      icon: Tags,
      badge: data?.categories.length,
    },
    ...(isAdmin
      ? [
          {
            id: 'USERS_MANAGEMENT' as ActiveModule,
            label: 'Usuarios y Permisos',
            subtitle: 'Personal, entradas y salidas',
            icon: Users,
            badge: data?.usersPublic.length,
          },
        ]
      : []),
  ];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col lg:flex-row">
      {/* Off-line blocker (Strictly Online Required) */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <div className="bg-white rounded-2xl max-w-md w-full p-6 text-center shadow-2xl border border-red-200">
              <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-3">
                <WifiOff className="w-6 h-6" />
              </div>
              <h2 className="text-lg font-bold text-slate-900">
                Sin conexión: no se pueden registrar movimientos
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                La base de datos del servidor es la única fuente de verdad. Reconecte a internet para continuar operando.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
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
              <Wifi className="w-2.5 h-2.5" /> En línea
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

      {/* Left Sidebar Navigation (5 Simple Sections) */}
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
              Conectado en línea
            </span>
          </div>
        </div>

        {/* 5 Main Navigation Buttons */}
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1.5">
          <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            MENÚ PRINCIPAL
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeModule === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleSelectModule(item.id)}
                className={`w-full flex items-center justify-between gap-2 px-3.5 py-3 rounded-xl text-left transition-all cursor-pointer ${
                  active
                    ? 'bg-gradient-to-r from-blue-600 to-sky-600 text-white shadow-md shadow-blue-600/20'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon
                    className={`w-5 h-5 shrink-0 ${
                      active ? 'text-white' : 'text-slate-400'
                    }`}
                  />
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">{item.label}</div>
                    <div
                      className={`text-[10px] truncate ${
                        active ? 'text-blue-100' : 'text-slate-500'
                      }`}
                    >
                      {item.subtitle}
                    </div>
                  </div>
                </div>
                {item.badge !== undefined && (
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-md font-bold shrink-0 ${
                      active ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
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
          <div className="space-y-6">
            {/* 1. INICIO, 2. INVENTARIO, 5. ALMACENES, 6. DEPARTAMENTOS */}
            {(activeModule === 'SUMMARY' ||
              activeModule === 'STOCK_CATALOG' ||
              activeModule === 'WAREHOUSES_LOCATIONS' ||
              activeModule === 'CATEGORIES') && (
              <CatalogAndStockView
                data={data}
                isOnline={isOnline}
                initialSubView={
                  activeModule === 'SUMMARY'
                    ? 'SUMMARY'
                    : activeModule === 'WAREHOUSES_LOCATIONS'
                    ? 'WAREHOUSES'
                    : activeModule === 'CATEGORIES'
                    ? 'CATEGORIES'
                    : 'PRODUCTS'
                }
                preselectedWithdrawOrderId={preselectedWithdrawOrderId}
                onClearPreselectedOrder={() => setPreselectedWithdrawOrderId(null)}
                onNavigateToModule={handleChildNavigate}
                apiFetch={apiFetch}
                onRefresh={() => fetchWorkspace()}
              />
            )}

            {/* 3. ÓRDENES DE PRODUCCIÓN (ORDENES + RECEPCIÓN DE TERMINADOS) */}
            {activeModule === 'PRODUCTION_ORDERS' && (
              <ProductionAndPickupView
                data={data}
                isOnline={isOnline}
                initialSubView={productionInitialSubTab}
                onRequestWithdrawForOrder={(orderId: number) => {
                  setPreselectedWithdrawOrderId(orderId);
                  handleSelectModule('STOCK_CATALOG');
                }}
                onNavigateToKardexForOrder={(orderId: number) => {
                  setKardexFilterOrderId(orderId);
                  handleSelectModule('KARDEX_REPORTS');
                }}
                apiFetch={apiFetch}
                onRefresh={() => fetchWorkspace()}
              />
            )}

            {/* 4. HISTORIAL Y KARDEX */}
            {activeModule === 'KARDEX_REPORTS' && (
              <OperationsAuditAndPrivateView
                data={data}
                isOnline={isOnline}
                initialSubView="KARDEX"
                initialKardexProductId={kardexFilterProductId}
                initialKardexOrderId={kardexFilterOrderId}
                onClearKardexContext={() => {
                  setKardexFilterProductId(null);
                  setKardexFilterOrderId(null);
                }}
                apiFetch={apiFetch}
                onRefresh={() => fetchWorkspace()}
              />
            )}

            {/* 7. GESTIÓN DE USUARIOS Y PERMISOS */}
            {activeModule === 'USERS_MANAGEMENT' && (
              <OperationsAuditAndPrivateView
                data={data}
                isOnline={isOnline}
                initialSubView="USERS"
                apiFetch={apiFetch}
                onRefresh={() => fetchWorkspace()}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
