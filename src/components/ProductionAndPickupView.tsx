import React, { useState } from 'react';
import {
  Factory,
  Plus,
  Trash2,
  Edit3,
  CheckCircle2,
  AlertTriangle,
  PackageCheck,
  X,
} from 'lucide-react';
import {
  WorkspaceData,
  ProductionOrder,
  Recipe,
  formatInt,
  formatBoliviaDateTime,
} from '../types.ts';

interface Props {
  data: WorkspaceData;
  isOnline: boolean;
  initialSubView?: 'ORDENES' | 'RECETAS' | 'RECOGIDA';
  apiFetch: (url: string, options?: RequestInit) => Promise<any>;
  onRefresh: () => Promise<void>;
}

export function ProductionAndPickupView({
  data,
  isOnline,
  initialSubView = 'ORDENES',
  apiFetch,
  onRefresh,
}: Props) {
  const [subTab, setSubTab] = useState<'ORDENES' | 'RECETAS' | 'RECOGIDA'>(initialSubView);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    setSubTab(initialSubView);
  }, [initialSubView]);

  const isAdmin = data.user.role === 'OWNER' || data.user.role === 'ADMIN';

  // =========================================================================
  // 1. RECIPES (BOM) MODAL STATE (Create & Edit)
  // =========================================================================
  const [recipeModalOpen, setRecipeModalOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [recName, setRecName] = useState('');
  const [recFinishedId, setRecFinishedId] = useState<number>(0);
  const [recComponents, setRecComponents] = useState<
    { componentProductId: number; quantityPerUnit: number; isStrategicOrderBound: boolean }[]
  >([]);

  // =========================================================================
  // 2. NEW PRODUCTION ORDER MODAL STATE
  // =========================================================================
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [opStrategicId, setOpStrategicId] = useState<number>(0);
  const [opAuthorizedQty, setOpAuthorizedQty] = useState<number>(1000);
  const [opSourceWhId, setOpSourceWhId] = useState<number>(data.warehouses[0]?.id || 0);
  const [opTargetWhId, setOpTargetWhId] = useState<number>(
    data.allWarehousesSummary.find((w) => w.isProductionPlant)?.id ||
      data.warehouses[0]?.id ||
      0
  );
  const [opInstructions, setOpInstructions] = useState('');

  // =========================================================================
  // 3. REGISTER PRODUCTION BATCH MODAL STATE
  // =========================================================================
  const [produceModalOrder, setProduceModalOrder] = useState<ProductionOrder | null>(null);
  const [produceRecipeId, setProduceRecipeId] = useState<number>(0);
  const [produceQty, setProduceQty] = useState<number>(500);
  const [produceNotes, setProduceNotes] = useState('');

  // Inline states for dispatch, acknowledge, and finished goods pickup
  const [ackInputs, setAckInputs] = useState<Record<number, { qty: number; notes: string }>>({});
  const [fgDestWarehouseId, setFgDestWarehouseId] = useState<number>(
    data.allWarehousesSummary.find((w) => w.code === 'ALM-PUENTEBOLIVIA')?.id ||
      data.allWarehousesSummary[0]?.id ||
      0
  );
  const [fgDispatchQtyMap, setFgDispatchQtyMap] = useState<Record<string, number>>({});

  const finishedProducts = data.products.filter(
    (p) => p.productType === 'FINISHED_GOOD' || p.family.toLowerCase().includes('terminado')
  );
  const componentProducts = data.products.filter((p) => p.productType !== 'FINISHED_GOOD');
  const strategicProducts = data.products.filter(
    (p) =>
      p.productType === 'STRATEGIC_COMPONENT' ||
      p.family.toLowerCase().includes('udp') ||
      p.family.toLowerCase().includes('microsd')
  );

  // Recipe Handlers
  const openCreateRecipeModal = () => {
    setEditingRecipe(null);
    setRecName('');
    const defFin = finishedProducts[0]?.id || data.products[0]?.id || 0;
    setRecFinishedId(defFin);
    const defComp = componentProducts[0]?.id || data.products[0]?.id || 0;
    setRecComponents([
      {
        componentProductId: defComp,
        quantityPerUnit: 1,
        isStrategicOrderBound: true,
      },
    ]);
    setRecipeModalOpen(true);
  };

  const openEditRecipeModal = (rec: Recipe) => {
    setEditingRecipe(rec);
    setRecName(rec.name);
    setRecFinishedId(rec.finishedProductId);
    setRecComponents(
      rec.components.map((c) => ({
        componentProductId: c.componentProductId,
        quantityPerUnit: c.quantityPerUnit,
        isStrategicOrderBound: c.isStrategicOrderBound,
      }))
    );
    setRecipeModalOpen(true);
  };

  const handleSaveRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || !recName.trim() || !recFinishedId || recComponents.length === 0) {
      setFeedback({
        type: 'error',
        text: 'Complete el nombre de la receta, el producto terminado y al menos un insumo.',
      });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      await apiFetch('/api/recipes', {
        method: 'POST',
        body: JSON.stringify({
          recipeId: editingRecipe?.id,
          name: recName,
          finishedProductId: recFinishedId,
          components: recComponents,
        }),
      });
      setRecipeModalOpen(false);
      setFeedback({
        type: 'success',
        text: editingRecipe
          ? `Receta "${recName}" actualizada.`
          : `Receta "${recName}" creada correctamente.`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRecipe = async (rec: Recipe) => {
    if (!isOnline) return;
    setSubmitting(true);
    try {
      await apiFetch(`/api/recipes/${rec.id}`, { method: 'DELETE' });
      setFeedback({ type: 'success', text: `Receta "${rec.name}" eliminada.` });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  // Production Order Handlers
  const openCreateOrderModal = () => {
    const firstStrat = strategicProducts[0]?.id || data.products[0]?.id || 0;
    setOpStrategicId(firstStrat);
    setOpAuthorizedQty(1000);
    setOpSourceWhId(data.warehouses[0]?.id || 0);
    setOpTargetWhId(
      data.allWarehousesSummary.find((w) => w.isProductionPlant)?.id ||
        data.warehouses[0]?.id ||
        0
    );
    setOpInstructions('');
    setOrderModalOpen(true);
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || !opStrategicId || opAuthorizedQty <= 0) return;

    const srcLoc = data.allLocationsSummary.find((l) => l.warehouseId === opSourceWhId);
    const dstLoc = data.allLocationsSummary.find((l) => l.warehouseId === opTargetWhId);
    if (!srcLoc || !dstLoc) {
      setFeedback({ type: 'error', text: 'Seleccione almacenes con ubicaciones válidas.' });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/production/orders', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `OP-${Date.now()}`,
          sourceWarehouseId: opSourceWhId,
          sourceLocationId: srcLoc.id,
          targetWarehouseId: opTargetWhId,
          targetLocationId: dstLoc.id,
          assignedUserId: data.user.id,
          strategicProductId: opStrategicId,
          authorizedQty: opAuthorizedQty,
          allowedRecipeIds: [],
          priority: 'NORMAL',
          instructions: opInstructions,
        }),
      });
      setOrderModalOpen(false);
      setFeedback({
        type: 'success',
        text: `Orden ${res.order.orderNumber} creada con ${formatInt(opAuthorizedQty)} unidades reservadas.`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDispatchOrder = async (order: ProductionOrder) => {
    if (!isOnline) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      await apiFetch('/api/production/dispatches', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `DESP-${order.id}-${Date.now()}`,
          productionOrderId: order.id,
          dispatchQty: order.reservedQty,
          notes: 'Despacho a producción',
        }),
      });
      setFeedback({
        type: 'success',
        text: `Se despacharon ${formatInt(order.reservedQty)} unidades al taller de producción.`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcknowledgeDispatch = async (dispatchId: number, defaultQty: number) => {
    if (!isOnline) return;
    const input = ackInputs[dispatchId] || { qty: defaultQty, notes: '' };
    setSubmitting(true);
    setFeedback(null);
    try {
      await apiFetch('/api/production/acknowledge', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `ACK-${dispatchId}-${Date.now()}`,
          dispatchId,
          receivedQty: input.qty,
          notes: input.notes,
        }),
      });
      setFeedback({
        type: 'success',
        text: `Recepción confirmada en taller (${formatInt(input.qty)} unidades listas para fabricar).`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmProductionBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || !produceModalOrder || !produceRecipeId || produceQty <= 0) return;

    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/production/batches', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `BATCH-${produceModalOrder.id}-${Date.now()}`,
          productionOrderId: produceModalOrder.id,
          items: [
            {
              recipeId: produceRecipeId,
              quantityToProduce: produceQty,
              notes: produceNotes,
            },
          ],
        }),
      });
      setProduceModalOrder(null);
      setFeedback({
        type: 'success',
        text: `Producción confirmada (${res.document.folio}): Se fabricaron +${formatInt(
          produceQty
        )} unidades y se descontaron sus insumos por receta.`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  // Pickup Handlers
  const finishedPendingBalances = data.balances.filter(
    (b) => b.status === 'FINISHED_PENDING_PICKUP' && b.quantity > 0
  );

  const handleDispatchFinished = async (
    orderId: number,
    productId: number,
    maxAvailable: number
  ) => {
    if (!isOnline) return;
    const key = `${orderId}-${productId}`;
    const qty = fgDispatchQtyMap[key] ?? maxAvailable;
    const destLoc = data.allLocationsSummary.find((l) => l.warehouseId === fgDestWarehouseId);
    if (!destLoc) return;

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/finished-goods/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `FG-DISP-${key}-${Date.now()}`,
          productionOrderId: orderId,
          finishedProductId: productId,
          toWarehouseId: fgDestWarehouseId,
          toLocationId: destLoc.id,
          dispatchQty: qty,
        }),
      });
      setFeedback({
        type: 'success',
        text: `Entrega ${res.dispatch.dispatchFolio} enviada (${formatInt(qty)} unidades).`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReceiveFinished = async (dispatchId: number, qty: number) => {
    if (!isOnline) return;
    setSubmitting(true);
    try {
      await apiFetch('/api/finished-goods/receive', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `FG-REC-${dispatchId}-${Date.now()}`,
          dispatchId,
          receivedQty: qty,
        }),
      });
      setFeedback({
        type: 'success',
        text: `Recepción confirmada: +${formatInt(qty)} productos terminados disponibles en almacén.`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-4">
        <button
          onClick={() => setSubTab('ORDENES')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
            subTab === 'ORDENES'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
          }`}
        >
          Órdenes de Producción ({data.productionOrders.length})
        </button>
        <button
          onClick={() => setSubTab('RECETAS')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
            subTab === 'RECETAS'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
          }`}
        >
          Recetas de Ensamblaje ({data.recipes.length})
        </button>
        <button
          onClick={() => setSubTab('RECOGIDA')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-colors ${
            subTab === 'RECOGIDA'
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
          }`}
        >
          Recogida de Productos Terminados ({finishedPendingBalances.length})
        </button>
      </div>

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
      {/* TAB 1: ÓRDENES DE PRODUCCIÓN Y TRANSFORMACIÓN                         */}
      {/* ===================================================================== */}
      {subTab === 'ORDENES' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Órdenes de Producción y Entrega de Componentes
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Entrega componentes (UDP o microSD) al taller y registra los productos terminados
                que se fabrican descontando sus cases y empaques por receta.
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={openCreateOrderModal}
                className="px-4 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Nueva Orden de Producción
              </button>
            )}
          </div>

          {data.productionOrders.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center max-w-lg mx-auto space-y-3">
              <Factory className="w-8 h-8 text-slate-400 mx-auto" />
              <h3 className="text-sm font-bold text-slate-900">
                No hay órdenes de producción activas
              </h3>
              <p className="text-xs text-slate-600">
                Primero registra tus productos e insumos en la sección de Inventario, configura una
                receta de ensamblaje y luego emite tu primera orden de producción.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {data.productionOrders.map((order) => {
                const stratProd = data.products.find((p) => p.id === order.strategicProductId);
                const srcWh = data.allWarehousesSummary.find(
                  (w) => w.id === order.sourceWarehouseId
                );
                const dstWh = data.allWarehousesSummary.find(
                  (w) => w.id === order.targetWarehouseId
                );
                const custodyLeft =
                  order.receivedInProductionQty -
                  order.consumedQty -
                  order.returnedQty -
                  order.wasteQty;
                const dispatches = data.productionDispatches.filter(
                  (d) => d.productionOrderId === order.id
                );

                return (
                  <div
                    key={order.id}
                    className="bg-white rounded-xl border border-slate-200 p-5 space-y-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div>
                        <span className="font-mono text-xs font-bold text-sky-700">
                          {order.orderNumber} · {srcWh?.name} → {dstWh?.name}
                        </span>
                        <h3 className="text-base font-bold text-slate-900 mt-0.5">
                          Insumo Entregado: {stratProd?.name} ({stratProd?.sku})
                        </h3>
                      </div>

                      <div className="flex items-center gap-2">
                        {order.reservedQty > 0 && isAdmin && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleDispatchOrder(order)}
                            className="px-3.5 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg"
                          >
                            1. Despachar {formatInt(order.reservedQty)} u. al Taller
                          </button>
                        )}

                        {custodyLeft > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setProduceModalOrder(order);
                              const compatRec =
                                data.recipes.find((r) =>
                                  r.components.some(
                                    (c) => c.componentProductId === order.strategicProductId
                                  )
                                ) || data.recipes[0];
                              setProduceRecipeId(compatRec?.id || 0);
                              setProduceQty(Math.min(500, custodyLeft));
                            }}
                            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                          >
                            + Registrar Productos Fabricados
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div className="p-3 bg-slate-50 rounded-lg">
                        <div className="text-slate-500">Total Ordenado</div>
                        <div className="text-base font-mono font-bold text-slate-900">
                          {formatInt(order.authorizedQty)}
                        </div>
                      </div>
                      <div className="p-3 bg-slate-50 rounded-lg">
                        <div className="text-slate-500">Recibido en Taller</div>
                        <div className="text-base font-mono font-bold text-slate-900">
                          {formatInt(order.receivedInProductionQty)}
                        </div>
                      </div>
                      <div className="p-3 bg-emerald-50 rounded-lg">
                        <div className="text-emerald-800">Transformado / Fabricado</div>
                        <div className="text-base font-mono font-bold text-emerald-700">
                          {formatInt(order.consumedQty)}
                        </div>
                      </div>
                      <div className="p-3 bg-sky-50 rounded-lg">
                        <div className="text-sky-800">Saldo Pendiente en Taller</div>
                        <div className="text-base font-mono font-bold text-sky-700">
                          {formatInt(custodyLeft)}
                        </div>
                      </div>
                    </div>

                    {/* Pending Acceptance in Workshop */}
                    {dispatches
                      .filter((d) => d.status === 'IN_TRANSIT')
                      .map((d) => (
                        <div
                          key={d.id}
                          className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <strong>Entrega en camino ({d.dispatchFolio}):</strong> Se enviaron{' '}
                            <span className="font-mono font-bold">
                              {formatInt(d.dispatchedQty)} unidades
                            </span>
                            . Confirme cuántas unidades llegaron físicamente al taller:
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              max={d.dispatchedQty}
                              value={ackInputs[d.id]?.qty ?? d.dispatchedQty}
                              onChange={(e) =>
                                setAckInputs({
                                  ...ackInputs,
                                  [d.id]: {
                                    qty: Number(e.target.value),
                                    notes: ackInputs[d.id]?.notes || '',
                                  },
                                })
                              }
                              className="w-24 font-mono border border-slate-300 rounded px-2.5 py-1.5 bg-white"
                            />
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={() => handleAcknowledgeDispatch(d.id, d.dispatchedQty)}
                              className="px-3.5 py-1.5 font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700"
                            >
                              2. Aceptar en Taller
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: RECETAS DE ENSAMBLAJE (CREAR, EDITAR Y ELIMINAR)               */}
      {/* ===================================================================== */}
      {subTab === 'RECETAS' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Recetas de Ensamblaje (Qué insumos lleva cada Producto Terminado)
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Define qué componentes se descuentan automáticamente por cada 1 unidad fabricada
                (por ejemplo: 1 Chip UDP + 1 Case + 1 Empaque).
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={openCreateRecipeModal}
                className="px-4 py-2.5 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Crear Nueva Receta
              </button>
            )}
          </div>

          {data.recipes.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-10 text-center max-w-lg mx-auto space-y-3">
              <h3 className="text-sm font-bold text-slate-900">
                Aún no has creado recetas de ensamblaje
              </h3>
              <p className="text-xs text-slate-600">
                Crea una receta indicando qué producto terminado se obtiene y qué insumos consume.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {data.recipes.map((rec) => {
                const finProd = data.products.find((p) => p.id === rec.finishedProductId);
                return (
                  <div
                    key={rec.id}
                    className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span className="font-mono font-bold text-slate-800">{rec.code}</span>
                        <span>Versión v{rec.versionNumber}</span>
                      </div>
                      <h3 className="text-base font-bold text-slate-900 mt-1">{rec.name}</h3>

                      {finProd && (
                        <div className="mt-3 p-3 bg-emerald-50/60 border border-emerald-200 rounded-lg flex items-center gap-3">
                          <img
                            src={finProd.imageUrl}
                            alt={finProd.name}
                            className="w-14 h-10 object-cover rounded border border-slate-200"
                          />
                          <div className="text-xs">
                            <div className="text-emerald-800 font-medium">
                              Producto Terminado que Genera:
                            </div>
                            <div className="font-bold text-slate-900">
                              {finProd.sku} — {finProd.name}
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="mt-3 space-y-1.5 text-xs">
                        <div className="font-semibold text-slate-700">
                          Insumos que descuenta por cada 1 unidad:
                        </div>
                        {rec.components.map((c) => {
                          const comp = data.products.find((p) => p.id === c.componentProductId);
                          return (
                            <div
                              key={c.id}
                              className="flex items-center justify-between p-2 bg-slate-50 rounded"
                            >
                              <span>
                                <strong>{comp?.sku}</strong> — {comp?.name}
                              </span>
                              <span className="font-mono font-bold text-slate-900">
                                {c.quantityPerUnit} u.
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {isAdmin && (
                      <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditRecipeModal(rec)}
                          className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md flex items-center gap-1"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Editar Receta
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRecipe(rec)}
                          className="px-3 py-1.5 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Eliminar
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: RECOGIDA DE PRODUCTOS TERMINADOS                               */}
      {/* ===================================================================== */}
      {subTab === 'RECOGIDA' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Productos Terminados Listos para Recoger del Taller
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Transfiere los productos ya fabricados desde el taller hacia tu almacén destino sin
                volver a descontar insumos.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-700">Almacén que Recibe:</span>
              <select
                value={fgDestWarehouseId}
                onChange={(e) => setFgDestWarehouseId(Number(e.target.value))}
                className="text-xs border border-slate-300 rounded-lg px-3 py-2 bg-white font-semibold"
              >
                {data.allWarehousesSummary.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {finishedPendingBalances.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {finishedPendingBalances.map((bal) => {
                const prod = data.products.find((p) => p.id === bal.productId);
                const key = `${bal.productionOrderId}-${bal.productId}`;
                return (
                  <div
                    key={bal.id}
                    className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="text-xs font-mono text-indigo-700 font-bold">
                        {prod?.sku}
                      </div>
                      <div className="text-sm font-bold text-slate-900">{prod?.name}</div>
                      <div className="text-xs text-slate-600 mt-1">
                        Cantidad lista en taller:{' '}
                        <strong className="font-mono">{formatInt(bal.quantity)} u.</strong>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={bal.quantity}
                        value={fgDispatchQtyMap[key] ?? bal.quantity}
                        onChange={(e) =>
                          setFgDispatchQtyMap({
                            ...fgDispatchQtyMap,
                            [key]: Number(e.target.value),
                          })
                        }
                        className="w-24 text-xs font-mono border border-slate-300 rounded-lg px-2.5 py-1.5"
                      />
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() =>
                          handleDispatchFinished(
                            bal.productionOrderId,
                            bal.productId,
                            bal.quantity
                          )
                        }
                        className="px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                      >
                        Entregar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {data.finishedGoodsDispatches.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-3">
                Historial de Entregas y Recepciones de Producto Terminado
              </h3>
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200">
                    <th className="py-2">Folio</th>
                    <th className="py-2">Producto</th>
                    <th className="py-2 text-right">Cantidad</th>
                    <th className="py-2">Estado</th>
                    <th className="py-2 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.finishedGoodsDispatches.map((fg) => {
                    const p = data.products.find((pr) => pr.id === fg.finishedProductId);
                    return (
                      <tr key={fg.id}>
                        <td className="py-2 font-mono font-semibold">{fg.dispatchFolio}</td>
                        <td className="py-2">{p?.name}</td>
                        <td className="py-2 text-right font-mono font-bold">
                          {formatInt(fg.dispatchedQty)}
                        </td>
                        <td className="py-2 font-semibold">{fg.status}</td>
                        <td className="py-2 text-right">
                          {fg.status === 'IN_TRANSIT' ? (
                            <button
                              onClick={() => handleReceiveFinished(fg.id, fg.dispatchedQty)}
                              className="px-3 py-1 bg-emerald-600 text-white font-semibold rounded"
                            >
                              Confirmar Recepción en Almacén
                            </button>
                          ) : (
                            <span className="text-slate-400">Recibido</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: CREAR / EDITAR RECETA (BOM)                                    */}
      {/* ===================================================================== */}
      {recipeModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editingRecipe ? 'Editar Receta de Ensamblaje' : 'Crear Receta de Ensamblaje'}
              </h3>
              <button
                onClick={() => setRecipeModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveRecipe} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Nombre de la Receta *
                </label>
                <input
                  type="text"
                  value={recName}
                  onChange={(e) => setRecName(e.target.value)}
                  placeholder="Ej. Ensamblaje USB HP 8GB"
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Producto Terminado que se Fabrica *
                </label>
                <select
                  value={recFinishedId}
                  onChange={(e) => setRecFinishedId(Number(e.target.value))}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
                >
                  {data.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name} ({p.family})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-800">
                    Insumos que consume por cada 1 unidad fabricada:
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setRecComponents([
                        ...recComponents,
                        {
                          componentProductId: data.products[0]?.id || 0,
                          quantityPerUnit: 1,
                          isStrategicOrderBound: false,
                        },
                      ])
                    }
                    className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded font-semibold text-slate-700"
                  >
                    + Agregar Insumo
                  </button>
                </div>

                {recComponents.map((rc, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <select
                        value={rc.componentProductId}
                        onChange={(e) => {
                          const copy = [...recComponents];
                          copy[idx].componentProductId = Number(e.target.value);
                          setRecComponents(copy);
                        }}
                        className="flex-1 border border-slate-300 rounded px-2 py-1.5 bg-white"
                      >
                        {data.products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.sku} — {p.name} ({p.family})
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
                        className="w-16 font-mono border border-slate-300 rounded px-2 py-1.5 bg-white"
                      />
                      {recComponents.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setRecComponents(recComponents.filter((_, i) => i !== idx))
                          }
                          className="p-1 text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <label className="flex items-center gap-2 text-[11px] text-slate-600">
                      <input
                        type="checkbox"
                        checked={rc.isStrategicOrderBound}
                        onChange={(e) => {
                          const copy = [...recComponents];
                          copy[idx].isStrategicOrderBound = e.target.checked;
                          setRecComponents(copy);
                        }}
                      />
                      Es el componente principal entregado en la Orden (Ej. Chip UDP / microSD)
                    </label>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setRecipeModalOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg"
                >
                  Guardar Receta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: NUEVA ORDEN DE PRODUCCIÓN                                      */}
      {/* ===================================================================== */}
      {orderModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                Emitir Orden de Producción
              </h3>
              <button
                onClick={() => setOrderModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Componente Principal a Entregar (UDP / microSD) *
                </label>
                <select
                  value={opStrategicId}
                  onChange={(e) => setOpStrategicId(Number(e.target.value))}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
                >
                  {data.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Cantidad a Entregar (Unidades) *
                </label>
                <input
                  type="number"
                  min={1}
                  value={opAuthorizedQty}
                  onChange={(e) => setOpAuthorizedQty(Math.max(1, Number(e.target.value)))}
                  className="w-full text-base font-mono font-bold border border-slate-300 rounded-lg px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-800 mb-1">
                    Sale de Almacén
                  </label>
                  <select
                    value={opSourceWhId}
                    onChange={(e) => setOpSourceWhId(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-2 bg-white"
                  >
                    {data.allWarehousesSummary.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-800 mb-1">
                    Hacia Taller
                  </label>
                  <select
                    value={opTargetWhId}
                    onChange={(e) => setOpTargetWhId(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-2 bg-white"
                  >
                    {data.allWarehousesSummary.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Instrucciones (Opcional)
                </label>
                <input
                  type="text"
                  value={opInstructions}
                  onChange={(e) => setOpInstructions(e.target.value)}
                  placeholder="Indicaciones para el encargado"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setOrderModalOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-semibold text-white bg-sky-600 hover:bg-sky-700 rounded-lg"
                >
                  Crear Orden
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL: REGISTRAR LOTE FABRICADO                                       */}
      {/* ===================================================================== */}
      {produceModalOrder && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                Registrar Producción ({produceModalOrder.orderNumber})
              </h3>
              <button
                onClick={() => setProduceModalOrder(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmProductionBatch} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Receta / Producto Terminado Fabricado *
                </label>
                <select
                  value={produceRecipeId}
                  onChange={(e) => setProduceRecipeId(Number(e.target.value))}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
                >
                  {data.recipes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-800 mb-1">
                  Cantidad Terminada *
                </label>
                <input
                  type="number"
                  min={1}
                  value={produceQty}
                  onChange={(e) => setProduceQty(Math.max(1, Number(e.target.value)))}
                  className="w-full text-base font-mono font-bold border border-slate-300 rounded-lg px-3 py-2"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setProduceModalOrder(null)}
                  className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-5 py-2 font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
                >
                  Confirmar Producción
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
