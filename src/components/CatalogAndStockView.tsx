import React, { useState } from 'react';
import {
  Package,
  Search,
  Plus,
  Layers,
  Warehouse as WarehouseIcon,
  CheckCircle2,
  AlertTriangle,
  Camera,
  Eye,
  ArrowDownToLine,
  ArrowRightLeft,
} from 'lucide-react';
import {
  WorkspaceData,
  Product,
  Recipe,
  formatInt,
  translateStatus,
} from '../types.ts';

interface Props {
  data: WorkspaceData;
  isOnline: boolean;
  apiFetch: (url: string, options?: RequestInit) => Promise<any>;
  onRefresh: () => Promise<void>;
}

export function CatalogAndStockView({ data, isOnline, apiFetch, onRefresh }: Props) {
  const [subTab, setSubTab] = useState<'STOCK' | 'INGRESO' | 'CATALOGO' | 'RECETAS' | 'ALMACENES'>('STOCK');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<number | 'ALL'>('ALL');
  const [selectedFamily, setSelectedFamily] = useState<string>('ALL');
  const [zoomPhotoProduct, setZoomPhotoProduct] = useState<Product | null>(null);

  // Goods Receipt Form State
  const [receiptWarehouseId, setReceiptWarehouseId] = useState<number>(
    data.warehouses[0]?.id || 0
  );
  const [receiptLocationId, setReceiptLocationId] = useState<number>(
    data.locations.find((l) => l.warehouseId === data.warehouses[0]?.id)?.id || 0
  );
  const [receiptMovementType, setReceiptMovementType] = useState<'INGRESO_PROVEEDOR' | 'APERTURA_INICIAL'>('INGRESO_PROVEEDOR');
  const [supplierOrContainer, setSupplierOrContainer] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');
  const [receiptProductId, setReceiptProductId] = useState<number>(
    data.products[0]?.id || 0
  );
  const [receiptQuantity, setReceiptQuantity] = useState<number>(1000);
  const [receiptInputMode, setReceiptInputMode] = useState<'UNITS' | 'BOXES'>('UNITS');
  const [receiptBoxesCount, setReceiptBoxesCount] = useState<number>(1);
  const [includePrivateCost, setIncludePrivateCost] = useState<boolean>(false);
  const [fobCost, setFobCost] = useState<number>(0);
  const [freightCost, setFreightCost] = useState<number>(0);
  const [customsCost, setCustomsCost] = useState<number>(0);
  const [otherCost, setOtherCost] = useState<number>(0);
  const [receiptPreviewOpen, setReceiptPreviewOpen] = useState(false);
  const [receiptIdempotencyKey, setReceiptIdempotencyKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // New Product Modal State
  const [newSku, setNewSku] = useState('');
  const [newName, setNewName] = useState('');
  const [newProductType, setNewProductType] = useState<Product['productType']>('SECONDARY_COMPONENT');
  const [newFamily, setNewFamily] = useState('CASE');
  const [newBrand, setNewBrand] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newCapacity, setNewCapacity] = useState('8GB');
  const [newColor, setNewColor] = useState('Negro');
  const [newMaterial, setNewMaterial] = useState('Metal');
  const [newUnitsPerBox, setNewUnitsPerBox] = useState(1000);
  const [newMinStock, setNewMinStock] = useState(1000);
  const [newImageUrl, setNewImageUrl] = useState('');
  const [duplicateWarningData, setDuplicateWarningData] = useState<any | null>(null);

  // New Recipe Form State
  const [recCode, setRecCode] = useState('');
  const [recName, setRecName] = useState('');
  const [recFinishedId, setRecFinishedId] = useState<number>(
    data.products.find((p) => p.productType === 'FINISHED_GOOD')?.id || 0
  );
  const [recComponents, setRecComponents] = useState<
    { componentProductId: number; quantityPerUnit: number; isStrategicOrderBound: boolean }[]
  >([]);

  // New Location State
  const [locWhId, setLocWhId] = useState<number>(data.warehouses[0]?.id || 0);
  const [locCode, setLocCode] = useState('');
  const [locZone, setLocZone] = useState('');
  const [locShelf, setLocShelf] = useState('');

  // IDOR Security Test Trigger
  const [idorTestStatus, setIdorTestStatus] = useState<string | null>(null);

  const isOwnerOrAdmin = data.user.role === 'OWNER' || data.user.role === 'ADMIN';
  const canViewCosts = data.user.role === 'OWNER' || data.user.canViewPrivateCosts;

  const selectedReceiptProduct = data.products.find((p) => p.id === receiptProductId);
  const effectiveReceiptUnits =
    receiptInputMode === 'BOXES' && selectedReceiptProduct
      ? receiptBoxesCount * selectedReceiptProduct.unitsPerBox
      : receiptQuantity;

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setFeedbackMsg({ type: 'error', text: 'La imagen no debe superar 4 MB.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setNewImageUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const openReceiptPreview = () => {
    if (!isOnline) {
      setFeedbackMsg({
        type: 'error',
        text: 'Sin conexión a Internet: las confirmaciones están bloqueadas.',
      });
      return;
    }
    if (!receiptWarehouseId || !receiptLocationId || !receiptProductId || effectiveReceiptUnits <= 0) {
      setFeedbackMsg({
        type: 'error',
        text: 'Seleccione almacén, ubicación, producto y una cantidad entera positiva.',
      });
      return;
    }
    setReceiptIdempotencyKey(`ING-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    setReceiptPreviewOpen(true);
    setFeedbackMsg(null);
  };

  const confirmGoodsReceipt = async () => {
    if (!isOnline) return;
    setSubmitting(true);
    setFeedbackMsg(null);
    try {
      const res = await apiFetch('/api/inventory/receipts', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: receiptIdempotencyKey,
          movementType: receiptMovementType,
          warehouseId: receiptWarehouseId,
          locationId: receiptLocationId,
          supplierOrContainer,
          notes: receiptNotes,
          lines: [
            {
              productId: receiptProductId,
              quantity: effectiveReceiptUnits,
              privateCost:
                canViewCosts && includePrivateCost
                  ? {
                      fobTotalCost: fobCost,
                      freightCost,
                      customsPolicyCost: customsCost,
                      otherImportExpenses: otherCost,
                      currency: 'USD',
                      privateNotes: receiptNotes,
                    }
                  : undefined,
            },
          ],
        }),
      });
      setReceiptPreviewOpen(false);
      setSupplierOrContainer('');
      setReceiptNotes('');
      setFeedbackMsg({
        type: 'success',
        text: `Ingreso confirmado en servidor. Documento Folio: ${res.folio} (${formatInt(
          effectiveReceiptUnits
        )} unidades).`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateProduct = async (forceCreate = false) => {
    if (!isOnline) return;
    setSubmitting(true);
    setFeedbackMsg(null);
    try {
      await apiFetch('/api/products', {
        method: 'POST',
        body: JSON.stringify({
          sku: newSku,
          name: newName,
          productType: newProductType,
          family: newFamily,
          brand: newBrand,
          model: newModel,
          capacity: newCapacity,
          color: newColor,
          material: newMaterial,
          unitsPerBox: newUnitsPerBox,
          minStockAlert: newMinStock,
          imageUrl: newImageUrl,
          forceCreateDespiteDuplicateWarning: forceCreate,
        }),
      });
      setDuplicateWarningData(null);
      setNewSku('');
      setNewName('');
      setFeedbackMsg({
        type: 'success',
        text: 'Producto registrado correctamente en el catálogo maestro.',
      });
      await onRefresh();
    } catch (err: any) {
      if (err.warningDuplicate) {
        setDuplicateWarningData(err);
      } else {
        setFeedbackMsg({ type: 'error', text: err.message });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateRecipe = async () => {
    if (!isOnline) return;
    if (!recCode || !recName || !recFinishedId || recComponents.length === 0) {
      setFeedbackMsg({
        type: 'error',
        text: 'Complete código, nombre, producto terminado y al menos un componente en la receta.',
      });
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/api/recipes', {
        method: 'POST',
        body: JSON.stringify({
          code: recCode,
          name: recName,
          finishedProductId: recFinishedId,
          changeReason: 'Creada desde panel de recetas',
          components: recComponents,
        }),
      });
      setRecCode('');
      setRecName('');
      setRecComponents([]);
      setFeedbackMsg({ type: 'success', text: 'Receta (BOM) registrada y activada.' });
      await onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateLocation = async () => {
    if (!isOnline || !locWhId || !locCode || !locZone || !locShelf) return;
    setSubmitting(true);
    try {
      await apiFetch('/api/warehouses', {
        method: 'POST',
        body: JSON.stringify({
          type: 'LOCATION',
          warehouseId: locWhId,
          code: locCode,
          zoneName: locZone,
          shelfName: locShelf,
        }),
      });
      setLocCode('');
      setLocZone('');
      setLocShelf('');
      setFeedbackMsg({ type: 'success', text: 'Nueva ubicación/estante creada.' });
      await onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const triggerIdorAttempt = async (unauthorizedWarehouseId: number) => {
    try {
      await apiFetch(`/api/workspace?warehouseId=${unauthorizedWarehouseId}`);
      setIdorTestStatus('Acceso permitido');
    } catch (err: any) {
      setIdorTestStatus(err.message);
    }
  };

  // Filtered products & balances
  const filteredProducts = data.products.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      p.sku.toLowerCase().includes(q) ||
      p.name.toLowerCase().includes(q) ||
      p.brand.toLowerCase().includes(q) ||
      p.model.toLowerCase().includes(q) ||
      p.capacity.toLowerCase().includes(q);
    const matchesFamily = selectedFamily === 'ALL' || p.family === selectedFamily;
    return matchesSearch && matchesFamily;
  });

  const unauthorizedWarehouses = data.allWarehousesSummary.filter(
    (w) => !data.warehouses.some((vw) => vw.id === w.id)
  );

  return (
    <div className="space-y-6">
      {/* Sub-navigation bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            onClick={() => setSubTab('STOCK')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'STOCK'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Existencias por Almacén y Estado
          </button>
          <button
            onClick={() => setSubTab('INGRESO')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'INGRESO'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Registrar Ingreso de Proveedor / Contenedor
          </button>
          <button
            onClick={() => setSubTab('CATALOGO')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'CATALOGO'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Catálogo Maestro de SKUs y Fotos
          </button>
          <button
            onClick={() => setSubTab('RECETAS')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'RECETAS'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Recetas de Ensamblaje (BOM)
          </button>
          <button
            onClick={() => setSubTab('ALMACENES')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'ALMACENES'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Almacenes y Ubicaciones
          </button>
        </div>

        {/* Warehouse Scope Indicator */}
        <div className="text-xs text-slate-600">
          Almacenes autorizados para su usuario:{' '}
          <span className="font-semibold text-slate-900">
            {data.warehouses.map((w) => w.name).join(' · ') || 'Ninguno'}
          </span>
        </div>
      </div>

      {feedbackMsg && (
        <div
          className={`p-4 rounded-lg border text-sm flex items-center justify-between ${
            feedbackMsg.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <span>{feedbackMsg.text}</span>
          <button
            onClick={() => setFeedbackMsg(null)}
            className="text-xs font-medium underline ml-4"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 1: EXISTENCIAS POR ALMACÉN, UBICACIÓN Y ESTADO                    */}
      {/* ===================================================================== */}
      {subTab === 'STOCK' && (
        <div className="space-y-5">
          {/* Search & Filter Bar */}
          <div className="bg-white p-4 rounded-lg border border-slate-200 flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por SKU, nombre, marca, modelo o capacidad (ej. UDP 8GB, HP, Adaptador)..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-600"
              />
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-600">Almacén:</label>
              <select
                value={selectedWarehouseId}
                onChange={(e) =>
                  setSelectedWarehouseId(
                    e.target.value === 'ALL' ? 'ALL' : Number(e.target.value)
                  )
                }
                className="text-sm border border-slate-300 rounded-md px-3 py-2 bg-white"
              >
                <option value="ALL">Todos los autorizados ({data.warehouses.length})</option>
                {data.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-600">Familia:</label>
              <select
                value={selectedFamily}
                onChange={(e) => setSelectedFamily(e.target.value)}
                className="text-sm border border-slate-300 rounded-md px-3 py-2 bg-white"
              >
                <option value="ALL">Todas las familias</option>
                <option value="UDP">Chips UDP</option>
                <option value="MICROSD">Memorias microSD</option>
                <option value="ADAPTADOR">Adaptadores SD</option>
                <option value="CASE">Cases USB</option>
                <option value="EMPAQUE">Kits de Empaque (Papel+Blíster)</option>
                <option value="USB_TERMINADO">USB Terminados</option>
                <option value="MICROSD_TERMINADA">microSD Terminadas</option>
              </select>
            </div>
          </div>

          {/* IDOR Verification Strip for Non-Global Staff */}
          {unauthorizedWarehouses.length > 0 && (
            <div className="bg-slate-100 border border-slate-200 rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-700">
                <span className="font-semibold text-slate-900">
                  Control de Aislamiento por Almacén (Caso E):
                </span>{' '}
                Su usuario no tiene acceso a:{' '}
                {unauthorizedWarehouses.map((u) => u.name).join(', ')}. Puede comprobar que el
                servidor bloquea consultas forzadas por ID:
              </div>
              <div className="flex items-center gap-2">
                {unauthorizedWarehouses.map((uw) => (
                  <button
                    key={uw.id}
                    onClick={() => triggerIdorAttempt(uw.id)}
                    className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 text-slate-800 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    Probar lectura forzada de {uw.name}
                  </button>
                ))}
              </div>
              {idorTestStatus && (
                <div className="w-full text-xs font-mono text-red-700 bg-red-50 border border-red-200 rounded px-3 py-1.5">
                  Respuesta del Servidor: {idorTestStatus} (Intento registrado en Auditoría de Seguridad)
                </div>
              )}
            </div>
          )}

          {/* Responsive Cards & Table of Balances by Product */}
          <div className="grid grid-cols-1 gap-4">
            {filteredProducts.map((product) => {
              const prodBalances = data.balances.filter(
                (b) =>
                  b.productId === product.id &&
                  (selectedWarehouseId === 'ALL' || b.warehouseId === selectedWarehouseId)
              );

              const availableSum = prodBalances
                .filter((b) => b.status === 'AVAILABLE')
                .reduce((acc, b) => acc + b.quantity, 0);
              const reservedSum = prodBalances
                .filter((b) => b.status === 'RESERVED_ORDER')
                .reduce((acc, b) => acc + b.quantity, 0);
              const inProductionSum = prodBalances
                .filter(
                  (b) =>
                    b.status === 'IN_PRODUCTION_CUSTODY' ||
                    b.status === 'IN_TRANSIT_PRODUCTION'
                )
                .reduce((acc, b) => acc + b.quantity, 0);
              const finishedPendingSum = prodBalances
                .filter(
                  (b) =>
                    b.status === 'FINISHED_PENDING_PICKUP' ||
                    b.status === 'FINISHED_IN_TRANSIT'
                )
                .reduce((acc, b) => acc + b.quantity, 0);
              const discrepancySum = prodBalances
                .filter((b) => b.status === 'DISCREPANCY_HOLD')
                .reduce((acc, b) => acc + b.quantity, 0);

              const isLowStock =
                product.productType !== 'FINISHED_GOOD' &&
                availableSum > 0 &&
                availableSum <= product.minStockAlert;

              return (
                <div
                  key={product.id}
                  className="bg-white rounded-lg border border-slate-200 p-4 transition-colors hover:border-slate-300"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Left: Thumbnail & Metadata */}
                    <div className="flex items-start gap-4">
                      <button
                        type="button"
                        onClick={() => setZoomPhotoProduct(product)}
                        className="relative w-20 h-16 rounded-md overflow-hidden border border-slate-200 bg-slate-900 shrink-0 group"
                        title="Ampliar fotografía"
                      >
                        {product.imageUrl ? (
                          <img
                            src={product.imageUrl}
                            alt={product.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-400">
                            <Package className="w-6 h-6" />
                          </div>
                        )}
                        <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                          <Eye className="w-4 h-4 text-white" />
                        </span>
                      </button>

                      <div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-mono font-semibold text-slate-800">
                            {product.sku}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>{product.family}</span>
                          <span aria-hidden="true">·</span>
                          <span>{product.brand}</span>
                          {product.capacity !== 'N/A' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-semibold text-slate-700">
                                {product.capacity}
                              </span>
                            </>
                          )}
                          {product.material !== 'N/A' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{product.material}</span>
                            </>
                          )}
                        </div>
                        <h3 className="text-base font-semibold text-slate-900 mt-0.5">
                          {product.name}
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Conversión: 1 caja = {formatInt(product.unitsPerBox)}{' '}
                          {product.unitName} · Alerta mínimo: {formatInt(product.minStockAlert)} u.
                          {isLowStock && (
                            <span className="ml-2 text-amber-700 font-semibold">
                              (Stock bajo el nivel mínimo de reposición)
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Right: Non-duplicated State Breakdown (Tabular Numerals) */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                      <div className="text-right px-3 py-1.5 bg-slate-50 rounded">
                        <div className="text-[11px] text-slate-500">Disponible Libre</div>
                        <div className="text-base font-mono font-bold text-emerald-700 tabular-nums">
                          {formatInt(availableSum)}
                        </div>
                      </div>
                      <div className="text-right px-3 py-1.5 bg-slate-50 rounded">
                        <div className="text-[11px] text-slate-500">Reservado OP</div>
                        <div className="text-base font-mono font-semibold text-amber-700 tabular-nums">
                          {formatInt(reservedSum)}
                        </div>
                      </div>
                      <div className="text-right px-3 py-1.5 bg-slate-50 rounded">
                        <div className="text-[11px] text-slate-500">Custodia Prod.</div>
                        <div className="text-base font-mono font-semibold text-sky-700 tabular-nums">
                          {formatInt(inProductionSum)}
                        </div>
                      </div>
                      <div className="text-right px-3 py-1.5 bg-slate-50 rounded">
                        <div className="text-[11px] text-slate-500">Terminado p/ Retiro</div>
                        <div className="text-base font-mono font-semibold text-indigo-700 tabular-nums">
                          {formatInt(finishedPendingSum)}
                        </div>
                      </div>
                      <div className="text-right px-3 py-1.5 bg-slate-50 rounded">
                        <div className="text-[11px] text-slate-500">En Discrepancia</div>
                        <div
                          className={`text-base font-mono font-semibold tabular-nums ${
                            discrepancySum > 0 ? 'text-red-600' : 'text-slate-400'
                          }`}
                        >
                          {formatInt(discrepancySum)}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Detailed Physical Locations Breakdown */}
                  {prodBalances.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <div className="text-xs font-medium text-slate-600 mb-2">
                        Desglose exacto por Almacén, Sección/Estante y Custodia:
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs text-left">
                          <thead>
                            <tr className="text-slate-500 border-b border-slate-100">
                              <th className="py-1.5 pr-3 font-medium">Almacén</th>
                              <th className="py-1.5 px-3 font-medium">Ubicación Física (Sección / Estante)</th>
                              <th className="py-1.5 px-3 font-medium">Estado / Custodia</th>
                              <th className="py-1.5 px-3 font-medium">Orden Vinculada</th>
                              <th className="py-1.5 pl-3 text-right font-medium">Cantidad (Piezas)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {prodBalances.map((bal) => {
                              const wh = data.warehouses.find((w) => w.id === bal.warehouseId);
                              const loc = data.locations.find((l) => l.id === bal.locationId);
                              const ord = data.productionOrders.find(
                                (o) => o.id === bal.productionOrderId
                              );
                              return (
                                <tr key={bal.id} className="hover:bg-slate-50">
                                  <td className="py-1.5 pr-3 font-medium text-slate-900">
                                    {wh?.name || `Almacén #${bal.warehouseId}`}
                                  </td>
                                  <td className="py-1.5 px-3 text-slate-600">
                                    {loc
                                      ? `${loc.zoneName} › ${loc.shelfName} (${loc.code})`
                                      : `Ubicación #${bal.locationId}`}
                                  </td>
                                  <td className="py-1.5 px-3 font-medium text-slate-800">
                                    {translateStatus(bal.status)}
                                  </td>
                                  <td className="py-1.5 px-3 font-mono text-slate-600">
                                    {ord ? ord.orderNumber : 'Libre / General'}
                                  </td>
                                  <td className="py-1.5 pl-3 text-right font-mono font-semibold text-slate-900 tabular-nums">
                                    {formatInt(bal.quantity)}
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
              );
            })}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: INGRESO DE MERCANCÍA DE PROVEEDOR O CONTENEDOR                 */}
      {/* ===================================================================== */}
      {subTab === 'INGRESO' && (
        <div className="bg-white rounded-lg border border-slate-200 p-6 max-w-4xl">
          <h2 className="text-lg font-semibold text-slate-900">
            01. Recepción e Ingreso de Mercancía (Proveedor / Contenedor)
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Todo ingreso confirmado genera un folio único del servidor, incrementa el saldo de forma
            atómica y queda registrado en el libro mayor inmutable.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Tipo de Documento de Ingreso
              </label>
              <select
                value={receiptMovementType}
                onChange={(e) => setReceiptMovementType(e.target.value as any)}
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 bg-white"
              >
                <option value="INGRESO_PROVEEDOR">Ingreso de Proveedor / Contenedor</option>
                <option value="APERTURA_INICIAL">Movimiento de Apertura Inicial Auditada</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Proveedor / Referencia de Contenedor o Póliza
              </label>
              <input
                type="text"
                value={supplierOrContainer}
                onChange={(e) => setSupplierOrContainer(e.target.value)}
                placeholder="Ej. Contenedor Shenzhen #402 / Proveedor Local"
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Almacén Destino Autorizado
              </label>
              <select
                value={receiptWarehouseId}
                onChange={(e) => {
                  const wId = Number(e.target.value);
                  setReceiptWarehouseId(wId);
                  const firstLoc = data.locations.find((l) => l.warehouseId === wId);
                  if (firstLoc) setReceiptLocationId(firstLoc.id);
                }}
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 bg-white"
              >
                {data.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} ({w.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Ubicación Física (Sección / Cuarto / Estante)
              </label>
              <select
                value={receiptLocationId}
                onChange={(e) => setReceiptLocationId(Number(e.target.value))}
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 bg-white"
              >
                {data.locations
                  .filter((l) => l.warehouseId === receiptWarehouseId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.zoneName} › {l.shelfName} ({l.code})
                    </option>
                  ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Producto / Componente a Ingresar (SKU)
              </label>
              <select
                value={receiptProductId}
                onChange={(e) => setReceiptProductId(Number(e.target.value))}
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 bg-white font-mono"
              >
                {data.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name} ({p.brand} · {p.capacity})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Modo de Captura de Cantidad
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setReceiptInputMode('UNITS')}
                  className={`px-3 py-2 text-xs font-medium rounded-md border ${
                    receiptInputMode === 'UNITS'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  Por Piezas Enteras
                </button>
                <button
                  type="button"
                  onClick={() => setReceiptInputMode('BOXES')}
                  className={`px-3 py-2 text-xs font-medium rounded-md border ${
                    receiptInputMode === 'BOXES'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  Por Cajas Cerradas (1 caja = {formatInt(selectedReceiptProduct?.unitsPerBox || 1000)} pzs)
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {receiptInputMode === 'UNITS'
                  ? 'Cantidad Exacta en Piezas'
                  : 'Cantidad de Cajas Cerradas'}
              </label>
              {receiptInputMode === 'UNITS' ? (
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={receiptQuantity}
                  onChange={(e) => setReceiptQuantity(Math.max(1, parseInt(e.target.value || '0', 10)))}
                  className="w-full text-sm font-mono border border-slate-300 rounded-md px-3 py-2"
                />
              ) : (
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={receiptBoxesCount}
                    onChange={(e) =>
                      setReceiptBoxesCount(Math.max(1, parseInt(e.target.value || '1', 10)))
                    }
                    className="w-32 text-sm font-mono border border-slate-300 rounded-md px-3 py-2"
                  />
                  <span className="text-xs font-mono text-slate-700">
                    = {formatInt(effectiveReceiptUnits)} piezas enteras
                  </span>
                </div>
              )}
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Observaciones / Estado de Cajas o Lote
              </label>
              <input
                type="text"
                value={receiptNotes}
                onChange={(e) => setReceiptNotes(e.target.value)}
                placeholder="Observaciones de recepción física"
                className="w-full text-sm border border-slate-300 rounded-md px-3 py-2"
              />
            </div>

            {/* Optional Private Landed Cost Section (Visible ONLY to OWNER) */}
            {canViewCosts && (
              <div className="md:col-span-2 pt-4 border-t border-slate-200">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includePrivateCost}
                    onChange={(e) => setIncludePrivateCost(e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  Registrar Costos Privados de Importación/Compra para este Lote (Exclusivo Propietario — Oculto al Personal)
                </label>

                {includePrivateCost && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 p-3.5 bg-slate-50 rounded-md border border-slate-200">
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-1">
                        Costo FOB Total (USD)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={fobCost}
                        onChange={(e) => setFobCost(Number(e.target.value))}
                        className="w-full text-xs font-mono border border-slate-300 rounded px-2.5 py-1.5 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-1">
                        Transporte / Flete (USD)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={freightCost}
                        onChange={(e) => setFreightCost(Number(e.target.value))}
                        className="w-full text-xs font-mono border border-slate-300 rounded px-2.5 py-1.5 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-1">
                        Póliza / Aduana (USD)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={customsCost}
                        onChange={(e) => setCustomsCost(Number(e.target.value))}
                        className="w-full text-xs font-mono border border-slate-300 rounded px-2.5 py-1.5 bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-600 mb-1">
                        Otros Gastos (USD)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={otherCost}
                        onChange={(e) => setOtherCost(Number(e.target.value))}
                        className="w-full text-xs font-mono border border-slate-300 rounded px-2.5 py-1.5 bg-white"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-4 text-xs font-mono text-slate-800 pt-1">
                      Costo Total Puesto en Almacén: USD{' '}
                      {(fobCost + freightCost + customsCost + otherCost).toFixed(2)} · Costo Unitario
                      Calculado: USD{' '}
                      {effectiveReceiptUnits > 0
                        ? (
                            (fobCost + freightCost + customsCost + otherCost) /
                            effectiveReceiptUnits
                          ).toFixed(4)
                        : '0.0000'}{' '}
                      / pieza
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              disabled={!isOnline}
              onClick={openReceiptPreview}
              className="px-4 py-2.5 text-xs font-semibold text-white bg-sky-600 rounded-md hover:bg-sky-700 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              <ArrowDownToLine className="w-4 h-4" />
              Revisar y Confirmar Ingreso
            </button>
          </div>

          {/* Preview & Idempotent Confirmation Box */}
          {receiptPreviewOpen && selectedReceiptProduct && (
            <div className="mt-6 p-5 bg-slate-50 border border-slate-300 rounded-lg space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Resumen de Verificación Antes de Confirmar en Servidor
                </h3>
                <span className="text-xs font-mono text-slate-500">
                  Clave Idempotencia: {receiptIdempotencyKey}
                </span>
              </div>
              <div className="flex items-center gap-4">
                <img
                  src={selectedReceiptProduct.imageUrl}
                  alt={selectedReceiptProduct.name}
                  referrerPolicy="no-referrer"
                  className="w-20 h-14 object-cover rounded border border-slate-200"
                />
                <div className="text-xs space-y-1">
                  <div className="font-semibold text-slate-900">
                    {selectedReceiptProduct.sku} — {selectedReceiptProduct.name}
                  </div>
                  <div className="text-slate-600">
                    Cantidad a sumar atómicamente:{' '}
                    <span className="font-mono font-bold text-emerald-700">
                      +{formatInt(effectiveReceiptUnits)} piezas
                    </span>
                  </div>
                  <div className="text-slate-600">
                    Destino:{' '}
                    {data.warehouses.find((w) => w.id === receiptWarehouseId)?.name} ›{' '}
                    {data.locations.find((l) => l.id === receiptLocationId)?.zoneName} ›{' '}
                    {data.locations.find((l) => l.id === receiptLocationId)?.shelfName}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setReceiptPreviewOpen(false)}
                  className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
                >
                  Modificar Datos
                </button>
                <button
                  type="button"
                  disabled={submitting || !isOnline}
                  onClick={confirmGoodsReceipt}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-50"
                >
                  {submitting ? 'Confirmando en Servidor...' : 'Confirmar Ingreso Definitivo'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: CATÁLOGO MAESTRO DE PRODUCTOS Y FOTOGRAFÍAS                    */}
      {/* ===================================================================== */}
      {subTab === 'CATALOGO' && (
        <div className="space-y-6">
          {isOwnerOrAdmin ? (
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h2 className="text-base font-semibold text-slate-900">
                Alta de Nuevo SKU en Catálogo Maestro (Con Detector de Duplicados y Fotografía)
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Los kits de empaque (papel + blíster) se registran como un solo SKU. El adaptador SD
                universal y los chips UDP se registran como SKUs independientes.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Código SKU Único
                  </label>
                  <input
                    type="text"
                    value={newSku}
                    onChange={(e) => setNewSku(e.target.value.toUpperCase())}
                    placeholder="Ej. CASE-HP-GOMA-16G"
                    className="w-full text-sm font-mono border border-slate-300 rounded-md px-3 py-2"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nombre Descriptivo del Producto / Componente
                  </label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Ej. Case USB Goma Azul modelo v250"
                    className="w-full text-sm border border-slate-300 rounded-md px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Clasificación Contable
                  </label>
                  <select
                    value={newProductType}
                    onChange={(e) => setNewProductType(e.target.value as any)}
                    className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 bg-white"
                  >
                    <option value="STRATEGIC_COMPONENT">Componente Estratégico (UDP / microSD)</option>
                    <option value="SECONDARY_COMPONENT">Componente Específico (Case USB)</option>
                    <option value="PACKAGING_KIT">Kit de Empaque (Papel + Blíster junto)</option>
                    <option value="UNIVERSAL_ACCESSORY">Accesorio Universal (Adaptador SD)</option>
                    <option value="FINISHED_GOOD">Producto Terminado Empaquetado</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Familia</label>
                  <select
                    value={newFamily}
                    onChange={(e) => setNewFamily(e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 bg-white"
                  >
                    <option value="UDP">UDP</option>
                    <option value="MICROSD">MICROSD</option>
                    <option value="ADAPTADOR">ADAPTADOR</option>
                    <option value="CASE">CASE</option>
                    <option value="EMPAQUE">EMPAQUE</option>
                    <option value="USB_TERMINADO">USB_TERMINADO</option>
                    <option value="MICROSD_TERMINADA">MICROSD_TERMINADA</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Marca</label>
                  <input
                    type="text"
                    value={newBrand}
                    onChange={(e) => setNewBrand(e.target.value)}
                    placeholder="Ej. HP, Sony, Samsung, Kingston"
                    className="w-full text-sm border border-slate-300 rounded-md px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Modelo</label>
                  <input
                    type="text"
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    placeholder="Ej. v220w, Bar Plus"
                    className="w-full text-sm border border-slate-300 rounded-md px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Capacidad</label>
                  <select
                    value={newCapacity}
                    onChange={(e) => setNewCapacity(e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 bg-white"
                  >
                    <option value="N/A">N/A (No aplica)</option>
                    <option value="8GB">8 GB</option>
                    <option value="16GB">16 GB</option>
                    <option value="32GB">32 GB</option>
                    <option value="64GB">64 GB</option>
                    <option value="128GB">128 GB</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Color</label>
                  <input
                    type="text"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded-md px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Material</label>
                  <select
                    value={newMaterial}
                    onChange={(e) => setNewMaterial(e.target.value)}
                    className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 bg-white"
                  >
                    <option value="Metal">Metal</option>
                    <option value="Plástico">Plástico</option>
                    <option value="Goma">Goma</option>
                    <option value="Papel+Blíster">Papel + Blíster</option>
                    <option value="Silicio">Silicio</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Unidades por Caja
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={newUnitsPerBox}
                    onChange={(e) => setNewUnitsPerBox(Number(e.target.value))}
                    className="w-full text-sm font-mono border border-slate-300 rounded-md px-3 py-2"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Alerta Stock Mínimo
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={newMinStock}
                    onChange={(e) => setNewMinStock(Number(e.target.value))}
                    className="w-full text-sm font-mono border border-slate-300 rounded-md px-3 py-2"
                  />
                </div>

                <div className="sm:col-span-3 flex flex-wrap items-center justify-between gap-4 pt-2">
                  <div className="flex items-center gap-3">
                    <label className="px-3 py-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-md cursor-pointer flex items-center gap-2 border border-slate-300">
                      <Camera className="w-4 h-4" />
                      Tomar Foto / Subir Imagen (Android o PC)
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={handlePhotoUpload}
                        className="hidden"
                      />
                    </label>
                    {newImageUrl && (
                      <img
                        src={newImageUrl}
                        alt="Vista previa"
                        className="w-16 h-12 object-cover rounded border border-slate-300"
                      />
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={submitting || !isOnline}
                    onClick={() => handleCreateProduct(false)}
                    className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50"
                  >
                    Guardar Producto en Catálogo
                  </button>
                </div>
              </div>

              {duplicateWarningData && (
                <div className="mt-4 p-4 bg-amber-50 border border-amber-300 rounded-md flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-amber-900">
                    <strong>Advertencia de posible duplicado:</strong> {duplicateWarningData.error}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCreateProduct(true)}
                    className="px-3 py-1.5 text-xs font-semibold bg-amber-700 text-white rounded"
                  >
                    Confirmar creación de todos modos
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-100 border border-slate-200 rounded-lg p-4 text-xs text-slate-700">
              Modo de consulta: Los trabajadores operativos pueden ver las fotografías y códigos SKU
              para evitar errores de modelo o color, pero solo el Propietario/Administrador puede
              modificar el catálogo maestro.
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 4: RECETAS DE ENSAMBLAJE VERSIONADAS (BOM)                        */}
      {/* ===================================================================== */}
      {subTab === 'RECETAS' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.recipes.map((rec) => {
              const finProd = data.products.find((p) => p.id === rec.finishedProductId);
              return (
                <div
                  key={rec.id}
                  className="bg-white rounded-lg border border-slate-200 p-5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span className="font-mono font-semibold text-slate-800">{rec.code}</span>
                      <span>Versión activa: v{rec.versionNumber} (Inmutable en historial)</span>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900 mt-1">{rec.name}</h3>
                    {finProd && (
                      <div className="mt-2 flex items-center gap-3 p-2.5 bg-slate-50 rounded border border-slate-200">
                        <img
                          src={finProd.imageUrl}
                          alt={finProd.name}
                          referrerPolicy="no-referrer"
                          className="w-14 h-10 object-cover rounded"
                        />
                        <div className="text-xs">
                          <div className="text-slate-500">Producto Terminado que Genera:</div>
                          <div className="font-mono font-semibold text-emerald-800">
                            {finProd.sku} — {finProd.name}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="mt-3">
                      <div className="text-xs font-medium text-slate-700 mb-1.5">
                        Componentes consumidos por cada 1 unidad fabricada:
                      </div>
                      <ul className="space-y-1.5 text-xs">
                        {rec.components.map((c) => {
                          const compProd = data.products.find(
                            (p) => p.id === c.componentProductId
                          );
                          return (
                            <li
                              key={c.id}
                              className="flex items-center justify-between py-1 px-2 bg-slate-50 rounded"
                            >
                              <div>
                                <span className="font-mono font-medium text-slate-900">
                                  {compProd?.sku}
                                </span>{' '}
                                — {compProd?.name}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[11px] text-slate-500">
                                  {c.isStrategicOrderBound
                                    ? 'De Custodia OP'
                                    : 'De Stock Local Taller'}
                                </span>
                                <span className="font-mono font-bold text-slate-900">
                                  {c.quantityPerUnit} u.
                                </span>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {isOwnerOrAdmin && (
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <h3 className="text-base font-semibold text-slate-900">
                Crear Nueva Receta de Ensamblaje (BOM)
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Código de Receta
                  </label>
                  <input
                    type="text"
                    value={recCode}
                    onChange={(e) => setRecCode(e.target.value.toUpperCase())}
                    placeholder="Ej. REC-USB-HP-16G"
                    className="w-full text-sm font-mono border border-slate-300 rounded-md px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nombre de Receta
                  </label>
                  <input
                    type="text"
                    value={recName}
                    onChange={(e) => setRecName(e.target.value)}
                    placeholder="Ej. Ensamblaje USB HP 16GB"
                    className="w-full text-sm border border-slate-300 rounded-md px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    SKU Producto Terminado Objetivo
                  </label>
                  <select
                    value={recFinishedId}
                    onChange={(e) => setRecFinishedId(Number(e.target.value))}
                    className="w-full text-sm border border-slate-300 rounded-md px-3 py-2 bg-white font-mono"
                  >
                    {data.products
                      .filter((p) => p.productType === 'FINISHED_GOOD')
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-slate-700">
                    Lista de Materiales (BOM) por 1 unidad terminada:
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setRecComponents([
                        ...recComponents,
                        {
                          componentProductId: data.products[0]?.id || 1,
                          quantityPerUnit: 1,
                          isStrategicOrderBound: false,
                        },
                      ])
                    }
                    className="px-3 py-1 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded"
                  >
                    + Añadir Componente
                  </button>
                </div>

                {recComponents.map((rc, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-3 mb-2">
                    <select
                      value={rc.componentProductId}
                      onChange={(e) => {
                        const copy = [...recComponents];
                        copy[idx].componentProductId = Number(e.target.value);
                        setRecComponents(copy);
                      }}
                      className="flex-1 text-xs font-mono border border-slate-300 rounded px-2.5 py-1.5 bg-white"
                    >
                      {data.products
                        .filter((p) => p.productType !== 'FINISHED_GOOD')
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} — {p.name}
                          </option>
                        ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      value={rc.quantityPerUnit}
                      onChange={(e) => {
                        const copy = [...recComponents];
                        copy[idx].quantityPerUnit = Math.max(1, Number(e.target.value));
                        setRecComponents(copy);
                      }}
                      className="w-20 text-xs font-mono border border-slate-300 rounded px-2.5 py-1.5"
                    />
                    <label className="flex items-center gap-1.5 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={rc.isStrategicOrderBound}
                        onChange={(e) => {
                          const copy = [...recComponents];
                          copy[idx].isStrategicOrderBound = e.target.checked;
                          setRecComponents(copy);
                        }}
                      />
                      Componente Estratégico de Orden (UDP/microSD)
                    </label>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  disabled={submitting || !isOnline}
                  onClick={handleCreateRecipe}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
                >
                  Guardar Receta Versionada
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 5: ALMACENES, SECCIONES Y ESTANTES                                */}
      {/* ===================================================================== */}
      {subTab === 'ALMACENES' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {data.warehouses.map((w) => {
              const whLocs = data.locations.filter((l) => l.warehouseId === w.id);
              return (
                <div key={w.id} className="bg-white rounded-lg border border-slate-200 p-5">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span className="font-mono font-semibold text-slate-800">{w.code}</span>
                    <span>{w.isProductionPlant ? 'Planta / Taller Producción' : 'Almacén Custodia'}</span>
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 mt-1">{w.name}</h3>
                  <p className="text-xs text-slate-600 mt-0.5">{w.description}</p>
                  <p className="text-xs text-slate-500 mt-1">{w.address}</p>

                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <div className="text-xs font-medium text-slate-700 mb-2">
                      Ubicaciones internas configuradas ({whLocs.length}):
                    </div>
                    <ul className="space-y-1.5 text-xs">
                      {whLocs.map((l) => (
                        <li
                          key={l.id}
                          className="p-2 bg-slate-50 rounded border border-slate-100 flex items-center justify-between"
                        >
                          <div>
                            <div className="font-medium text-slate-800">
                              {l.zoneName} › {l.shelfName}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500">{l.code}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              );
            })}
          </div>

          {isOwnerOrAdmin && (
            <div className="bg-white rounded-lg border border-slate-200 p-5 max-w-2xl">
              <h3 className="text-sm font-semibold text-slate-900">
                Agregar Nueva Sección / Estante a un Almacén
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Almacén</label>
                  <select
                    value={locWhId}
                    onChange={(e) => setLocWhId(Number(e.target.value))}
                    className="w-full text-xs border border-slate-300 rounded px-2.5 py-2 bg-white"
                  >
                    {data.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Código Corto Ubicación
                  </label>
                  <input
                    type="text"
                    value={locCode}
                    onChange={(e) => setLocCode(e.target.value.toUpperCase())}
                    placeholder="Ej. SEN-SECK-EST3"
                    className="w-full text-xs font-mono border border-slate-300 rounded px-2.5 py-2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Sección / Cuarto / Habitación
                  </label>
                  <input
                    type="text"
                    value={locZone}
                    onChange={(e) => setLocZone(e.target.value)}
                    placeholder="Ej. Sección K - Cuarto de Empaques"
                    className="w-full text-xs border border-slate-300 rounded px-2.5 py-2"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Estante / Casillero
                  </label>
                  <input
                    type="text"
                    value={locShelf}
                    onChange={(e) => setLocShelf(e.target.value)}
                    placeholder="Ej. Estante 3"
                    className="w-full text-xs border border-slate-300 rounded px-2.5 py-2"
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  disabled={submitting || !isOnline}
                  onClick={handleCreateLocation}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
                >
                  Crear Ubicación
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal to Zoom Product Photo */}
      {zoomPhotoProduct && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setZoomPhotoProduct(null)}
        >
          <div
            className="bg-white rounded-lg max-w-lg w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono text-xs font-semibold text-slate-600">
                  {zoomPhotoProduct.sku}
                </span>
                <h3 className="text-base font-semibold text-slate-900">
                  {zoomPhotoProduct.name}
                </h3>
              </div>
              <button
                onClick={() => setZoomPhotoProduct(null)}
                className="text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Cerrar [X]
              </button>
            </div>
            <img
              src={zoomPhotoProduct.imageUrl}
              alt={zoomPhotoProduct.name}
              referrerPolicy="no-referrer"
              className="w-full h-64 object-contain bg-slate-950 rounded-md border border-slate-200"
            />
            <div className="text-xs text-slate-600 flex flex-wrap gap-3">
              <span>Marca: {zoomPhotoProduct.brand}</span>
              <span>·</span>
              <span>Modelo: {zoomPhotoProduct.model}</span>
              <span>·</span>
              <span>Capacidad: {zoomPhotoProduct.capacity}</span>
              <span>·</span>
              <span>Material: {zoomPhotoProduct.material}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
