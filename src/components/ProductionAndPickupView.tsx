import React, { useState } from 'react';
import {
  Factory,
  Truck,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  PackageCheck,
  Plus,
  Trash2,
} from 'lucide-react';
import {
  WorkspaceData,
  ProductionOrder,
  formatInt,
  formatBoliviaDateTime,
} from '../types.ts';

interface Props {
  data: WorkspaceData;
  isOnline: boolean;
  apiFetch: (url: string, options?: RequestInit) => Promise<any>;
  onRefresh: () => Promise<void>;
}

export function ProductionAndPickupView({ data, isOnline, apiFetch, onRefresh }: Props) {
  const [subTab, setSubTab] = useState<'ORDENES' | 'ASISTENTE_3_PASOS' | 'RECOGIDA'>('ORDENES');
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 1. Create Production Order State (Owner/Admin)
  const strategicProducts = data.products.filter((p) => p.productType === 'STRATEGIC_COMPONENT');
  const [opStrategicId, setOpStrategicId] = useState<number>(strategicProducts[0]?.id || 0);
  const [opSourceWhId, setOpSourceWhId] = useState<number>(
    data.allWarehousesSummary.find((w) => !w.isProductionPlant)?.id ||
      data.warehouses[0]?.id ||
      0
  );
  const [opTargetWhId, setOpTargetWhId] = useState<number>(
    data.allWarehousesSummary.find((w) => w.isProductionPlant)?.id ||
      data.warehouses[0]?.id ||
      0
  );
  const [opAuthorizedQty, setOpAuthorizedQty] = useState<number>(4000);
  const [opAssignedUserId, setOpAssignedUserId] = useState<number>(
    data.usersPublic.find((u) => u.role === 'PRODUCTION_MANAGER')?.id ||
      data.user.id
  );
  const [opPriority, setOpPriority] = useState('ALTA');
  const [opInstructions, setOpInstructions] = useState(
    'Transformar en modelos autorizados según disponibilidad de cases y empaques locales.'
  );

  // 2. Dispatch & Acknowledge Inline States
  const [dispatchInputs, setDispatchInputs] = useState<Record<number, number>>({});
  const [ackInputs, setAckInputs] = useState<Record<number, { qty: number; notes: string }>>({});
  const [returnInputs, setReturnInputs] = useState<
    Record<number, { type: 'RETURN_TO_ORIGIN' | 'REPORT_WASTE'; qty: number; reason: string }>
  >({});

  // 3. Assisted 3-Step Production Wizard State
  const activeOrdersForProd = data.productionOrders.filter(
    (o) => o.status !== 'CLOSED' && o.status !== 'CANCELLED'
  );
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [selectedOrderId, setSelectedOrderId] = useState<number>(
    activeOrdersForProd[0]?.id || 0
  );
  const [batchLines, setBatchLines] = useState<
    { recipeId: number; quantityToProduce: number; notes: string }[]
  >([
    {
      recipeId: data.recipes[0]?.id || 0,
      quantityToProduce: 500,
      notes: '',
    },
  ]);
  const [prodIdempotencyKey, setProdIdempotencyKey] = useState('');

  // 4. Finished Goods Pickup & Receipt States
  const [fgDispatchQtyMap, setFgDispatchQtyMap] = useState<Record<string, number>>({});
  const [fgDestWarehouseId, setFgDestWarehouseId] = useState<number>(
    data.allWarehousesSummary.find((w) => w.code === 'ALM-PUENTEBOLIVIA')?.id ||
      data.allWarehousesSummary[0]?.id ||
      0
  );
  const [fgReceiveInputs, setFgReceiveInputs] = useState<Record<number, number>>({});

  const isOwnerOrAdmin = data.user.role === 'OWNER' || data.user.role === 'ADMIN';

  const handleCreateOrder = async () => {
    if (!isOnline) return;
    const srcLoc = data.allLocationsSummary.find((l) => l.warehouseId === opSourceWhId);
    const dstLoc = data.allLocationsSummary.find((l) => l.warehouseId === opTargetWhId);
    if (!srcLoc || !dstLoc) {
      setFeedbackMsg({
        type: 'error',
        text: 'Seleccione almacenes con ubicaciones activas configuradas.',
      });
      return;
    }

    const matchingRecipes = data.recipes
      .filter((r) => r.components.some((c) => c.componentProductId === opStrategicId))
      .map((r) => r.id);

    setSubmitting(true);
    setFeedbackMsg(null);
    try {
      const res = await apiFetch('/api/production/orders', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `OP-NEW-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          sourceWarehouseId: opSourceWhId,
          sourceLocationId: srcLoc.id,
          targetWarehouseId: opTargetWhId,
          targetLocationId: dstLoc.id,
          assignedUserId: opAssignedUserId,
          strategicProductId: opStrategicId,
          authorizedQty: opAuthorizedQty,
          allowedRecipeIds: matchingRecipes,
          priority: opPriority,
          instructions: opInstructions,
        }),
      });
      setFeedbackMsg({
        type: 'success',
        text: `Orden ${res.order.orderNumber} creada. Se reservaron ${formatInt(
          opAuthorizedQty
        )} unidades en origen sin descontarlas como consumidas.`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDispatchOrder = async (order: ProductionOrder) => {
    if (!isOnline) return;
    const qty = dispatchInputs[order.id] ?? order.reservedQty;
    setSubmitting(true);
    setFeedbackMsg(null);
    try {
      const res = await apiFetch('/api/production/dispatches', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `DESP-OP-${order.id}-${Date.now()}`,
          productionOrderId: order.id,
          dispatchQty: qty,
          notes: 'Despacho físico hacia taller de producción',
        }),
      });
      setFeedbackMsg({
        type: 'success',
        text: `Despacho ${res.dispatch.dispatchFolio} emitido por ${formatInt(
          qty
        )} unidades. Ahora en tránsito esperando conteo del encargado.`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAcknowledgeDispatch = async (dispatchId: number, defaultQty: number) => {
    if (!isOnline) return;
    const input = ackInputs[dispatchId] || { qty: defaultQty, notes: '' };
    setSubmitting(true);
    setFeedbackMsg(null);
    try {
      const res = await apiFetch('/api/production/acknowledge', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `ACK-OP-${dispatchId}-${Date.now()}`,
          dispatchId,
          receivedQty: input.qty,
          notes: input.notes,
        }),
      });
      const diff = res.dispatch.discrepancyQty;
      setFeedbackMsg({
        type: diff > 0 ? 'error' : 'success',
        text:
          diff > 0
            ? `Recepción registrada con DISCREPANCIA FÍSICA de ${formatInt(
                diff
              )} unidades. ${formatInt(
                input.qty
              )} entraron en custodia de producción y ${formatInt(
                diff
              )} quedaron en estado DISCREPANCY_HOLD bloqueando cierre.`
            : `Recepción conforme confirmada (${formatInt(
                input.qty
              )} unidades en custodia de producción).`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReturnOrWaste = async (orderId: number) => {
    if (!isOnline) return;
    const input = returnInputs[orderId];
    if (!input || !input.qty || !input.reason) {
      setFeedbackMsg({
        type: 'error',
        text: 'Especifique cantidad entera y motivo obligatorio para devolver sobrante o reportar merma.',
      });
      return;
    }
    setSubmitting(true);
    setFeedbackMsg(null);
    try {
      const res = await apiFetch('/api/production/return-or-waste', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `RET-MER-${orderId}-${Date.now()}`,
          productionOrderId: orderId,
          operationType: input.type,
          quantity: input.qty,
          reason: input.reason,
        }),
      });
      setFeedbackMsg({
        type: 'success',
        text: `Operación confirmada (Documento ${res.document.folio}). Saldo de la orden conciliado.`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  // Wizard calculations
  const selectedOrder =
    data.productionOrders.find((o) => o.id === selectedOrderId) || activeOrdersForProd[0];

  const orderPendingCustody = selectedOrder
    ? selectedOrder.receivedInProductionQty -
      selectedOrder.consumedQty -
      selectedOrder.returnedQty -
      selectedOrder.wasteQty
    : 0;

  const compatibleRecipes = selectedOrder
    ? data.recipes.filter((r) =>
        r.components.some((c) => c.componentProductId === selectedOrder.strategicProductId)
      )
    : data.recipes;

  // Calculate cumulative BOM requirements across all lines in the current tanda
  const requiredByComponentId = new Map<
    number,
    { requiredQty: number; isStrategic: boolean }
  >();
  for (const bl of batchLines) {
    const rec = data.recipes.find((r) => r.id === bl.recipeId);
    if (!rec || bl.quantityToProduce <= 0) continue;
    for (const comp of rec.components) {
      const prev = requiredByComponentId.get(comp.componentProductId) || {
        requiredQty: 0,
        isStrategic: comp.isStrategicOrderBound,
      };
      requiredByComponentId.set(comp.componentProductId, {
        requiredQty: prev.requiredQty + comp.quantityPerUnit * bl.quantityToProduce,
        isStrategic:
          prev.isStrategic ||
          comp.isStrategicOrderBound ||
          comp.componentProductId === selectedOrder?.strategicProductId,
      });
    }
  }

  const confirmWizardProduction = async () => {
    if (!isOnline || !selectedOrder) return;
    setSubmitting(true);
    setFeedbackMsg(null);
    try {
      const res = await apiFetch('/api/production/batches', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: prodIdempotencyKey,
          productionOrderId: selectedOrder.id,
          items: batchLines,
        }),
      });
      setWizardStep(1);
      setFeedbackMsg({
        type: 'success',
        text: `Transacción atómica completada (${res.document.folio}). Se consumieron ${formatInt(
          res.totalStrategicConsumed
        )} componentes estratégicos y sus respectivos cases/empaques; quedan ${formatInt(
          res.remainingCustodyQty
        )} bajo custodia de producción.`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  // Finished Goods Pending Pickup in Workshop
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
    setFeedbackMsg(null);
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
          notes: 'Entrega de productos terminados para recogida formal',
        }),
      });
      setFeedbackMsg({
        type: 'success',
        text: `Comprobante ${res.dispatch.dispatchFolio} emitido. ${formatInt(
          qty
        )} unidades pasaron a estado EN TRÁNSITO esperando confirmación del receptor (sin volver a descontar insumos).`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReceiveFinished = async (dispatchId: number, defaultQty: number) => {
    if (!isOnline) return;
    const qty = fgReceiveInputs[dispatchId] ?? defaultQty;
    setSubmitting(true);
    setFeedbackMsg(null);
    try {
      const res = await apiFetch('/api/finished-goods/receive', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `FG-REC-${dispatchId}-${Date.now()}`,
          dispatchId,
          receivedQty: qty,
          notes: 'Recepción física confirmada en almacén destino',
        }),
      });
      setFeedbackMsg({
        type: 'success',
        text: `Recepción formal confirmada (${res.document.folio}). ${formatInt(
          qty
        )} productos terminados ingresaron al stock disponible del almacén receptor.`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            onClick={() => setSubTab('ORDENES')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'ORDENES'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            1. Órdenes de Producción, Entregas y Conciliación
          </button>
          <button
            onClick={() => setSubTab('ASISTENTE_3_PASOS')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'ASISTENTE_3_PASOS'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            2. Registrar Producción (Asistente de 3 Pasos)
          </button>
          <button
            onClick={() => setSubTab('RECOGIDA')}
            className={`px-3.5 py-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              subTab === 'RECOGIDA'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            3. Recogida y Recepción Formal de Productos Terminados
          </button>
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
      {/* TAB 1: ÓRDENES DE PRODUCCIÓN, ENTREGAS Y CONCILIACIÓN                 */}
      {/* ===================================================================== */}
      {subTab === 'ORDENES' && (
        <div className="space-y-6">
          {/* Owner / Admin Form to Create a New Production Order */}
          {isOwnerOrAdmin && (
            <div className="bg-white rounded-lg border border-slate-200 p-5">
              <h2 className="text-base font-semibold text-slate-900">
                Emitir Nueva Orden de Producción y Reservar Componentes Clave (UDP / microSD)
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                Regla crítica de timing: al crear la orden, las unidades pasan a estado{' '}
                <strong>Reservado en Orden</strong> dentro del almacén de origen. Solo dejan de estar
                en origen cuando se confirma el despacho físico hacia el taller.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Componente Estratégico a Entregar
                  </label>
                  <select
                    value={opStrategicId}
                    onChange={(e) => setOpStrategicId(Number(e.target.value))}
                    className="w-full text-xs font-mono border border-slate-300 rounded px-2.5 py-2 bg-white"
                  >
                    {strategicProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Cantidad Autorizada a Reservar (Piezas)
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={opAuthorizedQty}
                    onChange={(e) => setOpAuthorizedQty(Math.max(1, Number(e.target.value)))}
                    className="w-full text-xs font-mono border border-slate-300 rounded px-2.5 py-2"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Responsable Asignado
                  </label>
                  <select
                    value={opAssignedUserId}
                    onChange={(e) => setOpAssignedUserId(Number(e.target.value))}
                    className="w-full text-xs border border-slate-300 rounded px-2.5 py-2 bg-white"
                  >
                    {data.usersPublic.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName} ({u.role})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Almacén de Salida (Custodia Origen)
                  </label>
                  <select
                    value={opSourceWhId}
                    onChange={(e) => setOpSourceWhId(Number(e.target.value))}
                    className="w-full text-xs border border-slate-300 rounded px-2.5 py-2 bg-white"
                  >
                    {data.allWarehousesSummary.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Almacén / Taller de Producción Destino
                  </label>
                  <select
                    value={opTargetWhId}
                    onChange={(e) => setOpTargetWhId(Number(e.target.value))}
                    className="w-full text-xs border border-slate-300 rounded px-2.5 py-2 bg-white"
                  >
                    {data.allWarehousesSummary.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Instrucciones de Fabricación
                  </label>
                  <input
                    type="text"
                    value={opInstructions}
                    onChange={(e) => setOpInstructions(e.target.value)}
                    className="w-full text-xs border border-slate-300 rounded px-2.5 py-2"
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  disabled={submitting || !isOnline}
                  onClick={handleCreateOrder}
                  className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-md hover:bg-sky-700 disabled:opacity-50"
                >
                  Emitir Orden y Reservar Stock en Origen
                </button>
              </div>
            </div>
          )}

          {/* List of Active & Historical Production Orders with Full Accounting Equation */}
          <div className="space-y-4">
            {data.productionOrders.map((order) => {
              const stratProd = data.products.find((p) => p.id === order.strategicProductId);
              const srcWh = data.allWarehousesSummary.find(
                (w) => w.id === order.sourceWarehouseId
              );
              const dstWh = data.allWarehousesSummary.find(
                (w) => w.id === order.targetWarehouseId
              );
              const pendingCustody =
                order.receivedInProductionQty -
                order.consumedQty -
                order.returnedQty -
                order.wasteQty;
              const orderDispatches = data.productionDispatches.filter(
                (d) => d.productionOrderId === order.id
              );
              const orderBatches = data.productionBatches.filter(
                (b) => b.productionOrderId === order.id
              );

              return (
                <div
                  key={order.id}
                  className="bg-white rounded-lg border border-slate-200 p-5 space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <span className="font-mono font-bold text-slate-900 text-sm">
                          {order.orderNumber}
                        </span>
                        <span>·</span>
                        <span>Estado: {order.status}</span>
                        <span>·</span>
                        <span>
                          {srcWh?.name} → {dstWh?.name}
                        </span>
                        <span>·</span>
                        <span>{formatBoliviaDateTime(order.createdAt)}</span>
                      </div>
                      <h3 className="text-base font-semibold text-slate-900 mt-1">
                        Insumo Clave: {stratProd?.sku} — {stratProd?.name}
                      </h3>
                      <p className="text-xs text-slate-600 mt-0.5">{order.instructions}</p>
                    </div>

                    {order.discrepancyQty > 0 && (
                      <div className="px-3 py-1.5 bg-red-50 border border-red-200 rounded text-xs font-medium text-red-800 flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        Cierre Bloqueado: {formatInt(order.discrepancyQty)} u. en discrepancia de
                        tránsito pendiente de conciliar
                      </div>
                    )}
                  </div>

                  {/* Accounting Conservation Equation Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-7 gap-2.5 pt-2">
                    <div className="p-2.5 bg-slate-50 rounded border border-slate-100">
                      <div className="text-[11px] text-slate-500">1. Autorizado</div>
                      <div className="text-sm font-mono font-bold text-slate-900 tabular-nums">
                        {formatInt(order.authorizedQty)}
                      </div>
                    </div>
                    <div className="p-2.5 bg-amber-50/60 rounded border border-amber-100">
                      <div className="text-[11px] text-amber-800">2. Reservado Origen</div>
                      <div className="text-sm font-mono font-bold text-amber-700 tabular-nums">
                        {formatInt(order.reservedQty)}
                      </div>
                    </div>
                    <div className="p-2.5 bg-slate-50 rounded border border-slate-100">
                      <div className="text-[11px] text-slate-500">3. Recibido Taller</div>
                      <div className="text-sm font-mono font-bold text-slate-900 tabular-nums">
                        {formatInt(order.receivedInProductionQty)}
                      </div>
                    </div>
                    <div className="p-2.5 bg-emerald-50/60 rounded border border-emerald-100">
                      <div className="text-[11px] text-emerald-800">4. Consumido Lotes</div>
                      <div className="text-sm font-mono font-bold text-emerald-700 tabular-nums">
                        {formatInt(order.consumedQty)}
                      </div>
                    </div>
                    <div className="p-2.5 bg-sky-50/70 rounded border border-sky-100">
                      <div className="text-[11px] text-sky-900">5. En Custodia Taller</div>
                      <div className="text-sm font-mono font-bold text-sky-700 tabular-nums">
                        {formatInt(pendingCustody)}
                      </div>
                    </div>
                    <div className="p-2.5 bg-slate-50 rounded border border-slate-100">
                      <div className="text-[11px] text-slate-500">6. Devuelto / Merma</div>
                      <div className="text-sm font-mono font-semibold text-slate-700 tabular-nums">
                        {formatInt(order.returnedQty)} / {formatInt(order.wasteQty)}
                      </div>
                    </div>
                    <div className="p-2.5 bg-slate-50 rounded border border-slate-100">
                      <div className="text-[11px] text-slate-500">7. Discrepancia</div>
                      <div
                        className={`text-sm font-mono font-bold tabular-nums ${
                          order.discrepancyQty > 0 ? 'text-red-600' : 'text-slate-400'
                        }`}
                      >
                        {formatInt(order.discrepancyQty)}
                      </div>
                    </div>
                  </div>

                  {/* Partial or Full Dispatch Action if reservedQty > 0 */}
                  {order.reservedQty > 0 && isOwnerOrAdmin && (
                    <div className="p-3.5 bg-amber-50/50 border border-amber-200 rounded-md flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs text-slate-800">
                        <strong>Despacho de Componentes (Parcial o Total):</strong> Quedan{' '}
                        <span className="font-mono font-bold">{formatInt(order.reservedQty)}</span>{' '}
                        unidades reservadas en {srcWh?.name} listas para entregar a {dstWh?.name}.
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={order.reservedQty}
                          value={dispatchInputs[order.id] ?? order.reservedQty}
                          onChange={(e) =>
                            setDispatchInputs({
                              ...dispatchInputs,
                              [order.id]: Math.max(1, Number(e.target.value)),
                            })
                          }
                          className="w-28 text-xs font-mono border border-slate-300 rounded px-2.5 py-1.5 bg-white"
                        />
                        <button
                          type="button"
                          disabled={submitting || !isOnline}
                          onClick={() => handleDispatchOrder(order)}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800"
                        >
                          Confirmar Entrega a Producción
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Pending Dispatches to Acknowledge by Production Manager */}
                  {orderDispatches.length > 0 && (
                    <div className="space-y-2 pt-2">
                      <div className="text-xs font-medium text-slate-700">
                        Entregas físicas registradas hacia el taller ({orderDispatches.length}):
                      </div>
                      {orderDispatches.map((d) => (
                        <div
                          key={d.id}
                          className="p-3 bg-slate-50 rounded border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <span className="font-mono font-semibold text-slate-900">
                              {d.dispatchFolio}
                            </span>{' '}
                            · Enviado:{' '}
                            <span className="font-mono font-bold">
                              {formatInt(d.dispatchedQty)} u.
                            </span>{' '}
                            · Estado: <span className="font-semibold">{d.status}</span>
                            {d.receivedQty !== null && (
                              <span>
                                {' '}
                                · Recibido real:{' '}
                                <strong className="font-mono">{formatInt(d.receivedQty)} u.</strong>
                                {d.discrepancyQty > 0 && (
                                  <span className="text-red-600 font-semibold">
                                    {' '}
                                    (Diferencia: {formatInt(d.discrepancyQty)} u. —{' '}
                                    {d.discrepancyNotes})
                                  </span>
                                )}
                              </span>
                            )}
                          </div>

                          {d.status === 'IN_TRANSIT' && (
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="text-[11px] text-slate-600">
                                Cantidad contada al recibir:
                              </label>
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
                                className="w-24 text-xs font-mono border border-slate-300 rounded px-2 py-1 bg-white"
                              />
                              <input
                                type="text"
                                placeholder="Nota si hay diferencia..."
                                value={ackInputs[d.id]?.notes || ''}
                                onChange={(e) =>
                                  setAckInputs({
                                    ...ackInputs,
                                    [d.id]: {
                                      qty: ackInputs[d.id]?.qty ?? d.dispatchedQty,
                                      notes: e.target.value,
                                    },
                                  })
                                }
                                className="w-44 text-xs border border-slate-300 rounded px-2 py-1 bg-white"
                              />
                              <button
                                type="button"
                                disabled={submitting || !isOnline}
                                onClick={() => handleAcknowledgeDispatch(d.id, d.dispatchedQty)}
                                className="px-3 py-1 text-xs font-semibold text-white bg-emerald-600 rounded hover:bg-emerald-700"
                              >
                                Aceptar Recepción en Taller
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Return Unused Strategic Components or Report Approved Waste */}
                  {pendingCustody > 0 && (
                    <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="text-slate-600">
                        ¿Sobrantes sin usar o mermas en taller? Saldo actual en custodia:{' '}
                        <strong className="font-mono text-slate-900">
                          {formatInt(pendingCustody)} u.
                        </strong>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={returnInputs[order.id]?.type || 'RETURN_TO_ORIGIN'}
                          onChange={(e) =>
                            setReturnInputs({
                              ...returnInputs,
                              [order.id]: {
                                type: e.target.value as any,
                                qty: returnInputs[order.id]?.qty || 100,
                                reason:
                                  returnInputs[order.id]?.reason ||
                                  'Devolución de sobrantes no utilizados al almacén',
                              },
                            })
                          }
                          className="border border-slate-300 rounded px-2 py-1 bg-white"
                        >
                          <option value="RETURN_TO_ORIGIN">
                            Devolver Sobrante Sano al Almacén Origen
                          </option>
                          <option value="REPORT_WASTE">
                            Registrar Merma / Componente Defectuoso
                          </option>
                        </select>
                        <input
                          type="number"
                          min={1}
                          max={pendingCustody}
                          placeholder="Cant."
                          value={returnInputs[order.id]?.qty ?? 500}
                          onChange={(e) =>
                            setReturnInputs({
                              ...returnInputs,
                              [order.id]: {
                                type: returnInputs[order.id]?.type || 'RETURN_TO_ORIGIN',
                                qty: Number(e.target.value),
                                reason:
                                  returnInputs[order.id]?.reason ||
                                  'Devolución de sobrantes sin usar',
                              },
                            })
                          }
                          className="w-24 font-mono border border-slate-300 rounded px-2 py-1"
                        />
                        <input
                          type="text"
                          placeholder="Motivo obligatorio..."
                          value={
                            returnInputs[order.id]?.reason ?? 'Devolución de sobrantes sin usar'
                          }
                          onChange={(e) =>
                            setReturnInputs({
                              ...returnInputs,
                              [order.id]: {
                                type: returnInputs[order.id]?.type || 'RETURN_TO_ORIGIN',
                                qty: returnInputs[order.id]?.qty ?? 500,
                                reason: e.target.value,
                              },
                            })
                          }
                          className="w-52 border border-slate-300 rounded px-2 py-1"
                        />
                        <button
                          type="button"
                          disabled={submitting || !isOnline}
                          onClick={() => handleReturnOrWaste(order.id)}
                          className="px-3 py-1 font-semibold bg-slate-800 text-white rounded hover:bg-slate-700"
                        >
                          Procesar
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Summary of Produced Batches under this Order */}
                  {orderBatches.length > 0 && (
                    <div className="pt-2 border-t border-slate-100">
                      <div className="text-xs font-medium text-slate-600 mb-1.5">
                        Lotes de producto terminado fabricados bajo esta orden ({orderBatches.length}
                        ):
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                        {orderBatches.map((b) => {
                          const fp = data.products.find((p) => p.id === b.finishedProductId);
                          return (
                            <div
                              key={b.id}
                              className="p-2.5 bg-emerald-50/40 border border-emerald-200 rounded text-xs"
                            >
                              <div className="font-mono font-semibold text-emerald-950">
                                {b.batchFolio} · {fp?.sku}
                              </div>
                              <div className="text-slate-700 truncate">{fp?.name}</div>
                              <div className="mt-1 font-mono font-bold text-emerald-700">
                                +{formatInt(b.quantityProduced)} fabricados
                              </div>
                            </div>
                          );
                        })}
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
      {/* TAB 2: ASISTENTE DE PRODUCCIÓN EN 3 PASOS (CONSUMO ATÓMICO POR BOM)   */}
      {/* ===================================================================== */}
      {subTab === 'ASISTENTE_3_PASOS' && (
        <div className="bg-white rounded-lg border border-slate-200 p-6 max-w-5xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Asistente de Producción y Descuento Atómico por Receta (3 Pasos)
              </h2>
              <p className="text-xs text-slate-600">
                El operario no introduce manualmente las cantidades de cases, adaptadores ni
                empaques: el servidor las calcula desde la receta autorizada y ejecuta todo en una
                única transacción o hace rollback completo si falta cualquier componente.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span
                className={`px-2.5 py-1 rounded ${
                  wizardStep === 1 ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                Paso 1: Orden
              </span>
              <span>→</span>
              <span
                className={`px-2.5 py-1 rounded ${
                  wizardStep === 2 ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                Paso 2: Modelos y Receta
              </span>
              <span>→</span>
              <span
                className={`px-2.5 py-1 rounded ${
                  wizardStep === 3 ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                Paso 3: Confirmación Atómica
              </span>
            </div>
          </div>

          {/* STEP 1: Choose Active Production Order */}
          {wizardStep === 1 && (
            <div className="space-y-4">
              <label className="block text-xs font-semibold text-slate-700">
                Paso 1: Seleccione la Orden de Producción Activa
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {activeOrdersForProd.map((ord) => {
                  const strat = data.products.find((p) => p.id === ord.strategicProductId);
                  const custody =
                    ord.receivedInProductionQty -
                    ord.consumedQty -
                    ord.returnedQty -
                    ord.wasteQty;
                  const isSelected = selectedOrder?.id === ord.id;
                  return (
                    <div
                      key={ord.id}
                      onClick={() => {
                        setSelectedOrderId(ord.id);
                        const firstCompat = data.recipes.find((r) =>
                          r.components.some(
                            (c) => c.componentProductId === ord.strategicProductId
                          )
                        );
                        if (firstCompat) {
                          setBatchLines([
                            {
                              recipeId: firstCompat.id,
                              quantityToProduce: Math.min(500, Math.max(100, custody)),
                              notes: '',
                            },
                          ]);
                        }
                      }}
                      className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-sky-600 bg-sky-50/40'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-bold text-slate-900">
                          {ord.orderNumber}
                        </span>
                        <span className="font-medium text-slate-600">{ord.status}</span>
                      </div>
                      <div className="text-sm font-semibold text-slate-900 mt-1">
                        {strat?.sku} — {strat?.name}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs pt-2 border-t border-slate-200/70">
                        <span className="text-slate-600">Saldo en custodia listo p/ transformar:</span>
                        <span className="font-mono font-bold text-sky-700 text-sm">
                          {formatInt(custody)} piezas
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  disabled={!selectedOrder}
                  onClick={() => setWizardStep(2)}
                  className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-md hover:bg-sky-700"
                >
                  Continuar al Paso 2: Elegir Modelos a Fabricar →
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Select Models & Quantities with Live BOM Calculation */}
          {wizardStep === 2 && selectedOrder && (
            <div className="space-y-5">
              <div className="p-3.5 bg-slate-50 rounded-md border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  Orden Seleccionada:{' '}
                  <strong className="font-mono">{selectedOrder.orderNumber}</strong> · Saldo de
                  componente estratégico en custodia del taller:{' '}
                  <strong className="font-mono text-sky-700">
                    {formatInt(orderPendingCustody)} piezas
                  </strong>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setBatchLines([
                      ...batchLines,
                      {
                        recipeId: compatibleRecipes[0]?.id || 0,
                        quantityToProduce: 500,
                        notes: '',
                      },
                    ])
                  }
                  className="px-3 py-1 font-medium bg-white border border-slate-300 rounded hover:bg-slate-100"
                >
                  + Agregar Otro Modelo en la Misma Tanda
                </button>
              </div>

              <div className="space-y-3">
                {batchLines.map((line, index) => {
                  const rec = data.recipes.find((r) => r.id === line.recipeId);
                  const finProd = data.products.find((p) => p.id === rec?.finishedProductId);
                  return (
                    <div
                      key={index}
                      className="p-4 rounded-lg border border-slate-200 bg-white flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="flex items-center gap-3 flex-1">
                        {finProd && (
                          <img
                            src={finProd.imageUrl}
                            alt={finProd.name}
                            referrerPolicy="no-referrer"
                            className="w-16 h-12 object-cover rounded border border-slate-200 shrink-0"
                          />
                        )}
                        <div className="flex-1">
                          <label className="block text-[11px] font-medium text-slate-500">
                            Modelo Terminado / Receta Autorizada #{index + 1}
                          </label>
                          <select
                            value={line.recipeId}
                            onChange={(e) => {
                              const copy = [...batchLines];
                              copy[index].recipeId = Number(e.target.value);
                              setBatchLines(copy);
                            }}
                            className="w-full text-xs font-mono border border-slate-300 rounded px-2.5 py-2 bg-white mt-0.5"
                          >
                            {compatibleRecipes.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.code} — {r.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500">
                            Cantidad a Fabricar
                          </label>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={line.quantityToProduce}
                            onChange={(e) => {
                              const copy = [...batchLines];
                              copy[index].quantityToProduce = Math.max(
                                1,
                                parseInt(e.target.value || '0', 10)
                              );
                              setBatchLines(copy);
                            }}
                            className="w-32 text-xs font-mono font-bold border border-slate-300 rounded px-2.5 py-2 mt-0.5"
                          />
                        </div>

                        {batchLines.length > 1 && (
                          <button
                            type="button"
                            onClick={() =>
                              setBatchLines(batchLines.filter((_, i) => i !== index))
                            }
                            className="p-2 text-red-600 hover:bg-red-50 rounded mt-4"
                            title="Quitar línea"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Automatic BOM Component Availability Table */}
              <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
                <h3 className="text-xs font-semibold text-slate-900 mb-2">
                  Cálculo Automático de Componentes Requeridos por Receta vs. Stock en Taller:
                </h3>
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200">
                      <th className="py-1.5">Componente (SKU)</th>
                      <th className="py-1.5">Origen del Descuento</th>
                      <th className="py-1.5 text-right">Cantidad Requerida</th>
                      <th className="py-1.5 text-right">Disponible en Taller</th>
                      <th className="py-1.5 text-right">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/60">
                    {Array.from(requiredByComponentId.entries()).map(([compId, info]) => {
                      const compProd = data.products.find((p) => p.id === compId);
                      const availableInWorkshop = info.isStrategic
                        ? orderPendingCustody
                        : data.balances
                            .filter(
                              (b) =>
                                b.productId === compId &&
                                b.warehouseId === selectedOrder.targetWarehouseId &&
                                b.locationId === selectedOrder.targetLocationId &&
                                b.status === 'AVAILABLE'
                            )
                            .reduce((s, b) => s + b.quantity, 0);
                      const hasEnough = availableInWorkshop >= info.requiredQty;

                      return (
                        <tr key={compId}>
                          <td className="py-2 font-mono font-medium text-slate-900">
                            {compProd?.sku} — {compProd?.name}
                          </td>
                          <td className="py-2 text-slate-600">
                            {info.isStrategic
                              ? `Custodia Orden ${selectedOrder.orderNumber}`
                              : 'Stock Local Taller'}
                          </td>
                          <td className="py-2 text-right font-mono font-bold tabular-nums">
                            {formatInt(info.requiredQty)}
                          </td>
                          <td className="py-2 text-right font-mono tabular-nums">
                            {formatInt(availableInWorkshop)}
                          </td>
                          <td className="py-2 text-right font-semibold">
                            {hasEnough ? (
                              <span className="text-emerald-700">Suficiente</span>
                            ) : (
                              <span className="text-red-600">
                                Faltan {formatInt(info.requiredQty - availableInWorkshop)} u.
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setWizardStep(1)}
                  className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
                >
                  ← Volver al Paso 1
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setProdIdempotencyKey(
                      `PROD-WIZ-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
                    );
                    setWizardStep(3);
                  }}
                  className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-md hover:bg-sky-700"
                >
                  Revisar Vista Previa Antes de Confirmar (Paso 3) →
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: Final Atomic Confirmation */}
          {wizardStep === 3 && selectedOrder && (
            <div className="space-y-5">
              <div className="p-5 bg-slate-50 border border-slate-300 rounded-lg space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Paso 3: Confirmación de Transformación Atómica
                  </h3>
                  <span className="text-xs font-mono text-slate-500">
                    Idempotency-Key: {prodIdempotencyKey}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-3.5 bg-white rounded border border-slate-200">
                    <div className="font-semibold text-slate-900 mb-2">
                      SE CONSUMIRÁN ATÓMICAMENTE:
                    </div>
                    <ul className="space-y-1 font-mono">
                      {Array.from(requiredByComponentId.entries()).map(([compId, info]) => {
                        const p = data.products.find((pr) => pr.id === compId);
                        return (
                          <li key={compId} className="text-red-700">
                            - {formatInt(info.requiredQty)} u. de {p?.sku} ({p?.name})
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div className="p-3.5 bg-white rounded border border-slate-200">
                    <div className="font-semibold text-slate-900 mb-2">
                      SE GENERARÁN COMO PRODUCTO TERMINADO (PENDIENTE DE RECOGIDA):
                    </div>
                    <ul className="space-y-1 font-mono">
                      {batchLines.map((bl, idx) => {
                        const r = data.recipes.find((rc) => rc.id === bl.recipeId);
                        const fp = data.products.find((pr) => pr.id === r?.finishedProductId);
                        return (
                          <li key={idx} className="text-emerald-700 font-bold">
                            + {formatInt(bl.quantityToProduce)} u. de {fp?.sku} ({fp?.name})
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    className="px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md"
                  >
                    ← Modificar Cantidades
                  </button>
                  <button
                    type="button"
                    disabled={submitting || !isOnline}
                    onClick={confirmWizardProduction}
                    className="px-5 py-2.5 text-xs font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {submitting
                      ? 'Procesando Transacción ACID...'
                      : 'Confirmar Producción y Descontar Insumos'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: RECOGIDA Y RECEPCIÓN FORMAL DE PRODUCTOS TERMINADOS            */}
      {/* ===================================================================== */}
      {subTab === 'RECOGIDA' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-slate-200 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Productos Terminados en Custodia del Taller (Listos para Entregar / Recoger)
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Importante: Preparar la entrega o confirmar la recepción de productos terminados
                  es una transferencia de custodia del SKU final; <strong>jamás</strong> vuelve a
                  descontar UDP, cases, adaptadores ni empaques.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-slate-700">
                  Almacén Destino de Recogida:
                </label>
                <select
                  value={fgDestWarehouseId}
                  onChange={(e) => setFgDestWarehouseId(Number(e.target.value))}
                  className="text-xs border border-slate-300 rounded px-2.5 py-1.5 bg-white"
                >
                  {data.allWarehousesSummary.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.code})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {finishedPendingBalances.length === 0 ? (
              <div className="mt-4 p-6 bg-slate-50 rounded text-center text-xs text-slate-500">
                No hay lotes de productos terminados pendientes de retirar en este momento.
              </div>
            ) : (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                {finishedPendingBalances.map((bal) => {
                  const prod = data.products.find((p) => p.id === bal.productId);
                  const ord = data.productionOrders.find((o) => o.id === bal.productionOrderId);
                  const wh = data.warehouses.find((w) => w.id === bal.warehouseId);
                  const key = `${bal.productionOrderId}-${bal.productId}`;

                  return (
                    <div
                      key={bal.id}
                      className="p-4 rounded-lg border border-slate-200 flex flex-col justify-between gap-3"
                    >
                      <div className="flex items-start gap-3">
                        {prod && (
                          <img
                            src={prod.imageUrl}
                            alt={prod.name}
                            referrerPolicy="no-referrer"
                            className="w-16 h-12 object-cover rounded border border-slate-200 shrink-0"
                          />
                        )}
                        <div>
                          <div className="text-xs font-mono text-slate-500">
                            Orden: {ord?.orderNumber || 'General'} · Taller: {wh?.name}
                          </div>
                          <div className="text-sm font-semibold text-slate-900">
                            {prod?.sku} — {prod?.name}
                          </div>
                          <div className="text-xs text-indigo-700 font-mono font-bold mt-1">
                            Listos para entregar: {formatInt(bal.quantity)} unidades
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                        <input
                          type="number"
                          min={1}
                          max={bal.quantity}
                          value={fgDispatchQtyMap[key] ?? bal.quantity}
                          onChange={(e) =>
                            setFgDispatchQtyMap({
                              ...fgDispatchQtyMap,
                              [key]: Math.max(1, Number(e.target.value)),
                            })
                          }
                          className="w-24 text-xs font-mono border border-slate-300 rounded px-2 py-1.5"
                        />
                        <button
                          type="button"
                          disabled={submitting || !isOnline}
                          onClick={() =>
                            handleDispatchFinished(
                              bal.productionOrderId,
                              bal.productId,
                              bal.quantity
                            )
                          }
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded hover:bg-indigo-700"
                        >
                          Despachar Entrega (Parcial/Total)
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Dispatches of Finished Goods In Transit / Received */}
          <div className="bg-white rounded-lg border border-slate-200 p-5">
            <h3 className="text-base font-semibold text-slate-900">
              Comprobantes de Entrega y Recepción Formal de Productos Terminados
            </h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3">Folio Entrega</th>
                    <th className="py-2 px-3">Producto Terminado</th>
                    <th className="py-2 px-3">Origen → Destino</th>
                    <th className="py-2 px-3 text-right">Cant. Enviada</th>
                    <th className="py-2 px-3 text-right">Cant. Recibida</th>
                    <th className="py-2 px-3">Estado</th>
                    <th className="py-2 pl-3 text-right">Acción de Recepción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.finishedGoodsDispatches.map((fg) => {
                    const prod = data.products.find((p) => p.id === fg.finishedProductId);
                    const fromW = data.allWarehousesSummary.find(
                      (w) => w.id === fg.fromWarehouseId
                    );
                    const toW = data.allWarehousesSummary.find((w) => w.id === fg.toWarehouseId);

                    return (
                      <tr key={fg.id}>
                        <td className="py-2.5 pr-3 font-mono font-semibold text-slate-900">
                          {fg.dispatchFolio}
                        </td>
                        <td className="py-2.5 px-3">
                          <span className="font-mono font-medium">{prod?.sku}</span> — {prod?.name}
                        </td>
                        <td className="py-2.5 px-3 text-slate-600">
                          {fromW?.name} → {toW?.name}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold tabular-nums">
                          {formatInt(fg.dispatchedQty)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                          {fg.receivedQty !== null ? formatInt(fg.receivedQty) : '—'}
                        </td>
                        <td className="py-2.5 px-3 font-semibold">
                          {fg.status === 'IN_TRANSIT' ? (
                            <span className="text-amber-700">En Tránsito p/ Recibir</span>
                          ) : (
                            <span className="text-emerald-700">{fg.status}</span>
                          )}
                        </td>
                        <td className="py-2.5 pl-3 text-right">
                          {fg.status === 'IN_TRANSIT' ? (
                            <div className="flex items-center justify-end gap-2">
                              <input
                                type="number"
                                min={0}
                                max={fg.dispatchedQty}
                                value={fgReceiveInputs[fg.id] ?? fg.dispatchedQty}
                                onChange={(e) =>
                                  setFgReceiveInputs({
                                    ...fgReceiveInputs,
                                    [fg.id]: Number(e.target.value),
                                  })
                                }
                                className="w-20 text-xs font-mono border border-slate-300 rounded px-2 py-1"
                              />
                              <button
                                type="button"
                                disabled={submitting || !isOnline}
                                onClick={() => handleReceiveFinished(fg.id, fg.dispatchedQty)}
                                className="px-2.5 py-1 text-xs font-semibold text-white bg-emerald-600 rounded hover:bg-emerald-700"
                              >
                                Confirmar Recibido
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">
                              Confirmado {formatBoliviaDateTime(fg.receivedAt)}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
