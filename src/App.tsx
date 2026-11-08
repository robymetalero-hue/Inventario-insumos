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
} from 'lucide-react';
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

export default function App() {
  const [token, setToken] = useState<string>('');
  const [user, setUser] = useState<UserProfile | null>(null);
  const [data, setData] = useState<WorkspaceData | null>(null);
  const [activeModule, setActiveModule] = useState<ActiveModule>('STOCK_CATALOG');
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
      if (!res.ok) {
        throw new Error(json.error || 'Error en la comunicación con el servidor');
      }
      return json;
    },
    [token]
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
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Error cargando datos del sistema');
        setData(json);
        setUser(json.user);
      } catch (err: any) {
        notify(err.message, 'error');
      } finally {
        setLoading(false);
      }
    },
    [token, notify]
  );

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
      setActiveModule('STOCK_CATALOG');
      await fetchWorkspace(json.token);
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setToken('');
    setUser(null);
    setData(null);
  };

  // ============================================================================
  // PANTALLA DE INICIO DE SESION (PRODUCCION)
  // ============================================================================
  if (!user || !token) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col justify-center items-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
          <div className="bg-slate-950 p-7 text-white text-center border-b border-slate-800">
            <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-blue-600/30">
              <Package className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">ControlStock Pro</h1>
            <p className="text-xs text-slate-400 mt-1">
              Sistema de Inventario, Almacenes, Producción y Entregas
            </p>
          </div>

          <div className="p-7 space-y-5">
            {!isOnline && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700 font-semibold">
                <WifiOff className="w-4 h-4 shrink-0" />
                Sin conexión a internet. El sistema requiere conexión activa.
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
                  Usuario
                </label>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
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
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <button
                type="submit"
                disabled={loading || !isOnline}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors shadow-sm cursor-pointer"
              >
                {loading ? 'Ingresando al sistema...' : 'Iniciar Sesión'}
              </button>
            </form>

            <div className="pt-2 border-t border-slate-100">
              <PWAInstallButton variant="login" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const navItems: {
    id: ActiveModule;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    group: string;
    roles?: string[];
  }[] = [
    {
      id: 'STOCK_CATALOG',
      label: 'Inventario y Productos',
      icon: Package,
      group: 'INVENTARIO',
    },
    {
      id: 'CATEGORIES',
      label: 'Clasificaciones (Dptos.)',
      icon: Tags,
      group: 'INVENTARIO',
    },
    {
      id: 'WAREHOUSES_LOCATIONS',
      label: 'Almacenes y Estantes',
      icon: Building2,
      group: 'INVENTARIO',
    },
    {
      id: 'PRODUCTION_ORDERS',
      label: 'Producción y Órdenes',
      icon: Factory,
      group: 'PRODUCCIÓN Y SALIDAS',
    },
    {
      id: 'BOM_RECIPES',
      label: 'Recetas de Ensamblaje',
      icon: Layers,
      group: 'PRODUCCIÓN Y SALIDAS',
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
      {!isOnline && (
        <div className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 text-center shadow-2xl border border-red-200">
            <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-3">
              <WifiOff className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900">Conexión Perdida</h2>
            <p className="text-xs text-slate-600 mt-1">
              Para evitar errores de inventario, las operaciones están pausadas hasta recuperar internet.
            </p>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md">
          <div
            className={`px-4 py-3.5 rounded-xl shadow-lg border flex items-center gap-2.5 text-xs font-bold ${
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
        </div>
      )}

      {/* Mobile Header */}
      <div className="lg:hidden bg-slate-900 text-white px-4 py-3 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Package className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-sm">ControlStock Pro</span>
        </div>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-2 rounded-lg bg-slate-800 text-slate-200 cursor-pointer"
        >
          {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Left Sidebar Navigation */}
      <aside
        className={`${
          mobileMenuOpen ? 'block' : 'hidden'
        } lg:flex lg:flex-col lg:w-64 bg-slate-900 text-slate-200 shrink-0 border-r border-slate-800 lg:min-h-screen sticky top-0 z-20`}
      >
        {/* Brand */}
        <div className="p-5 border-b border-slate-800 hidden lg:flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center shadow-md shadow-blue-600/20">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-bold text-white leading-tight">ControlStock Pro</h1>
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
              <Wifi className="w-3 h-3" /> En línea
            </span>
          </div>
        </div>

        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto py-4 px-3 space-y-5">
          {groups.map((grp) => (
            <div key={grp}>
              <div className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                {grp}
              </div>
              <div className="space-y-1">
                {visibleNavItems
                  .filter((i) => i.group === grp)
                  .map((item) => {
                    const Icon = item.icon;
                    const active = activeModule === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => {
                          setActiveModule(item.id);
                          setMobileMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                          active
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>

        {/* User Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60">
          <PWAInstallButton variant="sidebar" />
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="min-w-0">
              <div className="text-xs font-bold text-white truncate">{user.fullName}</div>
              <div className="text-[11px] text-slate-400 truncate">
                {translateRole(user.role)}
              </div>
            </div>
            <button
              onClick={() => fetchWorkspace()}
              title="Actualizar datos"
              className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-blue-400' : ''}`} />
            </button>
          </div>
          <button
            onClick={handleLogout}
            className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-red-600/90 text-slate-200 hover:text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
        {!data ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-sm text-slate-500">
            Cargando datos del sistema...
          </div>
        ) : (
          <>
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
          </>
        )}
      </main>
    </div>
  );
}
