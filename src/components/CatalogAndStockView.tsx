import React, { useState, useEffect } from 'react';
import {
  Package,
  Search,
  Plus,
  Edit3,
  Trash2,
  Camera,
  FolderKanban,
  ArrowDownToLine,
  ArrowUpFromLine,
  Eye,
  History,
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
  Factory,
  FileCheck2,
  LayoutGrid,
  List,
  ArrowRight,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  WorkspaceData,
  Product,
  ProductCategory,
  Warehouse,
  MovementVoucherData,
  formatInt,
  formatBoliviaDateTime,
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
  initialSubView?: 'SUMMARY' | 'PRODUCTS' | 'CATEGORIES' | 'WAREHOUSES';
  preselectedWithdrawOrderId?: number | null;
  onClearPreselectedOrder?: () => void;
  onNavigateToModule?: (
    module:
      | 'SUMMARY'
      | 'STOCK_CATALOG'
      | 'PRODUCTION_ORDERS'
      | 'PICKUPS_DELIVERIES'
      | 'KARDEX_REPORTS'
      | 'WAREHOUSES_LOCATIONS',
    options?: { productId?: number; orderId?: number }
  ) => void;
  apiFetch: (url: string, options?: RequestInit) => Promise<any>;
  onRefresh: () => Promise<void>;
}

export function CatalogAndStockView({
  data,
  isOnline,
  initialSubView = 'PRODUCTS',
  preselectedWithdrawOrderId,
  onClearPreselectedOrder,
  onNavigateToModule,
  apiFetch,
  onRefresh,
}: Props) {
  const [subView, setSubView] = useState<'SUMMARY' | 'PRODUCTS' | 'CATEGORIES' | 'WAREHOUSES'>(
    initialSubView
  );

  useEffect(() => {
    setSubView(initialSubView);
  }, [initialSubView]);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | 'ALL'>('ALL');
  const [selectedCapacity, setSelectedCapacity] = useState<string>('ALL');
  const [viewMode, setViewMode] = useState<'CARDS' | 'TABLE'>('CARDS');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);

  // Voucher Receipt Modal State
  const [voucherData, setVoucherData] = useState<MovementVoucherData | null>(null);

  // Product Detail Modal State
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);

  // =========================================================================
  // 1. PRODUCT CATALOG MODAL STATE (Create & Edit)
  // =========================================================================
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [prodSku, setProdSku] = useState('');
  const [prodDescription, setProdDescription] = useState('');
  const [prodCategoryName, setProdCategoryName] = useState(data.categories[0]?.name || 'Empaques');
  const [prodBrand, setProdBrand] = useState('');
  const [prodModel, setProdModel] = useState('');
  const [prodCapacity, setProdCapacity] = useState('N/A');
  const [prodInitialQty, setProdInitialQty] = useState<number>(0);
  const [prodInitialWhId, setProdInitialWhId] = useState<number>(data.warehouses[0]?.id || 0);
  const [prodImageUrl, setProdImageUrl] = useState('');
  const [deleteConfirmProduct, setDeleteConfirmProduct] = useState<Product | null>(null);
  const [zoomPhotoProduct, setZoomPhotoProduct] = useState<Product | null>(null);

  // =========================================================================
  // 2. MODAL "INGRESAR" STOCK STATE
  // =========================================================================
  const [ingresoProduct, setIngresoProduct] = useState<Product | null>(null);
  const [ingresoWhId, setIngresoWhId] = useState<number>(data.warehouses[0]?.id || 0);
  const [ingresoLocId, setIngresoLocId] = useState<number>(0);
  const [ingresoQty, setIngresoQty] = useState<number>(1000);
  const [ingresoMovementType, setIngresoMovementType] = useState<
    'INGRESO_PROVEEDOR' | 'DEVOLUCION_INSUMOS' | 'REGULARIZACION_AUTORIZADA'
  >('INGRESO_PROVEEDOR');
  const [ingresoSupplier, setIngresoSupplier] = useState('');
  const [ingresoNotes, setIngresoNotes] = useState('');
  const [ingresoIncludeCost, setIngresoIncludeCost] = useState(false);
  const [ingresoFobCost, setIngresoFobCost] = useState<number>(0);
  const [ingresoFreightCost, setIngresoFreightCost] = useState<number>(0);
  const [ingresoCustomsCost, setIngresoCustomsCost] = useState<number>(0);

  // =========================================================================
  // 3. MODAL "RETIRAR" STOCK STATE
  // =========================================================================
  const [retiroProduct, setRetiroProduct] = useState<Product | null>(null);
  const [retiroWhId, setRetiroWhId] = useState<number>(data.warehouses[0]?.id || 0);
  const [retiroLocId, setRetiroLocId] = useState<number>(0);
  const [retiroQty, setRetiroQty] = useState<number>(500);
  const [retiroMode, setRetiroMode] = useState<
    'ORDEN_PRODUCCION' | 'CONSUMO_OPERATIVO' | 'TRANSFERENCIA_ALMACEN' | 'MERMA_DANO'
  >('ORDEN_PRODUCCION');
  const [retiroOrderId, setRetiroOrderId] = useState<number>(0);
  const [retiroTargetUse, setRetiroTargetUse] = useState('');
  const [retiroReason, setRetiroReason] = useState('');
  const [retiroNotes, setRetiroNotes] = useState('');
  const [retiroDestWhId, setRetiroDestWhId] = useState<number>(
    data.allWarehousesSummary[1]?.id || data.warehouses[0]?.id || 0
  );

  // =========================================================================
  // 4. CLASSIFICATIONS / DEPARTMENTS CRUD STATE
  // =========================================================================
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);
  const [catName, setCatName] = useState('');
  const [catAccType, setCatAccType] = useState<ProductCategory['accountingType']>(
    'SECONDARY_COMPONENT'
  );
  const [catDescription, setCatDescription] = useState('');

  // =========================================================================
  // 5. WAREHOUSES & LOCATIONS CRUD STATE + IPHONE SLIDE-TO-DELETE
  // =========================================================================
  const [whName, setWhName] = useState('');
  const [whAddress, setWhAddress] = useState('');
  const [whIsPlant, setWhIsPlant] = useState(false);
  const [locWhId, setLocWhId] = useState<number>(data.warehouses[0]?.id || 0);
  const [locZone, setLocZone] = useState('');
  const [locShelf, setLocShelf] = useState('');

  const [warehouseToDelete, setWarehouseToDelete] = useState<Warehouse | null>(null);
  const [slideProgress, setSlideProgress] = useState<number>(0);
  const [deletingWarehouse, setDeletingWarehouse] = useState<boolean>(false);

  const isAdmin = data.user.role === 'OWNER' || data.user.role === 'ADMIN';
  const canCreateCatalog =
    isAdmin || data.user.warehousePermissions.some((p) => p.canApproveAdjustments);
  const canReceive =
    isAdmin || data.user.warehousePermissions.some((p) => p.canReceive);
  const canDispatch =
    isAdmin || data.user.warehousePermissions.some((p) => p.canDispatch);
  const canViewCosts = data.user.role === 'OWNER' || data.user.canViewPrivateCosts;

  const openOrders = data.productionOrders.filter(
    (o) => o.status !== 'CLOSED' && o.status !== 'CANCELLED'
  );

  const [showChangeIngresoLoc, setShowChangeIngresoLoc] = useState(false);
  const [showChangeRetiroLoc, setShowChangeRetiroLoc] = useState(false);

  // Open Ingresar Modal helper (auto-detects product's current warehouse/location)
  const openIngresarModal = (prod: Product) => {
    const existingBals = data.balances
      .filter((b) => b.productId === prod.id && b.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity);
    const bestBal = existingBals[0];

    const whId =
      selectedWarehouseId !== 'ALL'
        ? selectedWarehouseId
        : bestBal?.warehouseId || data.warehouses[0]?.id || 0;
    const locId =
      bestBal && bestBal.warehouseId === whId
        ? bestBal.locationId
        : data.locations.find((l) => l.warehouseId === whId)?.id ||
          data.locations[0]?.id ||
          0;

    setIngresoProduct(prod);
    setIngresoWhId(whId);
    setIngresoLocId(locId);
    setIngresoQty(1000);
    setIngresoMovementType('INGRESO_PROVEEDOR');
    setIngresoSupplier('');
    setIngresoNotes('');
    setIngresoIncludeCost(false);
    setShowChangeIngresoLoc(false);
  };

  // Open Retirar Modal helper (100% pre-determined location & direct discount)
  const openRetirarModal = (prod: Product) => {
    const prodAvailBalances = data.balances.filter(
      (b) => b.productId === prod.id && b.status === 'AVAILABLE' && b.quantity > 0
    );
    const bestBalance = prodAvailBalances.sort((a, b) => b.quantity - a.quantity)[0];
    const whId =
      selectedWarehouseId !== 'ALL'
        ? selectedWarehouseId
        : bestBalance?.warehouseId || data.warehouses[0]?.id || 0;
    const locId =
      bestBalance && bestBalance.warehouseId === whId
        ? bestBalance.locationId
        : data.locations.find((l) => l.warehouseId === whId)?.id ||
          data.locations[0]?.id ||
          0;

    const currentAvail =
      data.balances
        .filter(
          (b) =>
            b.productId === prod.id &&
            b.warehouseId === whId &&
            b.locationId === locId &&
            b.status === 'AVAILABLE'
        )
        .reduce((s, b) => s + b.quantity, 0) || 0;

    setRetiroProduct(prod);
    setRetiroWhId(whId);
    setRetiroLocId(locId);
    setRetiroQty(currentAvail > 0 ? Math.min(500, currentAvail) : 100);
    setRetiroMode('CONSUMO_OPERATIVO');
    setRetiroOrderId(0);
    setRetiroTargetUse('');
    setRetiroReason('');
    setRetiroNotes('');
    setShowChangeRetiroLoc(false);
  };

  const openCreateProductModal = () => {
    setEditingProduct(null);
    setProdSku('');
    setProdDescription('');
    setProdCategoryName(data.categories[0]?.name || 'Empaques');
    setProdBrand('');
    setProdModel('');
    setProdCapacity('N/A');
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
    setProdBrand(prod.brand || '');
    setProdModel(prod.model || '');
    setProdCapacity(prod.capacity || 'N/A');
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
            brand: prodBrand || prodCategoryName,
            model: prodModel || 'Estándar',
            capacity: prodCapacity || 'N/A',
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
            brand: prodBrand || prodCategoryName,
            model: prodModel || 'Estándar',
            capacity: prodCapacity || 'N/A',
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

  // =========================================================================
  // HANDLER: CONFIRMAR INGRESO DE STOCK
  // =========================================================================
  const handleConfirmIngreso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || !ingresoProduct) return;
    if (!Number.isInteger(ingresoQty) || ingresoQty <= 0) {
      setFeedback({
        type: 'error',
        text: 'La cantidad a ingresar debe ser un número entero positivo mayor a cero.',
      });
      return;
    }

    const loc =
      data.locations.find((l) => l.id === ingresoLocId && l.warehouseId === ingresoWhId) ||
      data.locations.find((l) => l.warehouseId === ingresoWhId) ||
      data.locations[0];

    if (!loc) {
      setFeedback({ type: 'error', text: 'Seleccione un almacén con ubicación activa.' });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      const reasonLabel =
        ingresoMovementType === 'DEVOLUCION_INSUMOS'
          ? 'Devolución de insumos no utilizados'
          : ingresoMovementType === 'REGULARIZACION_AUTORIZADA'
          ? 'Regularización autorizada'
          : 'Recepción de mercancía';

      const res = await apiFetch('/api/inventory/receipts', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `ING-${ingresoProduct.id}-${Date.now()}`,
          movementType: ingresoMovementType,
          warehouseId: ingresoWhId,
          locationId: loc.id,
          supplierOrContainer: ingresoSupplier || reasonLabel,
          reason: reasonLabel,
          notes: ingresoNotes || `Ingreso de ${ingresoProduct.name}`,
          lines: [
            {
              productId: ingresoProduct.id,
              quantity: ingresoQty,
              privateCost:
                canViewCosts && ingresoIncludeCost
                  ? {
                      fobTotalCost: ingresoFobCost,
                      freightCost: ingresoFreightCost,
                      customsPolicyCost: ingresoCustomsCost,
                      otherImportExpenses: 0,
                      currency: 'USD',
                    }
                  : undefined,
            },
          ],
        }),
      });

      const whNameStr =
        data.warehouses.find((w) => w.id === ingresoWhId)?.name || 'Almacén';

      setVoucherData({
        folio: res.folio,
        operationTitle: 'Comprobante de Ingreso de Inventario',
        operationType: 'INGRESO',
        serverTimestamp: res.serverTimestamp || new Date().toISOString(),
        userFullName: data.user.fullName,
        productSku: ingresoProduct.sku,
        productName: ingresoProduct.name,
        productImageUrl: ingresoProduct.imageUrl,
        warehouseName: whNameStr,
        locationName: `${loc.zoneName} · ${loc.shelfName}`,
        reason: `${reasonLabel}${ingresoSupplier ? ` (${ingresoSupplier})` : ''}`,
        notes: ingresoNotes,
        stockBefore: res.stockBefore ?? 0,
        quantityChanged: ingresoQty,
        stockAfter: res.stockAfter ?? ingresoQty,
      });

      setIngresoProduct(null);
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  // =========================================================================
  // HANDLER: CONFIRMAR RETIRO DE STOCK
  // =========================================================================
  const handleConfirmRetiro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || !retiroProduct) return;
    if (!Number.isInteger(retiroQty) || retiroQty <= 0) {
      setFeedback({
        type: 'error',
        text: 'La cantidad a retirar debe ser un número entero positivo mayor a cero.',
      });
      return;
    }

    const loc =
      data.locations.find((l) => l.id === retiroLocId && l.warehouseId === retiroWhId) ||
      data.locations.find((l) => l.warehouseId === retiroWhId) ||
      data.locations[0];

    if (!loc) {
      setFeedback({ type: 'error', text: 'Seleccione un almacén con ubicación válida.' });
      return;
    }

    if (retiroMode === 'ORDEN_PRODUCCION' && !retiroOrderId) {
      setFeedback({
        type: 'error',
        text: 'Debe seleccionar una Orden de Producción activa para vincular este retiro de insumos.',
      });
      return;
    }

    const destLoc =
      data.allLocationsSummary.find((l) => l.warehouseId === retiroDestWhId) || loc;

    setSubmitting(true);
    setFeedback(null);
    try {
      const selectedOrder = data.productionOrders.find((o) => o.id === retiroOrderId);
      const effectiveReason =
        retiroReason.trim() ||
        retiroNotes.trim() ||
        (retiroMode === 'ORDEN_PRODUCCION'
          ? `Insumo retirado para Orden ${selectedOrder?.orderNumber || ''}`
          : `Retiro de ${retiroProduct.name}`);

      const res = await apiFetch('/api/inventory/withdrawals', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `RET-${retiroProduct.id}-${Date.now()}`,
          warehouseId: retiroWhId,
          locationId: loc.id,
          productId: retiroProduct.id,
          quantity: retiroQty,
          withdrawalMode: retiroMode,
          productionOrderId: retiroMode === 'ORDEN_PRODUCCION' ? retiroOrderId : undefined,
          toWarehouseId: retiroMode === 'TRANSFERENCIA_ALMACEN' ? retiroDestWhId : undefined,
          toLocationId: retiroMode === 'TRANSFERENCIA_ALMACEN' ? destLoc.id : undefined,
          recipientOrTarget:
            retiroTargetUse.trim() ||
            (selectedOrder ? `Orden ${selectedOrder.orderNumber}` : data.user.fullName),
          reason: effectiveReason,
          notes: retiroNotes.trim() || effectiveReason,
        }),
      });

      const whNameStr =
        data.warehouses.find((w) => w.id === retiroWhId)?.name || 'Almacén';

      setVoucherData({
        folio: res.folio,
        operationTitle:
          retiroMode === 'ORDEN_PRODUCCION'
            ? 'Comprobante de Retiro de Insumos para Producción'
            : retiroMode === 'TRANSFERENCIA_ALMACEN'
            ? 'Comprobante de Salida por Transferencia'
            : 'Comprobante de Retiro de Inventario',
        operationType: retiroMode === 'TRANSFERENCIA_ALMACEN' ? 'TRANSFERENCIA' : 'RETIRO',
        serverTimestamp: res.serverTimestamp || new Date().toISOString(),
        userFullName: data.user.fullName,
        productSku: retiroProduct.sku,
        productName: retiroProduct.name,
        productImageUrl: retiroProduct.imageUrl,
        warehouseName: whNameStr,
        locationName: `${loc.zoneName} · ${loc.shelfName}`,
        orderNumber: selectedOrder?.orderNumber || res.orderNumber || null,
        recipientOrTarget: retiroTargetUse,
        reason:
          retiroReason ||
          (selectedOrder
            ? `Retiro vinculado a Orden ${selectedOrder.orderNumber}`
            : 'Retiro confirmado'),
        notes: retiroNotes,
        stockBefore: res.stockBefore ?? 0,
        quantityChanged: retiroQty,
        stockAfter: res.stockAfter ?? 0,
      });

      setRetiroProduct(null);
      if (onClearPreselectedOrder) onClearPreselectedOrder();
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

  const capacitiesAvailable = Array.from(
    new Set(
      data.products
        .map((p) => p.capacity)
        .filter((c) => c && c !== 'N/A' && c.trim() !== '')
    )
  );

  const filteredProducts = data.products.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      p.sku.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      p.family.toLowerCase().includes(q) ||
      (p.brand && p.brand.toLowerCase().includes(q)) ||
      (p.model && p.model.toLowerCase().includes(q)) ||
      (p.capacity && p.capacity.toLowerCase().includes(q));
    const matchesCat = selectedCategory === 'ALL' || p.family === selectedCategory;
    const matchesCap = selectedCapacity === 'ALL' || p.capacity === selectedCapacity;
    return matchesSearch && matchesCat && matchesCap;
  });

  // Compute live preview for Ingreso Modal
  const ingresoCurrentAvail = ingresoProduct
    ? data.balances
        .filter(
          (b) =>
            b.productId === ingresoProduct.id &&
            b.warehouseId === ingresoWhId &&
            b.status === 'AVAILABLE'
        )
        .reduce((s, b) => s + b.quantity, 0)
    : 0;

  // Compute live preview for Retiro Modal
  const retiroCurrentAvail = retiroProduct
    ? data.balances
        .filter(
          (b) =>
            b.productId === retiroProduct.id &&
            b.warehouseId === retiroWhId &&
            (retiroLocId ? b.locationId === retiroLocId : true) &&
            b.status === 'AVAILABLE'
        )
        .reduce((s, b) => s + b.quantity, 0)
    : 0;

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
            className="text-xs font-semibold underline ml-4 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Banner if navigated from an Order to withdraw supplies */}
      {preselectedWithdrawOrderId && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-600 text-white flex items-center justify-center shrink-0">
              <ArrowUpFromLine className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-amber-800">
                Modo Retiro de Insumos para Orden de Producción
              </div>
              <div className="text-sm font-semibold text-slate-900">
                Haz clic en el botón <strong>"Retirar"</strong> de cualquier empaque, case o
                adaptador para vincularlo a la orden{' '}
                <span className="font-mono font-bold text-amber-900">
                  {data.productionOrders.find((o) => o.id === preselectedWithdrawOrderId)
                    ?.orderNumber || `#${preselectedWithdrawOrderId}`}
                </span>
                .
              </div>
            </div>
          </div>
          {onClearPreselectedOrder && (
            <button
              onClick={onClearPreselectedOrder}
              className="px-3 py-1.5 text-xs font-bold text-amber-900 bg-amber-200/70 hover:bg-amber-200 rounded-xl cursor-pointer"
            >
              Finalizar selección
            </button>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUBVIEW 0: RESUMEN OPERATIVO (TOTALES, ALERTAS Y ACCESOS RÁPIDOS)     */}
      {/* ===================================================================== */}
      {subView === 'SUMMARY' && (
        <div className="space-y-6">
          {(() => {
            const totalAvailable = data.balances
              .filter((b) => b.status === 'AVAILABLE')
              .reduce((s, b) => s + b.quantity, 0);
            const totalInProduction = data.balances
              .filter(
                (b) =>
                  b.status === 'IN_PRODUCTION_CUSTODY' ||
                  b.status === 'IN_TRANSIT_PRODUCTION' ||
                  b.status === 'RESERVED_ORDER'
              )
              .reduce((s, b) => s + b.quantity, 0);
            const totalPendingPickup = data.balances
              .filter(
                (b) =>
                  b.status === 'FINISHED_PENDING_PICKUP' ||
                  b.status === 'FINISHED_IN_TRANSIT'
              )
              .reduce((s, b) => s + b.quantity, 0);

            const lowStockProducts = data.products.filter((p) => {
              const avail = data.balances
                .filter((b) => b.productId === p.id && b.status === 'AVAILABLE')
                .reduce((s, b) => s + b.quantity, 0);
              return avail <= p.minStockAlert;
            });

            return (
              <>
                <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xs">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">
                      Resumen Operativo en Tiempo Real
                    </h2>
                    <p className="text-xs text-slate-600 mt-1">
                      Control exacto de stock disponible, componentes en órdenes de producción,
                      productos terminados por recoger y trazabilidad Kardex.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      onClick={() => setSubView('PRODUCTS')}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-2 cursor-pointer shadow-2xs"
                    >
                      <ArrowDownToLine className="w-4 h-4" />
                      Ingresar o Retirar Stock
                    </button>
                    {onNavigateToModule && (
                      <button
                        onClick={() => onNavigateToModule('PRODUCTION_ORDERS')}
                        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center gap-2 cursor-pointer shadow-2xs"
                      >
                        <Factory className="w-4 h-4" />
                        Órdenes de Producción ({openOrders.length})
                      </button>
                    )}
                  </div>
                </div>

                {/* 4 KPI Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase text-emerald-700">
                        Stock Disponible
                      </span>
                      <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                        <TrendingUp className="w-5 h-5" />
                      </div>
                    </div>
                    <div className="text-2xl font-mono font-bold text-slate-900 mt-2 tabular-nums">
                      {formatInt(totalAvailable)}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      Unidades libres en estantes para retiro o asignación
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase text-sky-700">
                        En Custodia de Producción
                      </span>
                      <div className="w-9 h-9 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center">
                        <Cpu className="w-5 h-5" />
                      </div>
                    </div>
                    <div className="text-2xl font-mono font-bold text-sky-700 mt-2 tabular-nums">
                      {formatInt(totalInProduction)}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      Componentes UDP / microSD en órdenes activas ({openOrders.length} OP)
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase text-indigo-700">
                        Terminados por Recoger
                      </span>
                      <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                        <PackageCheck className="w-5 h-5" />
                      </div>
                    </div>
                    <div className="text-2xl font-mono font-bold text-indigo-700 mt-2 tabular-nums">
                      {formatInt(totalPendingPickup)}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      Productos fabricados listos para entrega o recogida
                    </div>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase text-amber-700">
                        Catálogo y Almacenes
                      </span>
                      <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                        <Building2 className="w-5 h-5" />
                      </div>
                    </div>
                    <div className="text-2xl font-mono font-bold text-slate-900 mt-2 tabular-nums">
                      {formatInt(data.products.length)} SKUs · {data.warehouses.length} Alm.
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      {lowStockProducts.length} productos con stock bajo o en cero
                    </div>
                  </div>
                </div>

                {/* Stock Breakdown by Warehouse */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-900">
                        Estado de Almacenes Autorizados
                      </h3>
                      <button
                        onClick={() => setSubView('WAREHOUSES')}
                        className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                      >
                        Administrar almacenes →
                      </button>
                    </div>
                    <div className="space-y-3">
                      {data.warehouses.map((w) => {
                        const whAvail = data.balances
                          .filter((b) => b.warehouseId === w.id && b.status === 'AVAILABLE')
                          .reduce((s, b) => s + b.quantity, 0);
                        const whCustody = data.balances
                          .filter(
                            (b) =>
                              b.warehouseId === w.id &&
                              (b.status === 'IN_PRODUCTION_CUSTODY' ||
                                b.status === 'IN_TRANSIT_PRODUCTION')
                          )
                          .reduce((s, b) => s + b.quantity, 0);
                        const whPickup = data.balances
                          .filter(
                            (b) =>
                              b.warehouseId === w.id && b.status === 'FINISHED_PENDING_PICKUP'
                          )
                          .reduce((s, b) => s + b.quantity, 0);

                        return (
                          <div
                            key={w.id}
                            className="p-3.5 rounded-xl border border-slate-200/80 bg-slate-50/60 flex flex-wrap items-center justify-between gap-3"
                          >
                            <div>
                              <div className="text-sm font-bold text-slate-900 flex items-center gap-2">
                                {w.name}
                                {w.isProductionPlant && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 font-bold">
                                    PRODUCCIÓN
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-slate-500 font-mono">{w.code}</div>
                            </div>
                            <div className="flex items-center gap-4 text-xs">
                              <div className="text-right">
                                <div className="text-slate-500">Disponible</div>
                                <div className="font-mono font-bold text-emerald-700">
                                  {formatInt(whAvail)}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-slate-500">En OP</div>
                                <div className="font-mono font-bold text-sky-700">
                                  {formatInt(whCustody)}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-slate-500">Por Recoger</div>
                                <div className="font-mono font-bold text-indigo-700">
                                  {formatInt(whPickup)}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Recent Movements */}
                  <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-900">
                        Últimos Movimientos Registrados
                      </h3>
                      {onNavigateToModule && (
                        <button
                          onClick={() => onNavigateToModule('KARDEX_REPORTS')}
                          className="text-xs font-semibold text-blue-600 hover:underline cursor-pointer"
                        >
                          Ver Historial y Kardex completo →
                        </button>
                      )}
                    </div>
                    {data.movementLines.length === 0 ? (
                      <div className="py-8 text-center text-xs text-slate-400">
                        Aún no hay movimientos registrados. Usa los botones "Ingresar" o "Retirar"
                        en Inventario y Productos.
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {data.movementLines.slice(0, 5).map((line) => {
                          const doc = data.movementDocuments.find(
                            (d) => d.id === line.documentId
                          );
                          return (
                            <div
                              key={line.id}
                              className="p-3 rounded-xl border border-slate-100 bg-slate-50/70 flex items-center justify-between gap-3 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="font-bold text-slate-900 truncate">
                                  {line.historicalSku} — {line.historicalName}
                                </div>
                                <div className="text-slate-500 truncate">
                                  <span className="font-mono font-semibold text-slate-700">
                                    {doc?.folio}
                                  </span>{' '}
                                  · {doc?.reason || doc?.movementType}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="font-mono font-bold text-slate-900">
                                  {formatInt(line.quantity)} u.
                                </div>
                                <div className="text-[10px] text-slate-400 font-mono">
                                  {formatBoliviaDateTime(line.createdAt)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUBVIEW 1: INVENTARIO Y PRODUCTOS (CON BOTONES INGRESAR Y RETIRAR)    */}
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
            const totalPendingPickup = data.balances
              .filter(
                (b) =>
                  (b.status === 'FINISHED_PENDING_PICKUP' ||
                    b.status === 'FINISHED_IN_TRANSIT') &&
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
                      Productos en Catálogo
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
                      En Custodia / Orden
                    </div>
                    <div className="text-xl font-mono font-bold text-sky-700">
                      {formatInt(totalInProcess)}
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3.5 shadow-2xs">
                  <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                    <PackageCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-slate-500">
                      Terminado por Recoger
                    </div>
                    <div className="text-xl font-mono font-bold text-indigo-700">
                      {formatInt(totalPendingPickup)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Search, Warehouse, Capacity Filter & Actions Bar */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-2xs">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por SKU, nombre, marca, capacidad (ej. 8 GB) o categoría..."
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

              {capacitiesAvailable.length > 0 && (
                <select
                  value={selectedCapacity}
                  onChange={(e) => setSelectedCapacity(e.target.value)}
                  className="text-xs border border-slate-300 rounded-xl px-3 py-2.5 bg-white font-semibold text-slate-700 cursor-pointer"
                >
                  <option value="ALL">Todas las Capacidades</option>
                  {capacitiesAvailable.map((cap) => (
                    <option key={cap} value={cap}>
                      Capacidad: {cap}
                    </option>
                  ))}
                </select>
              )}

              {/* View Mode Toggle */}
              <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('CARDS')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer ${
                    viewMode === 'CARDS'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Vista en tarjetas con foto"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Tarjetas
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('TABLE')}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer ${
                    viewMode === 'TABLE'
                      ? 'bg-white text-slate-900 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  title="Vista en tabla compacta"
                >
                  <List className="w-3.5 h-3.5" />
                  Tabla
                </button>
              </div>

              {canCreateCatalog && (
                <>
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    type="button"
                    onClick={() => setSubView('WAREHOUSES')}
                    className="px-3.5 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Building2 className="w-4 h-4 text-slate-600" />
                    Almacenes ({data.warehouses.length})
                  </motion.button>

                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    type="button"
                    onClick={() => setSubView('CATEGORIES')}
                    className="px-3.5 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <FolderKanban className="w-4 h-4 text-slate-600" />
                    Departamentos ({data.categories.length})
                  </motion.button>

                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    type="button"
                    onClick={openCreateProductModal}
                    className="px-4 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-700 hover:to-sky-700 rounded-xl transition-all shadow-sm shadow-blue-600/20 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Nuevo Producto
                  </motion.button>
                </>
              )}
            </div>
          </div>

          {/* Interactive Classification Filter Tabs */}
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
                    ? 'Registra tus primeros componentes o productos (por ejemplo: Chips UDP, Cases, Empaques, Memorias microSD o USB Terminados) y usa los botones "Ingresar" y "Retirar" para gestionar existencias con trazabilidad completa.'
                    : 'Prueba cambiando el término de búsqueda o seleccionando otra categoría o almacén.'}
                </p>
              </div>
              {canCreateCatalog && (
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
                    Configurar Categorías
                  </button>
                </div>
              )}
            </motion.div>
          ) : viewMode === 'CARDS' ? (
            /* =============================================================== */
            /* CARDS VIEW WITH PROMINENT "INGRESAR" AND "RETIRAR" BUTTONS       */
            /* =============================================================== */
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
                  const totalPhysicalQty = availableQty + inProductionQty + pendingPickupQty;

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
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-mono font-bold text-white bg-black/50 backdrop-blur-xs px-2.5 py-1 rounded-lg border border-white/15">
                                {product.sku}
                              </span>
                              {product.capacity && product.capacity !== 'N/A' && (
                                <span className="text-[11px] font-mono font-bold text-amber-300 bg-black/50 backdrop-blur-xs px-2 py-1 rounded-lg border border-amber-400/30">
                                  {product.capacity}
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-semibold text-sky-300 flex items-center gap-1.5 bg-slate-950/70 backdrop-blur-xs px-2.5 py-1 rounded-lg">
                              <DeptIcon className="w-3.5 h-3.5" />
                              {product.family}
                            </div>
                          </div>
                        </div>

                        {/* Product Description & Balances */}
                        <div className="p-4 space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h3 className="text-base font-bold text-slate-900 leading-snug">
                                {product.name}
                              </h3>
                              {(product.brand !== product.family ||
                                (product.model && product.model !== 'Estándar')) && (
                                <div className="text-[11px] text-slate-500 mt-0.5">
                                  Marca: <strong>{product.brand}</strong>
                                  {product.model && product.model !== 'Estándar'
                                    ? ` · Modelo: ${product.model}`
                                    : ''}
                                </div>
                              )}
                            </div>
                            <span className="text-[11px] font-mono font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md shrink-0">
                              Total: {formatInt(totalPhysicalQty)}
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 pt-1">
                            <div className="p-2.5 bg-emerald-50/70 border border-emerald-200/80 rounded-xl">
                              <div className="text-[10px] font-bold uppercase text-emerald-800">
                                Disponible
                              </div>
                              <div className="text-base font-mono font-bold text-emerald-700 tabular-nums">
                                {formatInt(availableQty)}
                              </div>
                            </div>
                            <div className="p-2.5 bg-sky-50/70 border border-sky-200/80 rounded-xl">
                              <div className="text-[10px] font-bold uppercase text-sky-800">
                                En Orden / OP
                              </div>
                              <div className="text-base font-mono font-semibold text-sky-700 tabular-nums">
                                {formatInt(inProductionQty)}
                              </div>
                            </div>
                            <div className="p-2.5 bg-indigo-50/70 border border-indigo-200/80 rounded-xl">
                              <div className="text-[10px] font-bold uppercase text-indigo-800">
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
                              {prodBalances.slice(0, 3).map((b) => {
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

                      {/* Card Footer Actions: INGRESAR & RETIRAR + Detail & History */}
                      <div className="p-3.5 bg-slate-50/90 border-t border-slate-200/80 space-y-2.5">
                        {/* Primary Action Pair: Ingresar & Retirar */}
                        <div className="grid grid-cols-2 gap-2">
                          <motion.button
                            whileTap={{ scale: 0.96 }}
                            type="button"
                            disabled={!canReceive}
                            onClick={() => openIngresarModal(product)}
                            className="py-2.5 px-3 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                          >
                            <ArrowDownToLine className="w-4 h-4 shrink-0" />
                            <span>Ingresar</span>
                          </motion.button>

                          <motion.button
                            whileTap={{ scale: 0.96 }}
                            type="button"
                            disabled={!canDispatch}
                            onClick={() => openRetirarModal(product)}
                            className="py-2.5 px-3 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-40 rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-2xs"
                          >
                            <ArrowUpFromLine className="w-4 h-4 shrink-0" />
                            <span>Retirar</span>
                          </motion.button>
                        </div>

                        {/* Secondary Action Row: Ver detalle, Ver historial, Editar (canCreateCatalog), Eliminar (Solo Admin) */}
                        <div className="flex items-center justify-between gap-1.5 pt-1 border-t border-slate-200/60">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setDetailProduct(product)}
                              className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg flex items-center gap-1 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5 text-slate-500" />
                              Ver detalle
                            </button>
                            {onNavigateToModule && (
                              <button
                                type="button"
                                onClick={() =>
                                  onNavigateToModule('KARDEX_REPORTS', {
                                    productId: product.id,
                                  })
                                }
                                className="px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 bg-blue-50/80 border border-blue-200 hover:bg-blue-100 rounded-lg flex items-center gap-1 cursor-pointer"
                              >
                                <History className="w-3.5 h-3.5" />
                                Historial
                              </button>
                            )}
                          </div>

                          <div className="flex items-center gap-1">
                            {canCreateCatalog && (
                              <button
                                type="button"
                                onClick={() => openEditProductModal(product)}
                                className="p-1.5 text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg cursor-pointer"
                                title="Editar ficha de producto"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmProduct(product)}
                                className="p-1.5 text-red-600 bg-white border border-red-200 hover:bg-red-50 rounded-lg cursor-pointer"
                                title="Eliminar producto (Solo Administrador)"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          ) : (
            /* =============================================================== */
            /* COMPACT TABLE VIEW WITH "INGRESAR" AND "RETIRAR" BUTTONS        */
            /* =============================================================== */
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-2xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase text-slate-500">
                      <th className="py-3.5 px-4">Foto / SKU</th>
                      <th className="py-3.5 px-4">Producto / Categoría</th>
                      <th className="py-3.5 px-4 text-right">Disponible</th>
                      <th className="py-3.5 px-4 text-right">En OP</th>
                      <th className="py-3.5 px-4 text-right">Por Recoger</th>
                      <th className="py-3.5 px-4 text-right">Acciones Operativas</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
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

                      return (
                        <tr key={product.id} className="hover:bg-slate-50">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
                              <img
                                src={product.imageUrl}
                                alt={product.name}
                                onClick={() => setZoomPhotoProduct(product)}
                                className="w-11 h-11 rounded-xl object-cover border border-slate-200 cursor-pointer shrink-0"
                              />
                              <div>
                                <div className="font-mono font-bold text-slate-900">
                                  {product.sku}
                                </div>
                                {product.capacity && product.capacity !== 'N/A' && (
                                  <span className="text-[10px] font-mono font-semibold text-slate-500">
                                    {product.capacity}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900 text-sm">{product.name}</div>
                            <div className="text-slate-500">{product.family}</div>
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-sm text-emerald-700">
                            {formatInt(availableQty)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-sky-700">
                            {formatInt(inProductionQty)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-indigo-700">
                            {formatInt(pendingPickupQty)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                onClick={() => openIngresarModal(product)}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                              >
                                <ArrowDownToLine className="w-3.5 h-3.5" />
                                Ingresar
                              </button>
                              <button
                                onClick={() => openRetirarModal(product)}
                                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-lg flex items-center gap-1 cursor-pointer"
                              >
                                <ArrowUpFromLine className="w-3.5 h-3.5" />
                                Retirar
                              </button>
                              <button
                                onClick={() => setDetailProduct(product)}
                                className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg cursor-pointer"
                              >
                                Detalle
                              </button>
                              {onNavigateToModule && (
                                <button
                                  onClick={() =>
                                    onNavigateToModule('KARDEX_REPORTS', {
                                      productId: product.id,
                                    })
                                  }
                                  className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold rounded-lg cursor-pointer"
                                >
                                  Historial
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* SUBVIEW 2: GESTOR DE CATEGORÍAS / DEPARTAMENTOS                       */}
      {/* ===================================================================== */}
      {subView === 'CATEGORIES' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Categorías y Departamentos de Inventario
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Crea, edita o elimina los departamentos de tu inventario (por ejemplo:{' '}
                <strong>Chips UDP</strong>, <strong>Memorias microSD</strong>,{' '}
                <strong>Empaques</strong>, <strong>Cases</strong>, <strong>Adaptadores</strong> o{' '}
                <strong>Producto Terminado</strong>).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSubView('PRODUCTS')}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                ← Volver a Productos
              </button>
              {canCreateCatalog && (
                <button
                  type="button"
                  onClick={openCreateCategoryModal}
                  className="px-4 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg flex items-center gap-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Nueva Categoría
                </button>
              )}
            </div>
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
                  Sin categorías registradas
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Crea tus propios departamentos personalizados (ej. Chips UDP, Empaques, Cases,
                  Memorias microSD, Producto Terminado).
                </p>
              </div>
              {canCreateCatalog && (
                <button
                  type="button"
                  onClick={openCreateCategoryModal}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl inline-flex items-center gap-2 cursor-pointer shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  Crear Primera Categoría
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
                          <p className="text-xs text-slate-600 mt-1">{cat.description}</p>
                        )}
                      </div>

                      {(canCreateCatalog || isAdmin) && (
                        <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                          {canCreateCatalog && (
                            <button
                              type="button"
                              onClick={() => openEditCategoryModal(cat)}
                              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                              Editar
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => handleDeleteCategory(cat)}
                              className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg flex items-center gap-1 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              Eliminar
                            </button>
                          )}
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
      {/* SUBVIEW 3: ALMACENES Y UBICACIONES (CON SLIDE-TO-DELETE IPHONE)       */}
      {/* ===================================================================== */}
      {subView === 'WAREHOUSES' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-2xs">
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Almacenes y Subalmacenes (Secciones, Cuartos y Estantes)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Crea almacenes principales (ej. Senkata, Villa Dolores, Puente Bolivia) y sus subalmacenes o ubicaciones internas.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSubView('PRODUCTS')}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer self-start sm:self-auto"
            >
              ← Volver a Inventario
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {canCreateCatalog && (
              <form
                onSubmit={handleCreateWarehouse}
                className="bg-white rounded-xl border border-slate-200 p-6 space-y-4"
              >
                <h2 className="text-base font-bold text-slate-900">1. Crear Nuevo Almacén Principal</h2>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nombre del Almacén *
                  </label>
                  <input
                    type="text"
                    value={whName}
                    onChange={(e) => setWhName(e.target.value)}
                    placeholder="Ej. Senkata, Villa Dolores, Puente Bolivia"
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Dirección / Referencia
                  </label>
                  <input
                    type="text"
                    value={whAddress}
                    onChange={(e) => setWhAddress(e.target.value)}
                    placeholder="Ej. Av. 6 de Marzo"
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-700 font-medium">
                  <input
                    type="checkbox"
                    checked={whIsPlant}
                    onChange={(e) => setWhIsPlant(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Este almacén funciona como Taller / Planta de Producción
                </label>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  Guardar Almacén
                </button>
              </form>
            )}

            {canCreateCatalog && (
              <form
                onSubmit={handleCreateLocation}
                className="bg-white rounded-xl border border-slate-200 p-6 space-y-4"
              >
                <h2 className="text-base font-bold text-slate-900">
                  2. Crear Subalmacén / Ubicación Interna (Sección o Estante)
                </h2>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Almacén Principal *</label>
                  <select
                    value={locWhId}
                    onChange={(e) => setLocWhId(Number(e.target.value))}
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
                  >
                    {data.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Subalmacén / Sección / Cuarto *
                    </label>
                    <input
                      type="text"
                      value={locZone}
                      onChange={(e) => setLocZone(e.target.value)}
                      placeholder="Ej. Sección K / Cuarto 1"
                      className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Estante / Nivel *
                    </label>
                    <input
                      type="text"
                      value={locShelf}
                      onChange={(e) => setLocShelf(e.target.value)}
                      placeholder="Ej. Estante 1"
                      className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                      required
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg cursor-pointer"
                >
                  Guardar Subalmacén / Estante
                </button>
              </form>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {data.warehouses.map((w) => {
              const locs = data.locations.filter((l) => l.warehouseId === w.id);
              const stockCount = data.balances
                .filter((b) => b.warehouseId === w.id)
                .reduce((acc, b) => acc + b.quantity, 0);
              return (
                <div
                  key={w.id}
                  className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono text-xs text-slate-500">{w.code}</span>
                        <h3 className="text-base font-bold text-slate-900">{w.name}</h3>
                        <p className="text-xs text-slate-500">
                          {w.address || 'Sin dirección especificada'}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {w.isProductionPlant && (
                          <span className="text-[11px] font-semibold px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 rounded">
                            Taller Producción
                          </span>
                        )}
                        <span className="text-[11px] font-mono font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                          {formatInt(stockCount)} u. en stock
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1.5 pt-2 border-t border-slate-100 text-xs">
                      <div className="font-semibold text-slate-600">
                        Estantes y ubicaciones ({locs.length}):
                      </div>
                      {locs.map((l) => (
                        <div
                          key={l.id}
                          className="flex items-center justify-between p-2 bg-slate-50 rounded"
                        >
                          <span>
                            <strong>{l.zoneName}</strong> · {l.shelfName}
                          </span>
                          {isAdmin && locs.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleDeleteLocation(l.id, l.shelfName)}
                              className="text-red-600 hover:underline text-[11px] cursor-pointer"
                            >
                              Quitar
                            </button>
                          )}
                        </div>
                      ))}
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
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 1: INGRESAR STOCK (UBICACIÓN PREDETERMINADA + SOLO CANTIDAD)    */}
      {/* ===================================================================== */}
      {ingresoProduct && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={ingresoProduct.imageUrl}
                  alt={ingresoProduct.name}
                  className="w-11 h-11 rounded-xl object-cover border border-slate-200 shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      INGRESO
                    </span>
                    <span className="text-xs font-mono font-bold text-slate-600 truncate">
                      {ingresoProduct.sku}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 truncate mt-0.5">
                    {ingresoProduct.name}
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setIngresoProduct(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmIngreso} className="space-y-3.5 text-xs">
              {/* Pre-determined Warehouse & Location Badge */}
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">
                      Ubicación de ingreso:
                    </span>
                    <span className="font-bold text-slate-800 truncate block">
                      {data.warehouses.find((w) => w.id === ingresoWhId)?.name || 'Almacén'}
                      {(() => {
                        const loc = data.locations.find((l) => l.id === ingresoLocId);
                        return loc ? ` · ${loc.zoneName} (${loc.shelfName})` : '';
                      })()}
                    </span>
                  </div>
                  {(data.warehouses.length > 1 || data.locations.length > 1) && (
                    <button
                      type="button"
                      onClick={() => setShowChangeIngresoLoc(!showChangeIngresoLoc)}
                      className="text-[11px] font-bold text-blue-600 hover:underline shrink-0 cursor-pointer"
                    >
                      {showChangeIngresoLoc ? 'Listo' : 'Cambiar'}
                    </button>
                  )}
                </div>

                {showChangeIngresoLoc && (
                  <div className="grid grid-cols-2 gap-2 mt-2.5 pt-2.5 border-t border-slate-200">
                    <select
                      value={ingresoWhId}
                      onChange={(e) => {
                        const newWh = Number(e.target.value);
                        setIngresoWhId(newWh);
                        const firstLoc = data.locations.find((l) => l.warehouseId === newWh);
                        setIngresoLocId(firstLoc?.id || 0);
                      }}
                      className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white font-semibold"
                    >
                      {data.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={ingresoLocId}
                      onChange={(e) => setIngresoLocId(Number(e.target.value))}
                      className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white"
                    >
                      {data.locations
                        .filter((l) => l.warehouseId === ingresoWhId)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.zoneName} · {l.shelfName}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Quantity + Fast Presets */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-bold text-slate-800">Cantidad a Ingresar *</label>
                  <div className="flex items-center gap-1">
                    {[100, 500, 1000, 5000].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setIngresoQty(preset)}
                        className="px-2 py-0.5 text-[11px] font-mono font-bold bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-md cursor-pointer"
                      >
                        +{formatInt(preset)}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={ingresoQty}
                  onChange={(e) => setIngresoQty(Math.max(1, Math.floor(Number(e.target.value))))}
                  className="w-full text-xl font-mono font-bold border border-slate-300 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  required
                />
              </div>

              {/* Live Calculation */}
              <div className="px-3.5 py-2.5 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-950">Nuevo Saldo:</span>
                <div className="font-mono text-sm font-bold flex items-center gap-1.5">
                  <span className="text-slate-600">{formatInt(ingresoCurrentAvail)}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-800 font-extrabold">
                    {formatInt(ingresoCurrentAvail + (ingresoQty > 0 ? ingresoQty : 0))} u.
                  </span>
                </div>
              </div>

              {/* Optional 1-line note */}
              <input
                type="text"
                value={ingresoNotes}
                onChange={(e) => {
                  setIngresoNotes(e.target.value);
                  setIngresoSupplier(e.target.value);
                }}
                placeholder="Observación opcional (ej. Nuevo lote)"
                className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2"
              />

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIngresoProduct(null)}
                  className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || ingresoQty <= 0}
                  className="px-5 py-2 font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Check className="w-4 h-4" />
                  {submitting ? 'Guardando...' : 'Confirmar Ingreso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: RETIRAR STOCK (SALIDA PREDETERMINADA + SOLO CANTIDAD)        */}
      {/* ===================================================================== */}
      {retiroProduct && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={retiroProduct.imageUrl}
                  alt={retiroProduct.name}
                  className="w-11 h-11 rounded-xl object-cover border border-slate-200 shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                      RETIRO DIRECTO
                    </span>
                    <span className="text-xs font-mono font-bold text-slate-600 truncate">
                      {retiroProduct.sku}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 truncate mt-0.5">
                    {retiroProduct.name}
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setRetiroProduct(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmRetiro} className="space-y-3.5 text-xs">
              {/* Pre-determined Origin Location Badge */}
              <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">
                      Saliendo de (Predeterminado):
                    </span>
                    <span className="font-bold text-slate-900 truncate block">
                      {data.warehouses.find((w) => w.id === retiroWhId)?.name || 'Almacén'}
                      {(() => {
                        const loc = data.locations.find((l) => l.id === retiroLocId);
                        return loc ? ` · ${loc.zoneName} (${loc.shelfName})` : '';
                      })()}
                    </span>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono font-extrabold text-emerald-700 text-sm block">
                      {formatInt(retiroCurrentAvail)} u.
                    </span>
                    {data.balances.filter(
                      (b) =>
                        b.productId === retiroProduct.id &&
                        b.status === 'AVAILABLE' &&
                        b.quantity > 0
                    ).length > 1 && (
                      <button
                        type="button"
                        onClick={() => setShowChangeRetiroLoc(!showChangeRetiroLoc)}
                        className="text-[10px] font-bold text-blue-600 hover:underline cursor-pointer"
                      >
                        {showChangeRetiroLoc ? 'Listo' : 'Cambiar'}
                      </button>
                    )}
                  </div>
                </div>

                {showChangeRetiroLoc && (
                  <div className="grid grid-cols-2 gap-2 mt-2.5 pt-2.5 border-t border-slate-200">
                    <select
                      value={retiroWhId}
                      onChange={(e) => {
                        const newWh = Number(e.target.value);
                        setRetiroWhId(newWh);
                        const firstLoc = data.locations.find((l) => l.warehouseId === newWh);
                        setRetiroLocId(firstLoc?.id || 0);
                      }}
                      className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white font-semibold"
                    >
                      {data.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={retiroLocId}
                      onChange={(e) => setRetiroLocId(Number(e.target.value))}
                      className="w-full text-xs border border-slate-300 rounded-lg px-2 py-1.5 bg-white"
                    >
                      {data.locations
                        .filter((l) => l.warehouseId === retiroWhId)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.zoneName} · {l.shelfName}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Quantity + Fast Presets */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-bold text-slate-800">Cantidad a Retirar *</label>
                  <div className="flex items-center gap-1">
                    {[100, 500, 1000, 5000].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setRetiroQty(preset)}
                        className="px-2 py-0.5 text-[11px] font-mono font-bold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-md cursor-pointer"
                      >
                        {formatInt(preset)}
                      </button>
                    ))}
                    {retiroCurrentAvail > 0 && (
                      <button
                        type="button"
                        onClick={() => setRetiroQty(retiroCurrentAvail)}
                        className="px-2 py-0.5 text-[11px] font-bold bg-slate-800 text-white rounded-md cursor-pointer"
                      >
                        Máx
                      </button>
                    )}
                  </div>
                </div>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={retiroQty}
                  onChange={(e) => setRetiroQty(Math.max(1, Math.floor(Number(e.target.value))))}
                  className="w-full text-xl font-mono font-bold border border-slate-300 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-600"
                  required
                />
                {retiroQty > retiroCurrentAvail && (
                  <p className="text-red-600 font-semibold mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Solo hay {formatInt(retiroCurrentAvail)} u. disponibles.
                  </p>
                )}
              </div>

              {/* Live Balance Preview */}
              <div className="px-3.5 py-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-950">Quedan disponibles:</span>
                <div className="font-mono text-sm font-bold flex items-center gap-1.5">
                  <span className="text-slate-600">{formatInt(retiroCurrentAvail)}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-amber-600" />
                  <span
                    className={`font-extrabold ${
                      retiroCurrentAvail - retiroQty < 0 ? 'text-red-600' : 'text-emerald-800'
                    }`}
                  >
                    {formatInt(retiroCurrentAvail - (retiroQty > 0 ? retiroQty : 0))} u.
                  </span>
                </div>
              </div>

              {/* Optional 1-line Note */}
              <input
                type="text"
                value={retiroReason}
                onChange={(e) => {
                  setRetiroReason(e.target.value);
                  setRetiroNotes(e.target.value);
                }}
                placeholder="Nota opcional (ej. Salida de almacén)"
                className="w-full text-xs border border-slate-200 rounded-xl px-3 py-2"
              />

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setRetiroProduct(null)}
                  className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || retiroQty <= 0 || retiroQty > retiroCurrentAvail}
                  className="px-5 py-2 font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  <Check className="w-4 h-4" />
                  {submitting ? 'Retirando...' : 'Confirmar Retiro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: COMPROBANTE DE MOVIMIENTO (VOUCHER RECIBO DE OPERACIÓN)      */}
      {/* ===================================================================== */}
      {voucherData && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl border border-slate-200"
          >
            <div
              className={`p-5 text-white flex items-center justify-between ${
                voucherData.operationType === 'INGRESO'
                  ? 'bg-gradient-to-r from-emerald-700 to-emerald-600'
                  : 'bg-gradient-to-r from-amber-700 to-amber-600'
              }`}
            >
              <div className="flex items-center gap-3">
                <FileCheck2 className="w-7 h-7 text-white shrink-0" />
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-white/80">
                    Folio Oficial: {voucherData.folio}
                  </div>
                  <h3 className="text-sm font-bold leading-snug">
                    {voucherData.operationTitle}
                  </h3>
                </div>
              </div>
              <button
                onClick={() => setVoucherData(null)}
                className="p-1 text-white/80 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="flex items-center gap-3 pb-3 border-b border-slate-100">
                {voucherData.productImageUrl && (
                  <img
                    src={voucherData.productImageUrl}
                    alt={voucherData.productName}
                    className="w-12 h-12 rounded-xl object-cover border border-slate-200 shrink-0"
                  />
                )}
                <div>
                  <div className="font-mono font-bold text-slate-700">
                    {voucherData.productSku}
                  </div>
                  <div className="text-sm font-bold text-slate-900">
                    {voucherData.productName}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-slate-600">
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400">
                    Fecha y Hora (Servidor)
                  </div>
                  <div className="font-mono font-semibold text-slate-900">
                    {formatBoliviaDateTime(voucherData.serverTimestamp)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400">
                    Usuario Responsable
                  </div>
                  <div className="font-semibold text-slate-900">{voucherData.userFullName}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400">Almacén</div>
                  <div className="font-semibold text-slate-900">{voucherData.warehouseName}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase font-bold text-slate-400">Ubicación</div>
                  <div className="font-semibold text-slate-900">{voucherData.locationName}</div>
                </div>
              </div>

              {voucherData.orderNumber && (
                <div className="p-2.5 bg-sky-50 border border-sky-200 rounded-xl flex items-center justify-between">
                  <span className="text-sky-900 font-semibold">Orden de Producción:</span>
                  <span className="font-mono font-bold text-sky-800">
                    {voucherData.orderNumber}
                  </span>
                </div>
              )}

              <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-1">
                <div className="text-[10px] uppercase font-bold text-slate-400">
                  Motivo / Destino
                </div>
                <div className="font-semibold text-slate-800">{voucherData.reason}</div>
                {voucherData.recipientOrTarget && (
                  <div className="text-slate-600">
                    Destino/Uso: <strong>{voucherData.recipientOrTarget}</strong>
                  </div>
                )}
              </div>

              {/* Before / Change / After Box */}
              <div className="p-3.5 bg-slate-900 text-white rounded-xl grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[10px] text-slate-400">Stock Anterior</div>
                  <div className="text-sm font-mono font-bold">
                    {formatInt(voucherData.stockBefore)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400">
                    {voucherData.operationType === 'INGRESO' ? 'Ingreso' : 'Retiro'}
                  </div>
                  <div
                    className={`text-sm font-mono font-bold ${
                      voucherData.operationType === 'INGRESO'
                        ? 'text-emerald-400'
                        : 'text-amber-400'
                    }`}
                  >
                    {voucherData.operationType === 'INGRESO' ? '+' : '-'}
                    {formatInt(voucherData.quantityChanged)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-300 font-bold">Stock Resultante</div>
                  <div className="text-sm font-mono font-extrabold text-white">
                    {formatInt(voucherData.stockAfter)}
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setVoucherData(null)}
                  className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl cursor-pointer"
                >
                  Entendido y Cerrar Comprobante
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 4: DETALLE COMPLETO DEL PRODUCTO POR ALMACÉN Y ESTADO           */}
      {/* ===================================================================== */}
      {detailProduct && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-3">
                <img
                  src={detailProduct.imageUrl}
                  alt={detailProduct.name}
                  className="w-12 h-12 rounded-xl object-cover border border-slate-200"
                />
                <div>
                  <span className="font-mono text-xs font-bold text-blue-700">
                    {detailProduct.sku}
                  </span>
                  <h3 className="text-base font-bold text-slate-900">{detailProduct.name}</h3>
                </div>
              </div>
              <button
                onClick={() => setDetailProduct(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-slate-500">Categoría</div>
                <div className="font-bold text-slate-900 mt-0.5">{detailProduct.family}</div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-slate-500">Marca / Modelo</div>
                <div className="font-bold text-slate-900 mt-0.5">
                  {detailProduct.brand} · {detailProduct.model}
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-slate-500">Capacidad</div>
                <div className="font-mono font-bold text-slate-900 mt-0.5">
                  {detailProduct.capacity || 'N/A'}
                </div>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-slate-500">Unidad de Medida</div>
                <div className="font-bold text-slate-900 mt-0.5">{detailProduct.unitName}</div>
              </div>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Desglose de Existencias por Almacén, Ubicación y Estado
              </h4>
              {(() => {
                const bals = data.balances.filter((b) => b.productId === detailProduct.id);
                if (bals.length === 0) {
                  return (
                    <div className="p-6 text-center text-xs text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
                      Este producto tiene 0 unidades registradas en todos los almacenes.
                    </div>
                  );
                }
                return (
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                        <tr>
                          <th className="py-2.5 px-3">Almacén</th>
                          <th className="py-2.5 px-3">Ubicación</th>
                          <th className="py-2.5 px-3">Estado Contable</th>
                          <th className="py-2.5 px-3 text-right">Cantidad</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {bals.map((b) => {
                          const wh = data.warehouses.find((w) => w.id === b.warehouseId);
                          const loc = data.locations.find((l) => l.id === b.locationId);
                          const ord =
                            b.productionOrderId > 0
                              ? data.productionOrders.find((o) => o.id === b.productionOrderId)
                              : null;
                          return (
                            <tr key={b.id}>
                              <td className="py-2.5 px-3 font-semibold text-slate-900">
                                {wh?.name || `#${b.warehouseId}`}
                              </td>
                              <td className="py-2.5 px-3 text-slate-600">
                                {loc ? `${loc.zoneName} · ${loc.shelfName}` : 'Principal'}
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="font-semibold text-slate-800">
                                  {translateStatus(b.status)}
                                </span>
                                {ord && (
                                  <span className="ml-1.5 font-mono text-[11px] text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded">
                                    {ord.orderNumber}
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                                {formatInt(b.quantity)} u.
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const p = detailProduct;
                    setDetailProduct(null);
                    openIngresarModal(p);
                  }}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  Ingresar Stock
                </button>
                <button
                  onClick={() => {
                    const p = detailProduct;
                    setDetailProduct(null);
                    openRetirarModal(p);
                  }}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowUpFromLine className="w-3.5 h-3.5" />
                  Retirar Stock
                </button>
              </div>
              <button
                onClick={() => setDetailProduct(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 5: CREAR / EDITAR PRODUCTO                                      */}
      {/* ===================================================================== */}
      {productModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl my-8">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingProduct ? 'Editar Ficha de Producto' : 'Nuevo Producto en Catálogo'}
              </h3>
              <button
                onClick={() => setProductModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveProduct} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  1. Código / SKU del Producto *
                </label>
                <input
                  type="text"
                  value={prodSku}
                  onChange={(e) => setProdSku(e.target.value)}
                  placeholder="Ej. UDP-8GB, CASE-HP-METAL, USB-HP-8GB"
                  className="w-full text-sm font-mono border border-slate-300 rounded-lg px-3 py-2"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  2. Nombre / Descripción del Producto *
                </label>
                <input
                  type="text"
                  value={prodDescription}
                  onChange={(e) => setProdDescription(e.target.value)}
                  placeholder="Ej. Chip UDP 8 GB, Case Metálico HP, USB HP 8 GB Terminado"
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-800 mb-1">
                    3. Categoría / Departamento *
                  </label>
                  <select
                    value={prodCategoryName}
                    onChange={(e) => setProdCategoryName(e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white font-medium"
                  >
                    {data.categories.length === 0 && (
                      <>
                        <option value="Chips UDP">Chips UDP</option>
                        <option value="Memorias microSD">Memorias microSD</option>
                        <option value="Empaques">Empaques</option>
                        <option value="Cases">Cases</option>
                        <option value="Adaptadores">Adaptadores</option>
                        <option value="Producto Terminado">Producto Terminado</option>
                      </>
                    )}
                    {data.categories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-800 mb-1">
                    4. Capacidad (si aplica)
                  </label>
                  <select
                    value={prodCapacity}
                    onChange={(e) => setProdCapacity(e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white font-mono"
                  >
                    <option value="N/A">N/A (No aplica)</option>
                    <option value="4 GB">4 GB</option>
                    <option value="8 GB">8 GB</option>
                    <option value="16 GB">16 GB</option>
                    <option value="32 GB">32 GB</option>
                    <option value="64 GB">64 GB</option>
                    <option value="128 GB">128 GB</option>
                    <option value="256 GB">256 GB</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-800 mb-1">
                    Marca (Opcional)
                  </label>
                  <input
                    type="text"
                    value={prodBrand}
                    onChange={(e) => setProdBrand(e.target.value)}
                    placeholder="Ej. HP, Sony, Samsung, Kingston"
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-800 mb-1">
                    Modelo / Variante (Opcional)
                  </label>
                  <input
                    type="text"
                    value={prodModel}
                    onChange={(e) => setProdModel(e.target.value)}
                    placeholder="Ej. Metálico, Giro, Blíster Azul"
                    className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                  />
                </div>
              </div>

              {!editingProduct && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                  <div>
                    <label className="block font-semibold text-slate-800 mb-1">
                      5. Cantidad Inicial en Stock (Opcional)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={prodInitialQty}
                      onChange={(e) =>
                        setProdInitialQty(Math.max(0, Math.floor(Number(e.target.value))))
                      }
                      className="w-full text-sm font-mono font-bold border border-slate-300 rounded-lg px-3 py-2 bg-white"
                    />
                  </div>
                  {prodInitialQty > 0 && (
                    <div>
                      <label className="block font-medium text-slate-700 mb-1">
                        ¿En qué almacén se encuentra esta cantidad?
                      </label>
                      <select
                        value={prodInitialWhId}
                        onChange={(e) => setProdInitialWhId(Number(e.target.value))}
                        className="w-full text-xs border border-slate-300 rounded-lg px-2.5 py-2 bg-white"
                      >
                        {data.warehouses.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Fotografía del Producto
                </label>
                <div className="flex items-center gap-3">
                  <label className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg cursor-pointer font-medium flex items-center gap-2 border border-slate-300">
                    <Camera className="w-4 h-4 text-slate-600" />
                    Subir Foto desde Celular / PC
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
                      className="w-16 h-12 object-cover rounded-lg border border-slate-300"
                    />
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setProductModalOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg flex items-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  {submitting ? 'Guardando...' : 'Guardar Producto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 6: CREAR / EDITAR CATEGORÍA                                     */}
      {/* ===================================================================== */}
      {catModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingCategory ? 'Editar Categoría' : 'Nueva Categoría / Departamento'}
              </h3>
              <button
                onClick={() => setCatModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCategory} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Nombre de la Categoría *
                </label>
                <input
                  type="text"
                  value={catName}
                  onChange={(e) => setCatName(e.target.value)}
                  placeholder="Ej. Empaques, Cases, Chips UDP, Memorias microSD"
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Comportamiento en Inventario y Producción *
                </label>
                <select
                  value={catAccType}
                  onChange={(e) => setCatAccType(e.target.value as any)}
                  className="w-full text-xs border border-slate-300 rounded-lg px-3 py-2.5 bg-white"
                >
                  <option value="STRATEGIC_COMPONENT">
                    Componente Estratégico (Se asigna en Orden de Producción, ej. Chips UDP /
                    microSD)
                  </option>
                  <option value="SECONDARY_COMPONENT">
                    Insumo de Ensamblaje (Se retira con botón Retirar, ej. Cases / Carcasas)
                  </option>
                  <option value="PACKAGING_KIT">
                    Empaque / Blíster (Se retira con botón Retirar)
                  </option>
                  <option value="UNIVERSAL_ACCESSORY">
                    Accesorio / Adaptador (Ej. Adaptadores SD)
                  </option>
                  <option value="FINISHED_GOOD">
                    Producto Terminado (Se registra al fabricar lotes)
                  </option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Descripción (Opcional)
                </label>
                <input
                  type="text"
                  value={catDescription}
                  onChange={(e) => setCatDescription(e.target.value)}
                  placeholder="Ej. Blísteres y cartones por marca"
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setCatModalOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 rounded-lg cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg cursor-pointer"
                >
                  Guardar Categoría
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 7: CONFIRMACIÓN DE ELIMINACIÓN DE PRODUCTO                      */}
      {/* ===================================================================== */}
      {deleteConfirmProduct && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-red-200">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">¿Eliminar este producto?</h3>
                <p className="text-xs text-slate-500 font-mono">{deleteConfirmProduct.sku}</p>
              </div>
            </div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Estás por eliminar permanentemente <strong>{deleteConfirmProduct.name}</strong> y sus
              registros asociados del catálogo.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setDeleteConfirmProduct(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => handleDeleteProduct(deleteConfirmProduct)}
                className="px-4 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-xl cursor-pointer flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {submitting ? 'Eliminando...' : 'Sí, Eliminar Producto'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 8: ZOOM DE FOTOGRAFÍA                                           */}
      {/* ===================================================================== */}
      {zoomPhotoProduct && (
        <div
          onClick={() => setZoomPhotoProduct(null)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-xl max-w-lg w-full overflow-hidden shadow-2xl"
          >
            <img
              src={zoomPhotoProduct.imageUrl}
              alt={zoomPhotoProduct.name}
              className="w-full h-72 object-cover bg-slate-900"
            />
            <div className="p-4 flex items-center justify-between">
              <div>
                <span className="font-mono text-xs font-bold text-sky-700">
                  {zoomPhotoProduct.sku} · {zoomPhotoProduct.family}
                </span>
                <h3 className="text-base font-bold text-slate-900">{zoomPhotoProduct.name}</h3>
              </div>
              <button
                onClick={() => setZoomPhotoProduct(null)}
                className="px-4 py-2 text-xs font-semibold bg-slate-900 text-white rounded-lg cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 9: DESLIZAR PARA ELIMINAR ALMACÉN (ESTILO IPHONE)               */}
      {/* ===================================================================== */}
      {warehouseToDelete && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-red-200">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Confirmar Eliminación de Almacén
                  </h3>
                  <p className="text-xs text-red-600 font-semibold">
                    Acción crítica e irreversible
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={deletingWarehouse}
                onClick={() => {
                  setWarehouseToDelete(null);
                  setSlideProgress(0);
                }}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-2 text-xs text-red-950">
              <div className="font-bold text-sm text-red-900">
                Almacén: {warehouseToDelete.name} ({warehouseToDelete.code})
              </div>
              <p className="leading-relaxed text-red-800">
                Al confirmar, se eliminará todo el almacén junto con sus estantes y las existencias
                almacenadas allí (
                <strong>
                  {formatInt(
                    data.balances
                      .filter((b) => b.warehouseId === warehouseToDelete.id)
                      .reduce((acc, b) => acc + b.quantity, 0)
                  )}{' '}
                  unidades actuales
                </strong>
                ).
              </p>
            </div>

            {/* iPhone-style Slide to Confirm Track */}
            <div className="space-y-2 pt-1">
              <div className="relative h-14 bg-slate-900 rounded-full p-1.5 overflow-hidden select-none shadow-inner border border-slate-800">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-red-700 to-red-600 transition-all duration-75"
                  style={{ width: `${Math.max(14, slideProgress)}%` }}
                />

                <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-12">
                  <span className="text-xs font-bold tracking-wide text-white/90 uppercase">
                    {deletingWarehouse
                      ? 'Eliminando almacén...'
                      : 'Deslizar para eliminar almacén'}
                  </span>
                </div>

                <div
                  className="relative z-10 w-11 h-11 rounded-full bg-white shadow-lg flex items-center justify-center text-red-600 pointer-events-none transition-transform duration-75"
                  style={{
                    transform: `translateX(calc(${slideProgress} * (100cqw - 3.25rem) / 100))`,
                  }}
                >
                  <ChevronsRight className="w-6 h-6" />
                </div>

                <input
                  type="range"
                  min={0}
                  max={100}
                  value={slideProgress}
                  disabled={deletingWarehouse}
                  onChange={(e) => handleSlideChange(Number(e.target.value))}
                  onMouseUp={handleSlideRelease}
                  onTouchEnd={handleSlideRelease}
                  aria-label="Deslizar para confirmar eliminación del almacén"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-20"
                  style={{ containerType: 'inline-size' }}
                />
              </div>
              <p className="text-[11px] text-center text-slate-500">
                Arrastra el control hasta el extremo derecho para confirmar la eliminación.
              </p>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100">
              <button
                type="button"
                disabled={deletingWarehouse}
                onClick={() => {
                  setWarehouseToDelete(null);
                  setSlideProgress(0);
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
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
