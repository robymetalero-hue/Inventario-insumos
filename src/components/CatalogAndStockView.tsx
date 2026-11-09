import React, { useState } from 'react';
import {
  Package,
  Search,
  Plus,
  Edit3,
  Trash2,
  Camera,
  FolderKanban,
  ArrowDownToLine,
  Eye,
  X,
  Check,
  Warehouse as WarehouseIcon,
  ChevronsRight,
  AlertTriangle,
  Cpu,
  HardDrive,
  Box,
  Layers,
  Usb,
  PackageCheck,
  Building2,
  TrendingUp,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  WorkspaceData,
  Product,
  ProductCategory,
  Warehouse,
  formatInt,
  translateStatus,
  translateAccountingType,
} from '../types.ts';

function getDepartmentIcon(name: string, accountingType?: string) {
  const n = (name || '').toLowerCase();
  if (n.includes('udp') || n.includes('chip')) return Cpu;
  if (n.includes('microsd') || n.includes('memoria')) return HardDrive;
  if (n.includes('case') || n.includes('carcasa')) return Box;
  if (n.includes('empaque') || n.includes('blister') || n.includes('blíster')) return Layers;
  if (n.includes('adaptador') || n.includes('usb')) return Usb;
  if (n.includes('terminado') || accountingType === 'FINISHED_GOOD') return PackageCheck;
  return FolderKanban;
}

interface Props {
  data: WorkspaceData;
  isOnline: boolean;
  initialSubView?: 'PRODUCTS' | 'CATEGORIES' | 'RECEIPTS' | 'WAREHOUSES';
  apiFetch: (url: string, options?: RequestInit) => Promise<any>;
  onRefresh: () => Promise<void>;
}

export function CatalogAndStockView({
  data,
  isOnline,
  initialSubView = 'PRODUCTS',
  apiFetch,
  onRefresh,
}: Props) {
  const [subView, setSubView] = useState<'PRODUCTS' | 'CATEGORIES' | 'RECEIPTS' | 'WAREHOUSES'>(
    initialSubView
  );
  React.useEffect(() => {
    setSubView(initialSubView);
  }, [initialSubView]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | 'ALL'>('ALL');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // =========================================================================
  // 1. SIMPLIFIED PRODUCT MODAL STATE (Create & Edit)
  // Only asks for: SKU, Descripción, Clasificación, Cantidad (optional on create), Fotografía
  // =========================================================================
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [prodSku, setProdSku] = useState('');
  const [prodDescription, setProdDescription] = useState('');
  const [prodCategoryName, setProdCategoryName] = useState(
    data.categories[0]?.name || 'Cases'
  );
  const [prodInitialQty, setProdInitialQty] = useState<number>(0);
  const [prodInitialWhId, setProdInitialWhId] = useState<number>(
    data.warehouses[0]?.id || 0
  );
  const [prodImageUrl, setProdImageUrl] = useState('');
  const [deleteConfirmProduct, setDeleteConfirmProduct] = useState<Product | null>(null);
  const [zoomPhotoProduct, setZoomPhotoProduct] = useState<Product | null>(null);

  // Quick Add Stock Modal for an existing product
  const [quickStockProduct, setQuickStockProduct] = useState<Product | null>(null);
  const [quickStockQty, setQuickStockQty] = useState<number>(500);
  const [quickStockWhId, setQuickStockWhId] = useState<number>(data.warehouses[0]?.id || 0);
  const [quickStockSupplier, setQuickStockSupplier] = useState('');
  const [quickIncludeCost, setQuickIncludeCost] = useState(false);
  const [quickFobCost, setQuickFobCost] = useState<number>(0);
  const [quickFreightCost, setQuickFreightCost] = useState<number>(0);
  const [quickCustomsCost, setQuickCustomsCost] = useState<number>(0);

  // =========================================================================
  // 2. CLASSIFICATIONS / DEPARTMENTS CRUD STATE (Empaques, Cases, etc.)
  // =========================================================================
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);
  const [catName, setCatName] = useState('');
  const [catAccType, setCatAccType] = useState<ProductCategory['accountingType']>(
    'SECONDARY_COMPONENT'
  );
  const [catDescription, setCatDescription] = useState('');

  // =========================================================================
  // 3. WAREHOUSES & LOCATIONS CRUD STATE + IPHONE SLIDE-TO-DELETE
  // =========================================================================
  const [whName, setWhName] = useState('');
  const [whAddress, setWhAddress] = useState('');
  const [whIsPlant, setWhIsPlant] = useState(false);
  const [locWhId, setLocWhId] = useState<number>(data.warehouses[0]?.id || 0);
  const [locZone, setLocZone] = useState('');
  const [locShelf, setLocShelf] = useState('');

  // Slide-to-delete warehouse confirmation state
  const [warehouseToDelete, setWarehouseToDelete] = useState<Warehouse | null>(null);
  const [slideProgress, setSlideProgress] = useState<number>(0);
  const [deletingWarehouse, setDeletingWarehouse] = useState<boolean>(false);

  const isAdmin = data.user.role === 'OWNER' || data.user.role === 'ADMIN';
  const canViewCosts = data.user.role === 'OWNER' || data.user.canViewPrivateCosts;

  React.useEffect(() => {
    setSubView(initialSubView);
  }, [initialSubView]);

  const openCreateProductModal = () => {
    setEditingProduct(null);
    setProdSku('');
    setProdDescription('');
    setProdCategoryName(data.categories[0]?.name || 'Empaques');
    setProdInitialQty(0);
    setProdInitialWhId(data.warehouses[0]?.id || 0);
    setProdImageUrl('');
    setProductModalOpen(true);
  };

  const openEditProductModal = (prod: Product) => {
    setEditingProduct(prod);
    setProdSku(prod.sku);
    setProdDescription(prod.name);
    setProdCategoryName(prod.family);
    setProdInitialQty(0);
    setProdImageUrl(prod.imageUrl);
    setProductModalOpen(true);
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      setFeedback({ type: 'error', text: 'La fotografía no debe superar 6 MB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setProdImageUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline) return;
    if (!prodSku.trim() || !prodDescription.trim() || !prodCategoryName.trim()) {
      setFeedback({
        type: 'error',
        text: 'Complete el SKU, la descripción del producto y su clasificación.',
      });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      const matchedCat = data.categories.find((c) => c.name === prodCategoryName);
      const accountingType = matchedCat?.accountingType || 'SECONDARY_COMPONENT';

      if (editingProduct) {
        await apiFetch(`/api/products/${editingProduct.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            sku: prodSku,
            name: prodDescription,
            family: prodCategoryName,
            productType: accountingType,
            imageUrl: prodImageUrl,
          }),
        });
        setFeedback({
          type: 'success',
          text: `Producto "${prodDescription}" actualizado correctamente.`,
        });
      } else {
        const defaultLoc = data.locations.find((l) => l.warehouseId === prodInitialWhId);
        await apiFetch('/api/products', {
          method: 'POST',
          body: JSON.stringify({
            sku: prodSku,
            name: prodDescription,
            family: prodCategoryName,
            productType: accountingType,
            imageUrl: prodImageUrl,
            initialQuantity: prodInitialQty,
            initialWarehouseId: prodInitialWhId,
            initialLocationId: defaultLoc?.id,
          }),
        });
        setFeedback({
          type: 'success',
          text:
            prodInitialQty > 0
              ? `Producto "${prodDescription}" creado con ${formatInt(prodInitialQty)} unidades iniciales.`
              : `Producto "${prodDescription}" creado en el catálogo.`,
        });
      }
      setProductModalOpen(false);
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteProduct = async (prod: Product) => {
    if (!isOnline) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await apiFetch(`/api/products/${prod.id}`, {
        method: 'DELETE',
      });
      setDeleteConfirmProduct(null);
      setFeedback({
        type: 'success',
        text: `Producto "${prod.name}" (${prod.sku}) eliminado permanentemente.`,
      });
      await onRefresh();
    } catch (err: any) {
      setDeleteConfirmProduct(null);
      setFeedback({
        type: 'error',
        text: err.message || 'No se pudo eliminar el producto.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmQuickStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || !quickStockProduct || quickStockQty <= 0) return;
    const loc =
      data.locations.find((l) => l.warehouseId === quickStockWhId) || data.locations[0];
    if (!loc) {
      setFeedback({ type: 'error', text: 'Seleccione un almacén con ubicación activa.' });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/inventory/receipts', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `ING-QUICK-${quickStockProduct.id}-${Date.now()}`,
          movementType: 'INGRESO_PROVEEDOR',
          warehouseId: quickStockWhId,
          locationId: loc.id,
          supplierOrContainer: quickStockSupplier || 'Ingreso Directo a Almacén',
          notes: `Ingreso de ${quickStockProduct.name}`,
          lines: [
            {
              productId: quickStockProduct.id,
              quantity: quickStockQty,
              privateCost:
                canViewCosts && quickIncludeCost
                  ? {
                      fobTotalCost: quickFobCost,
                      freightCost: quickFreightCost,
                      customsPolicyCost: quickCustomsCost,
                      otherImportExpenses: 0,
                      currency: 'USD',
                    }
                  : undefined,
            },
          ],
        }),
      });
      setQuickStockProduct(null);
      setQuickStockSupplier('');
      setQuickIncludeCost(false);
      setFeedback({
        type: 'success',
        text: `Se sumaron +${formatInt(quickStockQty)} unidades a "${
          quickStockProduct.name
        }" (Comprobante ${res.folio}).`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  // Category CRUD Handlers
  const openCreateCategoryModal = () => {
    setEditingCategory(null);
    setCatName('');
    setCatAccType('SECONDARY_COMPONENT');
    setCatDescription('');
    setCatModalOpen(true);
  };

  const openEditCategoryModal = (cat: ProductCategory) => {
    setEditingCategory(cat);
    setCatName(cat.name);
    setCatAccType(cat.accountingType);
    setCatDescription(cat.description);
    setCatModalOpen(true);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || !catName.trim()) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      if (editingCategory) {
        await apiFetch(`/api/categories/${editingCategory.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: catName,
            accountingType: catAccType,
            description: catDescription,
          }),
        });
        setFeedback({
          type: 'success',
          text: `Clasificación "${catName}" actualizada.`,
        });
      } else {
        await apiFetch('/api/categories', {
          method: 'POST',
          body: JSON.stringify({
            name: catName,
            accountingType: catAccType,
            description: catDescription,
          }),
        });
        setFeedback({
          type: 'success',
          text: `Clasificación "${catName}" creada correctamente.`,
        });
      }
      setCatModalOpen(false);
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCategory = async (cat: ProductCategory) => {
    if (!isOnline) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/categories/${cat.id}`, { method: 'DELETE' });
      setFeedback({
        type: 'success',
        text: `Clasificación "${cat.name}" eliminada.`,
      });
      if (selectedCategory === cat.name) setSelectedCategory('ALL');
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateWarehouse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || !whName.trim()) return;
    setSubmitting(true);
    try {
      await apiFetch('/api/warehouses', {
        method: 'POST',
        body: JSON.stringify({
          type: 'WAREHOUSE',
          name: whName,
          address: whAddress,
          description: whIsPlant ? 'Planta / Taller de Producción' : 'Almacén de Mercancía',
          isProductionPlant: whIsPlant,
        }),
      });
      setWhName('');
      setWhAddress('');
      setFeedback({ type: 'success', text: `Almacén "${whName}" creado.` });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || !locWhId || !locZone.trim() || !locShelf.trim()) return;
    setSubmitting(true);
    try {
      await apiFetch('/api/warehouses', {
        method: 'POST',
        body: JSON.stringify({
          type: 'LOCATION',
          warehouseId: locWhId,
          zoneName: locZone,
          shelfName: locShelf,
        }),
      });
      setLocZone('');
      setLocShelf('');
      setFeedback({ type: 'success', text: 'Ubicación / Estante añadido al almacén.' });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const openDeleteWarehouseModal = (wh: Warehouse) => {
    setWarehouseToDelete(wh);
    setSlideProgress(0);
    setDeletingWarehouse(false);
  };

  const executeWarehouseDeletion = async (wh: Warehouse) => {
    if (!isOnline || deletingWarehouse) return;
    setDeletingWarehouse(true);
    try {
      await apiFetch(`/api/warehouses/${wh.id}`, { method: 'DELETE' });
      setFeedback({
        type: 'success',
        text: `Almacén "${wh.name}" y sus ubicaciones fueron eliminados permanentemente.`,
      });
      if (selectedWarehouseId === wh.id) {
        setSelectedWarehouseId('ALL');
      }
      setWarehouseToDelete(null);
      setSlideProgress(0);
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
      setSlideProgress(0);
    } finally {
      setDeletingWarehouse(false);
    }
  };

  const handleSlideChange = (val: number) => {
    if (deletingWarehouse || !warehouseToDelete) return;
    setSlideProgress(val);
    if (val >= 96) {
      setSlideProgress(100);
      executeWarehouseDeletion(warehouseToDelete);
    }
  };

  const handleSlideRelease = () => {
    if (deletingWarehouse) return;
    if (slideProgress < 96) {
      setSlideProgress(0);
    }
  };

  const handleDeleteLocation = async (locId: number, shelfName: string) => {
    if (!isOnline) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/warehouses/locations/${locId}`, { method: 'DELETE' });
      setFeedback({ type: 'success', text: `Estante "${shelfName}" eliminado.` });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const filteredProducts = data.products.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      p.sku.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      p.family.toLowerCase().includes(q);
    const matchesCat = selectedCategory === 'ALL' || p.family === selectedCategory;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          className={`p-4 rounded-xl border text-sm flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <span className="font-medium">{feedback.text}</span>
          <button
            onClick={() => setFeedback(null)}
            className="text-xs font-semibold underline ml-4"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUBVIEW 1: PRODUCTOS Y EXISTENCIAS (TARJETAS GRANDES Y SIMPLES)       */}
      {/* ===================================================================== */}
      {subView === 'PRODUCTS' && (
        <div className="space-y-6">
          {/* KPI Summary Strip */}
          {(() => {
            const totalAvailable = data.balances
              .filter(
                (b) =>
                  b.status === 'AVAILABLE' &&
                  (selectedWarehouseId === 'ALL' || b.warehouseId === selectedWarehouseId)
              )
              .reduce((s, b) => s + b.quantity, 0);
            const totalInProcess = data.balances
              .filter(
                (b) =>
                  (b.status === 'IN_PRODUCTION_CUSTODY' ||
                    b.status === 'IN_TRANSIT_PRODUCTION' ||
                    b.status === 'RESERVED_ORDER') &&
                  (selectedWarehouseId === 'ALL' || b.warehouseId === selectedWarehouseId)
              )
              .reduce((s, b) => s + b.quantity, 0);

            return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3.5 shadow-2xs">
                  <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <Package className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-slate-500">
                      Productos Registrados
                    </div>
                    <div className="text-xl font-mono font-bold text-slate-900">
                      {formatInt(data.products.length)}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3.5 shadow-2xs">
                  <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-slate-500">
                      Stock Disponible
                    </div>
                    <div className="text-xl font-mono font-bold text-emerald-700">
                      {formatInt(totalAvailable)}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3.5 shadow-2xs">
                  <div className="w-11 h-11 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-slate-500">
                      En Producción / Orden
                    </div>
                    <div className="text-xl font-mono font-bold text-sky-700">
                      {formatInt(totalInProcess)}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3.5 shadow-2xs">
                  <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-slate-500">
                      Almacenes Activos
                    </div>
                    <div className="text-xl font-mono font-bold text-slate-900">
                      {formatInt(data.warehouses.length)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Top Action & Search Header */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xs">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar producto por SKU, descripción o departamento..."
                className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-600 transition-shadow"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={selectedWarehouseId}
                onChange={(e) =>
                  setSelectedWarehouseId(
                    e.target.value === 'ALL' ? 'ALL' : Number(e.target.value)
                  )
                }
                className="text-xs border border-slate-300 rounded-xl px-3.5 py-2.5 bg-white font-semibold text-slate-700 cursor-pointer"
              >
                <option value="ALL">Todos los Almacenes ({data.warehouses.length})</option>
                {data.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    Almacén: {w.name}
                  </option>
                ))}
              </select>

              {isAdmin && (
                <>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    type="button"
                    onClick={() => setSubView('CATEGORIES')}
                    className="px-4 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FolderKanban className="w-4 h-4 text-slate-600" />
                    Clasificaciones ({data.categories.length})
                  </motion.button>

                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    type="button"
                    onClick={openCreateProductModal}
                    className="px-4 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-700 hover:to-sky-700 rounded-xl transition-all shadow-sm shadow-blue-600/20 flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Nuevo Producto
                  </motion.button>
                </>
              )}
            </div>
          </div>

          {/* Interactive Classification Filter Tabs with Custom Icons */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setSelectedCategory('ALL')}
              className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                selectedCategory === 'ALL'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              Todos ({data.products.length})
            </button>
            {data.categories.map((cat) => {
              const count = data.products.filter((p) => p.family === cat.name).length;
              const CatIcon = getDepartmentIcon(cat.name, cat.accountingType);
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.name)}
                  className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition-all whitespace-nowrap shrink-0 flex items-center gap-1.5 cursor-pointer ${
                    selectedCategory === cat.name
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:border-slate-300'
                  }`}
                >
                  <CatIcon className="w-3.5 h-3.5" />
                  {cat.name} ({count})
                </button>
              );
            })}
          </div>

          {/* Empty State when Inventory starts at 0 */}
          {filteredProducts.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-slate-200 p-12 text-center max-w-xl mx-auto my-6 space-y-4 shadow-2xs"
            >
              <div className="w-14 h-14 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto">
                <Package className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  {data.products.length === 0
                    ? 'Tu inventario está limpio y listo para empezar'
                    : 'No se encontraron productos con ese filtro'}
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  {data.products.length === 0
                    ? 'Registra tus primeros componentes o productos (por ejemplo: Chips UDP, Cases, Empaques o Memorias microSD) con su SKU, descripción, clasificación, cantidad y fotografía.'
                    : 'Prueba cambiando el término de búsqueda o seleccionando otra clasificación.'}
                </p>
              </div>
              {isAdmin && (
                <div className="flex items-center justify-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={openCreateProductModal}
                    className="px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl inline-flex items-center gap-2 cursor-pointer shadow-xs"
                  >
                    <Plus className="w-4 h-4" />
                    Crear Primer Producto
                  </button>
                  <button
                    type="button"
                    onClick={() => setSubView('CATEGORIES')}
                    className="px-4 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                  >
                    Configurar Clasificaciones
                  </button>
                </div>
              )}
            </motion.div>
          ) : (
            /* Clean Visual Product Cards Grid with Motion Transitions */
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              <AnimatePresence mode="popLayout">
                {filteredProducts.map((product) => {
                  const prodBalances = data.balances.filter(
                    (b) =>
                      b.productId === product.id &&
                      (selectedWarehouseId === 'ALL' || b.warehouseId === selectedWarehouseId)
                  );

                  const availableQty = prodBalances
                    .filter((b) => b.status === 'AVAILABLE')
                    .reduce((s, b) => s + b.quantity, 0);
                  const inProductionQty = prodBalances
                    .filter(
                      (b) =>
                        b.status === 'IN_PRODUCTION_CUSTODY' ||
                        b.status === 'IN_TRANSIT_PRODUCTION' ||
                        b.status === 'RESERVED_ORDER'
                    )
                    .reduce((s, b) => s + b.quantity, 0);
                  const pendingPickupQty = prodBalances
                    .filter(
                      (b) =>
                        b.status === 'FINISHED_PENDING_PICKUP' ||
                        b.status === 'FINISHED_IN_TRANSIT'
                    )
                    .reduce((s, b) => s + b.quantity, 0);

                  const DeptIcon = getDepartmentIcon(product.family, product.productType);

                  return (
                    <motion.div
                      layout
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.92 }}
                      transition={{ duration: 0.18 }}
                      key={product.id}
                      className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col justify-between transition-all hover:shadow-md hover:border-slate-300"
                    >
                      <div>
                        {/* Large Legible Product Photo Header */}
                        <div
                          onClick={() => setZoomPhotoProduct(product)}
                          className="relative h-44 bg-slate-900 cursor-pointer group overflow-hidden border-b border-slate-100"
                        >
                          {product.imageUrl ? (
                            <img
                              src={product.imageUrl}
                              alt={product.name}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-500">
                              <DeptIcon className="w-12 h-12" />
                            </div>
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex items-end justify-between p-3.5">
                            <div className="text-xs font-mono font-bold text-white bg-black/40 backdrop-blur-xs px-2.5 py-1 rounded-lg border border-white/15">
                              {product.sku}
                            </div>
                            <div className="text-xs font-semibold text-sky-300 flex items-center gap-1.5 bg-slate-950/60 backdrop-blur-xs px-2.5 py-1 rounded-lg">
                              <DeptIcon className="w-3.5 h-3.5" />
                              {product.family}
                            </div>
                          </div>
                        </div>

                        {/* Product Description & Balances */}
                        <div className="p-4 space-y-3">
                          <h3 className="text-base font-bold text-slate-900 leading-snug">
                            {product.name}
                          </h3>

                          <div className="grid grid-cols-3 gap-2 pt-1">
                            <div className="p-2.5 bg-emerald-50/60 border border-emerald-100 rounded-xl">
                              <div className="text-[11px] font-medium text-emerald-800">
                                Disponible
                              </div>
                              <div className="text-base font-mono font-bold text-emerald-700 tabular-nums">
                                {formatInt(availableQty)}
                              </div>
                            </div>
                            <div className="p-2.5 bg-sky-50/60 border border-sky-100 rounded-xl">
                              <div className="text-[11px] font-medium text-sky-800">
                                Producción
                              </div>
                              <div className="text-base font-mono font-semibold text-sky-700 tabular-nums">
                                {formatInt(inProductionQty)}
                              </div>
                            </div>
                            <div className="p-2.5 bg-indigo-50/60 border border-indigo-100 rounded-xl">
                              <div className="text-[11px] font-medium text-indigo-800">
                                Por Recoger
                              </div>
                              <div className="text-base font-mono font-semibold text-indigo-700 tabular-nums">
                                {formatInt(pendingPickupQty)}
                              </div>
                            </div>
                          </div>

                          {/* Warehouse Breakdown */}
                          {prodBalances.length > 0 ? (
                            <div className="pt-2 border-t border-slate-100 space-y-1 text-xs">
                              <div className="text-[11px] font-medium text-slate-500">
                                Ubicación actual del stock:
                              </div>
                              {prodBalances.map((b) => {
                                const wh = data.warehouses.find((w) => w.id === b.warehouseId);
                                const loc = data.locations.find((l) => l.id === b.locationId);
                                return (
                                  <div
                                    key={b.id}
                                    className="flex items-center justify-between text-slate-700 py-0.5"
                                  >
                                    <span className="truncate pr-2">
                                      <strong>{wh?.name}</strong> ({loc?.zoneName}) ·{' '}
                                      <span className="text-slate-500">
                                        {translateStatus(b.status)}
                                      </span>
                                    </span>
                                    <span className="font-mono font-bold text-slate-900 tabular-nums shrink-0">
                                      {formatInt(b.quantity)} u.
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="pt-2 border-t border-slate-100 text-xs text-slate-400">
                              Sin existencias registradas todavía (0 unidades).
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Card Footer Actions: Add Stock, Edit, Delete */}
                      <div className="px-4 py-3 bg-slate-50/80 border-t border-slate-200/80 flex items-center justify-between gap-2">
                        <motion.button
                          whileTap={{ scale: 0.96 }}
                          type="button"
                          onClick={() => {
                            setQuickStockProduct(product);
                            setQuickStockQty(500);
                            setQuickStockWhId(data.warehouses[0]?.id || 0);
                          }}
                          className="px-3.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
                        >
                          <ArrowDownToLine className="w-3.5 h-3.5" />
                          Ingresar Stock
                        </motion.button>

                        {isAdmin && (
                          <div className="flex items-center gap-1.5">
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              type="button"
                              onClick={() => openEditProductModal(product)}
                              className="px-3 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl flex items-center gap-1.5 cursor-pointer"
                              title="Editar producto"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              Editar
                            </motion.button>
                            <motion.button
                              whileTap={{ scale: 0.95 }}
                              type="button"
                              onClick={() => setDeleteConfirmProduct(product)}
                              className="p-2 text-red-600 bg-white border border-red-200 hover:bg-red-50 rounded-xl cursor-pointer"
                              title="Eliminar producto"
                            >
                              <Trash2 className="w-4 h-4" />
                            </motion.button>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUBVIEW 2: GESTOR DE CLASIFICACIONES / DEPARTAMENTOS                  */}
      {/* ===================================================================== */}
      {subView === 'CATEGORIES' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Clasificaciones y Departamentos de Productos
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Crea, edita o elimina los departamentos de tu inventario (por ejemplo:{' '}
                <strong>Empaques</strong>, <strong>Cases</strong>, <strong>Chips UDP</strong>,{' '}
                <strong>Memorias microSD</strong>, <strong>Adaptadores</strong> o nuevos
                departamentos).
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={openCreateCategoryModal}
                className="px-4 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Nueva Clasificación / Departamento
              </button>
            )}
          </div>

          {data.categories.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-2xl border border-slate-200 p-12 text-center max-w-xl mx-auto my-4 space-y-4 shadow-2xs"
            >
              <div className="w-14 h-14 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto">
                <FolderKanban className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  Sin clasificaciones registradas
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Todas las clasificaciones anteriores fueron eliminadas. Crea tus propios departamentos personalizados (ej. Empaques, Cases, Memorias, etc.).
                </p>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={openCreateCategoryModal}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl inline-flex items-center gap-2 cursor-pointer shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  Crear Primera Clasificación
                </button>
              )}
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <AnimatePresence mode="popLayout">
                {data.categories.map((cat) => {
                  const countProds = data.products.filter((p) => p.family === cat.name).length;
                  const CatIcon = getDepartmentIcon(cat.name, cat.accountingType);
                  return (
                    <motion.div
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.16 }}
                      key={cat.id}
                      className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between gap-4 shadow-2xs hover:shadow-md transition-shadow"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                              <CatIcon className="w-5 h-5" />
                            </div>
                            <h3 className="text-base font-bold text-slate-900">{cat.name}</h3>
                          </div>
                          <span className="text-xs font-mono font-semibold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-lg">
                            {countProds} prod.
                          </span>
                        </div>
                        <div className="text-xs font-medium text-sky-700 mt-2.5">
                          {translateAccountingType(cat.accountingType)}
                        </div>
                        {cat.description && (
                          <p className="text-xs text-slate-600 mt-1.5">{cat.description}</p>
                        )}
                      </div>

                      {isAdmin && (
                        <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => openEditCategoryModal(cat)}
                            className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCategory(cat)}
                            className="px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-xl flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Eliminar
                          </button>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUBVIEW 3: CONFIGURACIÓN DE ALMACENES Y UBICACIONES                   */}
      {/* ===================================================================== */}
      {subView === 'WAREHOUSES' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Gestión de Almacenes y Estantes
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Crea nuevos almacenes o elimina almacenes existentes con confirmación deslizante de seguridad.
              </p>
            </div>
            <div className="text-xs font-mono font-semibold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg">
              {data.warehouses.length} almacenes activos
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {data.warehouses.map((w) => {
              const locs = data.locations.filter((l) => l.warehouseId === w.id);
              const stockInWh = data.balances
                .filter((b) => b.warehouseId === w.id)
                .reduce((acc, b) => acc + b.quantity, 0);

              return (
                <div
                  key={w.id}
                  className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col justify-between gap-4 shadow-xs"
                >
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-mono font-bold text-slate-800">{w.code}</span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium">
                        {w.isProductionPlant ? 'Planta / Taller Producción' : 'Almacén Físico'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <h3 className="text-base font-bold text-slate-900">{w.name}</h3>
                      <span className="text-xs font-mono font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                        {formatInt(stockInWh)} uds.
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{w.description}</p>
                    {w.address && (
                      <p className="text-[11px] text-slate-400 mt-0.5">📍 {w.address}</p>
                    )}

                    <div className="mt-4 pt-3 border-t border-slate-100">
                      <div className="text-xs font-semibold text-slate-700 mb-2">
                        Secciones / Estantes ({locs.length}):
                      </div>
                      <ul className="space-y-1.5 text-xs">
                        {locs.map((l) => (
                          <li
                            key={l.id}
                            className="p-2 bg-slate-50 rounded-lg border border-slate-100 flex items-center justify-between gap-2"
                          >
                            <span className="truncate">
                              {l.zoneName} › <strong>{l.shelfName}</strong>
                            </span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="font-mono text-[10px] text-slate-400">{l.code}</span>
                              {isAdmin && locs.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteLocation(l.id, l.shelfName)}
                                  title="Eliminar estante"
                                  className="p-1 text-slate-400 hover:text-red-600 rounded cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {isAdmin && (
                    <div className="pt-3 border-t border-slate-100 flex justify-end">
                      <button
                        type="button"
                        onClick={() => openDeleteWarehouseModal(w)}
                        className="w-full py-2 px-3 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Eliminar Almacén...
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {isAdmin && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <form
                onSubmit={handleCreateWarehouse}
                className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
              >
                <h3 className="text-sm font-bold text-slate-900">Crear Nuevo Almacén</h3>
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Nombre del Almacén
                    </label>
                    <input
                      type="text"
                      value={whName}
                      onChange={(e) => setWhName(e.target.value)}
                      placeholder="Ej. Almacén Central / Planta 2"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Dirección o Referencia
                    </label>
                    <input
                      type="text"
                      value={whAddress}
                      onChange={(e) => setWhAddress(e.target.value)}
                      placeholder="Ubicación física"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <label className="flex items-center gap-2 font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={whIsPlant}
                      onChange={(e) => setWhIsPlant(e.target.checked)}
                    />
                    Este almacén funciona como Taller de Producción / Ensamblaje
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={submitting || !isOnline}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
                >
                  Guardar Almacén
                </button>
              </form>

              <form
                onSubmit={handleCreateLocation}
                className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
              >
                <h3 className="text-sm font-bold text-slate-900">
                  Agregar Sección / Estante a un Almacén
                </h3>
                <div className="space-y-3 text-xs">
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">Almacén</label>
                    <select
                      value={locWhId}
                      onChange={(e) => setLocWhId(Number(e.target.value))}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 bg-white"
                    >
                      {data.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Sección o Cuarto (Ej. Sección K / Cuarto de Empaques)
                    </label>
                    <input
                      type="text"
                      value={locZone}
                      onChange={(e) => setLocZone(e.target.value)}
                      placeholder="Sección K"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block font-medium text-slate-700 mb-1">
                      Estante o Casillero (Ej. Estante 2)
                    </label>
                    <input
                      type="text"
                      value={locShelf}
                      onChange={(e) => setLocShelf(e.target.value)}
                      placeholder="Estante 2"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2"
                      required
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitting || !isOnline}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800"
                >
                  Agregar Ubicación
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL SIMPLIFICADO: CREAR O EDITAR PRODUCTO (Solo 5 Campos Claros)    */}
      {/* ===================================================================== */}
      {productModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 space-y-5 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingProduct ? 'Editar Producto' : 'Crear Nuevo Producto'}
              </h3>
              <button
                type="button"
                onClick={() => setProductModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  1. SKU / Código del Producto *
                </label>
                <input
                  type="text"
                  value={prodSku}
                  onChange={(e) => setProdSku(e.target.value.toUpperCase())}
                  placeholder="Ej. UDP-8GB, CASE-HP-METAL, EMP-HP-8G"
                  className="w-full text-sm font-mono border border-slate-300 rounded-lg px-3 py-2.5"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  2. Descripción del Producto *
                </label>
                <input
                  type="text"
                  value={prodDescription}
                  onChange={(e) => setProdDescription(e.target.value)}
                  placeholder="Ej. Case Metálico HP 8GB / Empaque Blíster HP 8GB"
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  3. Clasificación / Departamento *
                </label>
                {data.categories.length > 0 ? (
                  <select
                    value={prodCategoryName}
                    onChange={(e) => setProdCategoryName(e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5 bg-white"
                  >
                    {data.categories.map((cat) => (
                      <option key={cat.id} value={cat.name}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={prodCategoryName}
                    onChange={(e) => setProdCategoryName(e.target.value)}
                    placeholder="Escribe el departamento (ej. Empaques, Cases...)"
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5"
                    required
                  />
                )}
              </div>

              {/* Initial Quantity only when creating a new product */}
              {!editingProduct && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-slate-50 rounded-lg border border-slate-200">
                  <div>
                    <label className="block font-semibold text-slate-800 mb-1">
                      4. Cantidad Inicial (Opcional)
                    </label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={prodInitialQty}
                      onChange={(e) =>
                        setProdInitialQty(Math.max(0, parseInt(e.target.value || '0', 10)))
                      }
                      className="w-full text-sm font-mono font-bold border border-slate-300 rounded-lg px-3 py-2 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-800 mb-1">
                      Almacén donde se encuentra
                    </label>
                    <select
                      value={prodInitialWhId}
                      onChange={(e) => setProdInitialWhId(Number(e.target.value))}
                      className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
                    >
                      {data.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-800 mb-1.5">
                  {editingProduct ? '4. Fotografía del Producto' : '5. Fotografía del Producto'}
                </label>
                <div className="flex items-center gap-4">
                  <label className="px-4 py-2.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg cursor-pointer flex items-center gap-2 border border-slate-300">
                    <Camera className="w-4 h-4" />
                    Subir Foto o Tomar con Cámara
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                  </label>
                  {prodImageUrl && (
                    <img
                      src={prodImageUrl}
                      alt="Vista previa"
                      className="w-20 h-14 object-cover rounded-lg border border-slate-300"
                    />
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setProductModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || !isOnline}
                  className="px-5 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg"
                >
                  {submitting
                    ? 'Guardando...'
                    : editingProduct
                    ? 'Guardar Cambios'
                    : 'Crear Producto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: INGRESO RÁPIDO DE STOCK PARA UN PRODUCTO                       */}
      {/* ===================================================================== */}
      {quickStockProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <span className="text-xs font-mono font-bold text-sky-700">
                  {quickStockProduct.sku}
                </span>
                <h3 className="text-base font-bold text-slate-900">
                  Ingresar Mercancía: {quickStockProduct.name}
                </h3>
              </div>
              <button
                onClick={() => setQuickStockProduct(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmQuickStock} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Cantidad a Ingresar (Unidades) *
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={quickStockQty}
                  onChange={(e) =>
                    setQuickStockQty(Math.max(1, parseInt(e.target.value || '0', 10)))
                  }
                  className="w-full text-base font-mono font-bold border border-slate-300 rounded-lg px-3 py-2"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Almacén de Destino *
                </label>
                <select
                  value={quickStockWhId}
                  onChange={(e) => setQuickStockWhId(Number(e.target.value))}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
                >
                  {data.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Proveedor / Referencia (Opcional)
                </label>
                <input
                  type="text"
                  value={quickStockSupplier}
                  onChange={(e) => setQuickStockSupplier(e.target.value)}
                  placeholder="Ej. Contenedor #10 / Compra Local"
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                />
              </div>

              {canViewCosts && (
                <div className="pt-2 border-t border-slate-200 space-y-2">
                  <label className="flex items-center gap-2 font-semibold text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={quickIncludeCost}
                      onChange={(e) => setQuickIncludeCost(e.target.checked)}
                    />
                    Agregar Costo Privado de Compra (Solo visible para Administrador)
                  </label>
                  {quickIncludeCost && (
                    <div className="grid grid-cols-3 gap-2 pt-1">
                      <div>
                        <label className="block text-[11px] text-slate-500">FOB Total ($)</label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={quickFobCost}
                          onChange={(e) => setQuickFobCost(Number(e.target.value))}
                          className="w-full font-mono border border-slate-300 rounded px-2 py-1"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500">Flete ($)</label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={quickFreightCost}
                          onChange={(e) => setQuickFreightCost(Number(e.target.value))}
                          className="w-full font-mono border border-slate-300 rounded px-2 py-1"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-500">Póliza ($)</label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={quickCustomsCost}
                          onChange={(e) => setQuickCustomsCost(Number(e.target.value))}
                          className="w-full font-mono border border-slate-300 rounded px-2 py-1"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setQuickStockProduct(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || !isOnline}
                  className="px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                >
                  {submitting ? 'Confirmando...' : 'Confirmar Ingreso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: CREAR O EDITAR CLASIFICACIÓN / DEPARTAMENTO                    */}
      {/* ===================================================================== */}
      {catModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingCategory
                  ? 'Editar Clasificación / Departamento'
                  : 'Nueva Clasificación / Departamento'}
              </h3>
              <button
                onClick={() => setCatModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCategory} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Nombre de la Clasificación / Departamento *
                </label>
                <input
                  type="text"
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="Ej. Empaques, Cases, Chips UDP, Blísteres..."
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Comportamiento en Producción y Stock *
                </label>
                <select
                  value={catAccType}
                  onChange={(e) => setCatAccType(e.target.value as any)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2.5 bg-white"
                >
                  <option value="SECONDARY_COMPONENT">
                    Insumo / Componente de Taller (Ej. Cases, Accesorios)
                  </option>
                  <option value="PACKAGING_KIT">
                    Empaque / Blíster (Se descuenta al fabricar)
                  </option>
                  <option value="STRATEGIC_COMPONENT">
                    Componente Principal por Orden (Ej. Chips UDP, Memorias microSD)
                  </option>
                  <option value="UNIVERSAL_ACCESSORY">
                    Accesorio Universal (Ej. Adaptador SD)
                  </option>
                  <option value="FINISHED_GOOD">
                    Producto Terminado Final (Ej. USB o microSD empaquetada)
                  </option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Descripción Breve (Opcional)
                </label>
                <input
                  type="text"
                  value={catDescription}
                  onChange={(e) => setCatDescription(e.target.value)}
                  placeholder="Descripción del departamento"
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setCatModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || !isOnline}
                  className="px-5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg"
                >
                  Guardar Clasificación
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: CONFIRMAR ELIMINACIÓN DE PRODUCTO                              */}
      {/* ===================================================================== */}
      {deleteConfirmProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <h3 className="text-base font-bold text-slate-900">
              ¿Eliminar el producto "{deleteConfirmProduct.name}"?
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Se eliminará el SKU <strong>{deleteConfirmProduct.sku}</strong> y sus saldos asociados
              del catálogo.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmProduct(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleDeleteProduct(deleteConfirmProduct)}
                className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg"
              >
                {submitting ? 'Eliminando...' : 'Sí, Eliminar Producto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: AMPLIAR FOTOGRAFÍA                                             */}
      {/* ===================================================================== */}
      {zoomPhotoProduct && (
        <div
          className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
          onClick={() => setZoomPhotoProduct(null)}
        >
          <div
            className="bg-white rounded-xl max-w-lg w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono text-xs font-bold text-sky-700">
                  SKU: {zoomPhotoProduct.sku} · {zoomPhotoProduct.family}
                </span>
                <h3 className="text-base font-bold text-slate-900">{zoomPhotoProduct.name}</h3>
              </div>
              <button
                onClick={() => setZoomPhotoProduct(null)}
                className="p-1 text-slate-500 hover:text-slate-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <img
              src={zoomPhotoProduct.imageUrl}
              alt={zoomPhotoProduct.name}
              referrerPolicy="no-referrer"
              className="w-full h-72 object-contain bg-slate-950 rounded-lg border border-slate-200"
            />
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL ESTILO IPHONE: DESLIZAR PARA CONFIRMAR ELIMINACIÓN DE ALMACÉN   */}
      {/* ===================================================================== */}
      {warehouseToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-red-200">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-red-600">
                    Confirmación de Seguridad
                  </span>
                  <h3 className="text-lg font-bold text-slate-900 leading-tight">
                    Eliminar Almacén "{warehouseToDelete.name}"
                  </h3>
                </div>
              </div>
              <button
                type="button"
                disabled={deletingWarehouse}
                onClick={() => {
                  setWarehouseToDelete(null);
                  setSlideProgress(0);
                }}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {(() => {
              const totalUnits = data.balances
                .filter((b) => b.warehouseId === warehouseToDelete.id)
                .reduce((acc, b) => acc + b.quantity, 0);
              const totalLocs = data.locations.filter(
                (l) => l.warehouseId === warehouseToDelete.id
              ).length;

              return (
                <div className="p-4 rounded-xl bg-red-50 border border-red-200 space-y-2 text-xs text-red-950">
                  <p className="font-bold text-red-800">
                    ⚠️ Atención: Esta acción es irreversible
                  </p>
                  <p className="leading-relaxed text-red-900/90">
                    Al eliminar el almacén <strong>{warehouseToDelete.name}</strong> ({warehouseToDelete.code}), se borrarán sus{' '}
                    <strong>{totalLocs} secciones/estantes</strong> y se perderán las{' '}
                    <strong>{formatInt(totalUnits)} unidades de productos</strong> registradas en él.
                  </p>
                </div>
              );
            })()}

            {/* iPhone-style Slide to Unlock / Confirm Track */}
            <div className="space-y-2 pt-1">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 text-center">
                Desliza el botón rojo hasta el final para confirmar
              </label>

              <div className="relative h-14 w-full rounded-full bg-slate-900 border-2 border-red-500/40 p-1.5 overflow-hidden select-none shadow-inner">
                {/* Red fill behind thumb */}
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-red-700 to-red-600 transition-all duration-75"
                  style={{ width: `${Math.max(slideProgress, 12)}%`, opacity: 0.45 }}
                />

                {/* Center instruction text */}
                <div className="relative z-10 h-full flex items-center justify-center pointer-events-none px-12">
                  <span
                    className="text-xs font-bold tracking-wide text-white transition-opacity"
                    style={{ opacity: Math.max(0.15, 1 - slideProgress / 75) }}
                  >
                    {deletingWarehouse
                      ? 'Eliminando almacén...'
                      : 'Deslizar para eliminar almacén →'}
                  </span>
                </div>

                {/* Visual Draggable Thumb */}
                <div
                  className="absolute top-1.5 bottom-1.5 w-11 rounded-full bg-red-600 text-white shadow-lg flex items-center justify-center pointer-events-none transition-all duration-75"
                  style={{
                    left: `calc(6px + (100% - 56px) * ${slideProgress / 100})`,
                  }}
                >
                  <ChevronsRight className="w-5 h-5" />
                </div>

                {/* Native Touch/Mouse Range Input Overlay */}
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={slideProgress}
                  disabled={deletingWarehouse}
                  onChange={(e) => handleSlideChange(Number(e.target.value))}
                  onTouchEnd={handleSlideRelease}
                  onMouseUp={handleSlideRelease}
                  onKeyUp={handleSlideRelease}
                  aria-label="Deslizar para confirmar eliminación de almacén"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-grab active:cursor-grabbing z-20"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                disabled={deletingWarehouse}
                onClick={() => {
                  setWarehouseToDelete(null);
                  setSlideProgress(0);
                }}
                className="w-full py-2.5 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
              >
                Cancelar y Conservar Almacén
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
