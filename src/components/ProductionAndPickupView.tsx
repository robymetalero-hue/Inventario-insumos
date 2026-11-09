import React, { useState, useEffect } from 'react';
import {
  Factory,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  PackageCheck,
  ArrowUpFromLine,
  RotateCcw,
  History,
  Truck,
  X,
  Check,
  Cpu,
} from 'lucide-react';
import {
  WorkspaceData,
  ProductionOrder,
  formatInt,
  formatBoliviaDateTime,
  translateMovementType,
} from '../types.ts';

interface Props {
  data: WorkspaceData;
  isOnline: boolean;
  initialSubView?: 'ORDENES' | 'RECOGIDA';
  onRequestWithdrawForOrder?: (orderId: number) => void;
  onNavigateToKardexForOrder?: (orderId: number) => void;
  apiFetch: (url: string, options?: RequestInit) => Promise<any>;
  onRefresh: () => Promise<void>;
}

interface BatchLineForm {
  finishedProductId: number;
  quantityProduced: number;
  strategicQtyConsumed: number;
  notes: string;
}

export function ProductionAndPickupView({
  data,
  isOnline,
  initialSubView = 'ORDENES',
  onRequestWithdrawForOrder,
  onNavigateToKardexForOrder,
  apiFetch,
  onRefresh,
}: Props) {
  const [subTab, setSubTab] = useState<'ORDENES' | 'RECOGIDA'>(initialSubView);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setSubTab(initialSubView);
  }, [initialSubView]);

  const isAdmin = data.user.role === 'OWNER' || data.user.role === 'ADMIN';

  // =========================================================================
  // 1. MODAL: + NUEVA ORDEN DE PRODUCCIÓN
  // =========================================================================
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [opStrategicId, setOpStrategicId] = useState<number>(0);
  const [opAuthorizedQty, setOpAuthorizedQty] = useState<number>(4000);
  const [opSourceWhId, setOpSourceWhId] = useState<number>(data.warehouses[0]?.id || 0);
  const [opTargetWhId, setOpTargetWhId] = useState<number>(
    data.allWarehousesSummary.find((w) => w.isProductionPlant)?.id ||
      data.warehouses[0]?.id ||
      0
  );
  const [opAssignedUserId, setOpAssignedUserId] = useState<number>(data.user.id);
  const [opInstructions, setOpInstructions] = useState('');

  // =========================================================================
  // 2. MODAL: REGISTRAR PRODUCCIÓN (MULTI-MODELO SIN RECETAS)
  // =========================================================================
  const [produceModalOrder, setProduceModalOrder] = useState<ProductionOrder | null>(null);
  const [batchLines, setBatchLines] = useState<BatchLineForm[]>([]);
  const [selectedWithdrawalFolios, setSelectedWithdrawalFolios] = useState<string[]>([]);

  // =========================================================================
  // 3. MODAL: DEVOLVER SOBRANTES O REPORTAR MERMA DE LA ORDEN
  // =========================================================================
  const [returnModalOrder, setReturnModalOrder] = useState<ProductionOrder | null>(null);
  const [returnMode, setReturnMode] = useState<'RETURN_TO_ORIGIN' | 'REPORT_WASTE'>(
    'RETURN_TO_ORIGIN'
  );
  const [returnQty, setReturnQty] = useState<number>(500);
  const [returnReason, setReturnReason] = useState('');

  // Inline states for dispatch acceptance and finished goods pickup
  const [ackInputs, setAckInputs] = useState<Record<number, { qty: number; notes: string }>>({});
  const [fgDestWarehouseId, setFgDestWarehouseId] = useState<number>(
    data.allWarehousesSummary.find((w) => !w.isProductionPlant)?.id ||
      data.allWarehousesSummary[0]?.id ||
      0
  );
  const [fgDispatchQtyMap, setFgDispatchQtyMap] = useState<Record<string, number>>({});
  const [fgDirectReceive, setFgDirectReceive] = useState<boolean>(true);

  const finishedProducts = data.products.filter(
    (p) =>
      p.productType === 'FINISHED_GOOD' ||
      p.family.toLowerCase().includes('terminado') ||
      p.name.toLowerCase().includes('terminado') ||
      p.sku.toLowerCase().startsWith('usb')
  );
  const selectableFinishedProducts =
    finishedProducts.length > 0 ? finishedProducts : data.products;

  const strategicProducts = data.products.filter(
    (p) =>
      p.productType === 'STRATEGIC_COMPONENT' ||
      p.family.toLowerCase().includes('udp') ||
      p.family.toLowerCase().includes('microsd') ||
      p.sku.toLowerCase().includes('udp')
  );
  const selectableStrategicProducts =
    strategicProducts.length > 0 ? strategicProducts : data.products;

  // Compute available stock of selected strategic product in origin warehouse
  const strategicAvailInOrigin = opStrategicId
    ? data.balances
        .filter(
          (b) =>
            b.productId === opStrategicId &&
            b.warehouseId === opSourceWhId &&
            b.status === 'AVAILABLE'
        )
        .reduce((s, b) => s + b.quantity, 0)
    : 0;

  // Open New Production Order Modal
  const openCreateOrderModal = () => {
    const firstStrat = selectableStrategicProducts[0]?.id || 0;
    const defOriginWh = data.warehouses[0]?.id || 0;
    const defTargetWh =
      data.allWarehousesSummary.find((w) => w.isProductionPlant)?.id ||
      data.allWarehousesSummary[1]?.id ||
      defOriginWh;

    setOpStrategicId(firstStrat);
    setOpSourceWhId(defOriginWh);
    setOpTargetWhId(defTargetWh);
    setOpAssignedUserId(data.user.id);
    setOpAuthorizedQty(1000);
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
          assignedUserId: opAssignedUserId || data.user.id,
          strategicProductId: opStrategicId,
          authorizedQty: opAuthorizedQty,
          priority: 'NORMAL',
          instructions: opInstructions,
          autoDispatch: true,
        }),
      });
      setOrderModalOpen(false);
      setFeedback({
        type: 'success',
        text: `Orden de Producción ${res.order.orderNumber} creada y ${formatInt(
          opAuthorizedQty
        )} unidades enviadas a producción. Confirma la recepción con el botón "Aceptar entrega".`,
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
        text: `Entrega aceptada en producción (${formatInt(
          input.qty
        )} unidades en custodia listas para transformar).`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  // Open Recipe-Free Production Registration Modal
  const openProduceModal = (order: ProductionOrder) => {
    const custodyLeft =
      order.receivedInProductionQty -
      order.consumedQty -
      order.returnedQty -
      order.wasteQty;
    const defaultFinId = selectableFinishedProducts[0]?.id || 0;
    const defaultQty = Math.min(1000, Math.max(1, custodyLeft));

    // Find withdrawals already linked to this order
    const orderWithdrawDocs = data.movementDocuments.filter(
      (d) => d.productionOrderId === order.id && d.movementType === 'RETIRO_PRODUCCION'
    );

    setProduceModalOrder(order);
    setBatchLines([
      {
        finishedProductId: defaultFinId,
        quantityProduced: defaultQty,
        strategicQtyConsumed: defaultQty,
        notes: '',
      },
    ]);
    setSelectedWithdrawalFolios(orderWithdrawDocs.map((d) => d.folio));
  };

  const handleConfirmProductionBatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || !produceModalOrder || batchLines.length === 0) return;

    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/production/batches', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `BATCH-${produceModalOrder.id}-${Date.now()}`,
          productionOrderId: produceModalOrder.id,
          items: batchLines.map((line) => ({
            finishedProductId: Number(line.finishedProductId),
            quantityProduced: Number(line.quantityProduced),
            strategicQtyConsumed: Number(line.strategicQtyConsumed),
            usedWithdrawalFolios: selectedWithdrawalFolios,
            notes: line.notes,
          })),
        }),
      });
      setProduceModalOrder(null);
      setFeedback({
        type: 'success',
        text: `Producción registrada (${res.folio}): Se crearon +${formatInt(
          res.totalFinishedProduced
        )} productos terminados consumiendo ${formatInt(
          res.totalStrategicConsumed
        )} componentes en custodia. Quedan ${formatInt(
          res.remainingCustodyQty
        )} u. en custodia de la orden.`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  // Open Return Leftovers / Waste Modal
  const openReturnModal = (order: ProductionOrder) => {
    const custodyLeft =
      order.receivedInProductionQty -
      order.consumedQty -
      order.returnedQty -
      order.wasteQty;
    setReturnModalOrder(order);
    setReturnMode('RETURN_TO_ORIGIN');
    setReturnQty(custodyLeft);
    setReturnReason('Devolución de sobrantes no utilizados al almacén de origen');
  };

  const handleConfirmReturnOrWaste = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || !returnModalOrder || returnQty <= 0) return;

    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/production/return-or-waste', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `RET-OP-${returnModalOrder.id}-${Date.now()}`,
          productionOrderId: returnModalOrder.id,
          operationType: returnMode,
          quantity: returnQty,
          reason: returnReason,
        }),
      });
      setReturnModalOrder(null);
      setFeedback({
        type: 'success',
        text:
          returnMode === 'RETURN_TO_ORIGIN'
            ? `Se devolvieron ${formatInt(returnQty)} unidades sobrantes al almacén de origen (${
                res.folio
              }). El stock disponible se incrementó inmediatamente.`
            : `Merma de ${formatInt(returnQty)} unidades registrada en la orden (${res.folio}).`,
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
    setFeedback(null);
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
          autoReceive: fgDirectReceive,
        }),
      });
      setFeedback({
        type: 'success',
        text: fgDirectReceive
          ? `Recogida confirmada (${res.folio}): +${formatInt(
              qty
            )} productos terminados ya están DISPONIBLES en el almacén destino (sin doble descuento de insumos).`
          : `Entrega ${res.dispatch.dispatchFolio} despachada (${formatInt(
              qty
            )} unidades en tránsito).`,
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
        text: `Recepción confirmada: +${formatInt(
          qty
        )} productos terminados disponibles en almacén.`,
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
      {/* Sub-navigation (Strictly Orders & Finished Goods Pickups — Zero Recipes) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSubTab('ORDENES')}
            className={`px-4 py-2.5 text-xs font-bold rounded-xl transition-colors flex items-center gap-2 cursor-pointer ${
              subTab === 'ORDENES'
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
            }`}
          >
            <Factory className="w-4 h-4" />
            Órdenes de Producción ({data.productionOrders.length})
          </button>
          <button
            onClick={() => setSubTab('RECOGIDA')}
            className={`px-4 py-2.5 text-xs font-bold rounded-xl transition-colors flex items-center gap-2 cursor-pointer ${
              subTab === 'RECOGIDA'
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
            }`}
          >
            <Truck className="w-4 h-4" />
            Productos Terminados / Recogidas ({finishedPendingBalances.length})
          </button>
        </div>

        {isAdmin && subTab === 'ORDENES' && (
          <button
            type="button"
            onClick={openCreateOrderModal}
            className="px-4 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-blue-600 to-sky-600 hover:from-blue-700 hover:to-sky-700 rounded-xl flex items-center gap-2 cursor-pointer shadow-sm"
          >
            <Plus className="w-4 h-4" />+ Nueva orden de producción
          </button>
        )}
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
            className="text-xs font-semibold underline ml-4 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 1: ÓRDENES DE PRODUCCIÓN (SIN RECETAS)                            */}
      {/* ===================================================================== */}
      {subTab === 'ORDENES' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Control de Órdenes de Producción y Custodia de Componentes
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Entrega componentes estratégicos (UDP o microSD) a producción, retira empaques/cases
                con el botón Retirar, registra los modelos terminados sin recetas y devuelve
                sobrantes.
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={openCreateOrderModal}
                className="px-4 py-2.5 text-xs font-bold text-white bg-sky-600 hover:bg-sky-700 rounded-xl flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />+ Nueva orden de producción
              </button>
            )}
          </div>

          {data.productionOrders.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center max-w-lg mx-auto space-y-3 shadow-2xs">
              <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center mx-auto">
                <Factory className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900">
                No hay órdenes de producción activas
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Haz clic en <strong>"+ Nueva orden de producción"</strong> para entregar un lote de
                componentes (por ejemplo: 4,000 UDP 8 GB) desde tu almacén principal hacia el área
                de producción.
              </p>
              {isAdmin && (
                <button
                  type="button"
                  onClick={openCreateOrderModal}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl inline-flex items-center gap-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Crear Primera Orden de Producción
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {data.productionOrders.map((order) => {
                const stratProd = data.products.find((p) => p.id === order.strategicProductId);
                const srcWh = data.allWarehousesSummary.find(
                  (w) => w.id === order.sourceWarehouseId
                );
                const dstWh = data.allWarehousesSummary.find(
                  (w) => w.id === order.targetWarehouseId
                );
                const assignedUser = data.usersPublic.find((u) => u.id === order.assignedUserId);

                const custodyLeft =
                  order.receivedInProductionQty -
                  order.consumedQty -
                  order.returnedQty -
                  order.wasteQty;

                const dispatches = data.productionDispatches.filter(
                  (d) => d.productionOrderId === order.id
                );
                const inTransitDispatches = dispatches.filter((d) => d.status === 'IN_TRANSIT');

                const orderBatches = data.productionBatches.filter(
                  (b) => b.productionOrderId === order.id
                );

                // Find secondary supply withdrawals linked to this order
                const orderWithdrawalDocs = data.movementDocuments.filter(
                  (d) =>
                    d.productionOrderId === order.id && d.movementType === 'RETIRO_PRODUCCION'
                );
                const orderWithdrawalDocIds = new Set(orderWithdrawalDocs.map((d) => d.id));
                const orderWithdrawalLines = data.movementLines.filter((l) =>
                  orderWithdrawalDocIds.has(l.documentId)
                );

                // Pending pickup for this order
                const pendingPickupForOrder = data.balances.filter(
                  (b) =>
                    b.productionOrderId === order.id &&
                    b.status === 'FINISHED_PENDING_PICKUP' &&
                    b.quantity > 0
                );

                return (
                  <div
                    key={order.id}
                    className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-2xs"
                  >
                    {/* Header & Action Buttons */}
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 pb-4">
                      <div className="flex items-center gap-3.5">
                        {stratProd?.imageUrl ? (
                          <img
                            src={stratProd.imageUrl}
                            alt={stratProd.name}
                            className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0"
                          />
                        ) : (
                          <div className="w-14 h-14 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                            <Cpu className="w-7 h-7" />
                          </div>
                        )}
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-xs font-extrabold text-white bg-slate-900 px-2.5 py-1 rounded-lg">
                              {order.orderNumber}
                            </span>
                            <span className="text-xs font-semibold text-sky-800 bg-sky-50 border border-sky-200 px-2.5 py-0.5 rounded-lg">
                              {srcWh?.name} → {dstWh?.name}
                            </span>
                            <span className="text-xs text-slate-500">
                              Responsable: <strong>{assignedUser?.fullName || 'Operario'}</strong>
                            </span>
                          </div>
                          <h3 className="text-base font-bold text-slate-900 mt-1">
                            Componente Estratégico: {stratProd?.name} ({stratProd?.sku})
                          </h3>
                          {order.instructions && (
                            <p className="text-xs text-slate-600 mt-0.5">
                              Instrucciones: <em>"{order.instructions}"</em>
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Order Action Toolbar */}
                      <div className="flex flex-wrap items-center gap-2">
                        {order.reservedQty > 0 && isAdmin && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleDispatchOrder(order)}
                            className="px-3.5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl cursor-pointer"
                          >
                            Enviar {formatInt(order.reservedQty)} u. a Producción
                          </button>
                        )}

                        {onRequestWithdrawForOrder && (
                          <button
                            type="button"
                            onClick={() => onRequestWithdrawForOrder(order.id)}
                            className="px-3.5 py-2 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-xl flex items-center gap-1.5 cursor-pointer"
                          >
                            <ArrowUpFromLine className="w-3.5 h-3.5" />
                            Retirar insumos
                          </button>
                        )}

                        {custodyLeft > 0 && (
                          <button
                            type="button"
                            onClick={() => openProduceModal(order)}
                            className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-2xs"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Registrar producción
                          </button>
                        )}

                        {pendingPickupForOrder.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setSubTab('RECOGIDA')}
                            className="px-3.5 py-2 text-xs font-bold text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-xl flex items-center gap-1.5 cursor-pointer"
                          >
                            <Truck className="w-3.5 h-3.5" />
                            Entregar terminados
                          </button>
                        )}

                        {custodyLeft > 0 && (
                          <button
                            type="button"
                            onClick={() => openReturnModal(order)}
                            className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl flex items-center gap-1.5 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Devolver sobrantes ({formatInt(custodyLeft)})
                          </button>
                        )}

                        {onNavigateToKardexForOrder && (
                          <button
                            type="button"
                            onClick={() => onNavigateToKardexForOrder(order.id)}
                            className="px-3 py-2 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl flex items-center gap-1 cursor-pointer"
                          >
                            <History className="w-3.5 h-3.5" />
                            Ver movimientos
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Pending Delivery Acceptance Banner ("Aceptar entrega") */}
                    {inTransitDispatches.map((d) => (
                      <div
                        key={d.id}
                        className="p-4 bg-amber-50 border border-amber-300 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="font-bold text-amber-950 text-sm">
                            Entrega pendiente de recepción ({d.dispatchFolio})
                          </div>
                          <div className="text-amber-900">
                            Se enviaron{' '}
                            <strong className="font-mono">{formatInt(d.dispatchedQty)} u.</strong>{' '}
                            de <strong>{stratProd?.name}</strong> desde {srcWh?.name}. Confirma la
                            cantidad física recibida para pasarla a custodia de producción:
                          </div>
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
                            className="w-28 font-mono font-bold text-sm border border-amber-400 rounded-xl px-3 py-2 bg-white"
                          />
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleAcknowledgeDispatch(d.id, d.dispatchedQty)}
                            className="px-4 py-2 font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl cursor-pointer flex items-center gap-1.5 shadow-2xs"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            Aceptar entrega
                          </button>
                        </div>
                      </div>
                    ))}

                    {/* 5-Column Strategic Component Conservation Strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                      <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                        <div className="text-slate-500 font-medium">1. Asignado a Orden</div>
                        <div className="text-base font-mono font-bold text-slate-900 mt-0.5">
                          {formatInt(order.authorizedQty)} u.
                        </div>
                      </div>
                      <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl">
                        <div className="text-slate-500 font-medium">2. Recibido en Taller</div>
                        <div className="text-base font-mono font-bold text-slate-900 mt-0.5">
                          {formatInt(order.receivedInProductionQty)} u.
                        </div>
                      </div>
                      <div className="p-3 bg-emerald-50/70 border border-emerald-200 rounded-xl">
                        <div className="text-emerald-800 font-medium">
                          3. Consumido en Terminados
                        </div>
                        <div className="text-base font-mono font-bold text-emerald-700 mt-0.5">
                          {formatInt(order.consumedQty)} u.
                        </div>
                      </div>
                      <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl">
                        <div className="text-amber-900 font-medium">
                          4. Devuelto a Origen / Merma
                        </div>
                        <div className="text-base font-mono font-bold text-amber-800 mt-0.5">
                          {formatInt(order.returnedQty)} / {formatInt(order.wasteQty)} u.
                        </div>
                      </div>
                      <div className="p-3 bg-sky-50 border border-sky-200 rounded-xl">
                        <div className="text-sky-900 font-bold">5. Saldo en Custodia Actual</div>
                        <div className="text-base font-mono font-extrabold text-sky-700 mt-0.5">
                          {formatInt(custodyLeft)} u.
                        </div>
                      </div>
                    </div>

                    {/* Two-Column Breakdown: Secondary Supplies Withdrawn vs Finished Batches Produced */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
                      {/* Withdrawn Secondary Supplies for this Order */}
                      <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/80 space-y-2.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-800">
                            Insumos Retirados para esta Orden ({orderWithdrawalLines.length})
                          </span>
                          {onRequestWithdrawForOrder && (
                            <button
                              type="button"
                              onClick={() => onRequestWithdrawForOrder(order.id)}
                              className="text-[11px] font-bold text-amber-700 hover:underline cursor-pointer"
                            >
                              + Retirar más empaques/cases
                            </button>
                          )}
                        </div>
                        {orderWithdrawalLines.length === 0 ? (
                          <div className="text-slate-400 py-2">
                            Aún no se han retirado empaques, cases o adaptadores vinculados a esta
                            orden.
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {orderWithdrawalLines.map((wl) => {
                              const wDoc = orderWithdrawalDocs.find((d) => d.id === wl.documentId);
                              return (
                                <div
                                  key={wl.id}
                                  className="p-2 bg-white rounded-lg border border-slate-200/80 flex items-center justify-between gap-2"
                                >
                                  <div className="min-w-0">
                                    <span className="font-mono font-bold text-amber-800">
                                      {wDoc?.folio}
                                    </span>{' '}
                                    · <strong>{wl.historicalSku}</strong> — {wl.historicalName}
                                  </div>
                                  <span className="font-mono font-bold text-slate-900 shrink-0">
                                    {formatInt(wl.quantity)} u.
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      {/* Finished Batches Produced in this Order */}
                      <div className="p-4 rounded-xl bg-emerald-50/40 border border-emerald-200/80 space-y-2.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-emerald-950">
                            Productos Terminados Fabricados en esta Orden ({orderBatches.length})
                          </span>
                          <span className="font-mono font-bold text-emerald-800">
                            Total:{' '}
                            {formatInt(
                              orderBatches.reduce((s, b) => s + b.quantityProduced, 0)
                            )}{' '}
                            u.
                          </span>
                        </div>
                        {orderBatches.length === 0 ? (
                          <div className="text-slate-400 py-2">
                            Aún no se han registrado lotes de productos terminados en esta orden.
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {orderBatches.map((b) => {
                              const fp = data.products.find((p) => p.id === b.finishedProductId);
                              return (
                                <div
                                  key={b.id}
                                  className="p-2 bg-white rounded-lg border border-emerald-200/80 flex items-center justify-between gap-2"
                                >
                                  <div className="min-w-0">
                                    <span className="font-mono font-bold text-emerald-700">
                                      {b.batchFolio}
                                    </span>{' '}
                                    · <strong>{fp?.sku}</strong> — {fp?.name}
                                    {b.usedWithdrawalFolios && (
                                      <span className="block text-[10px] text-slate-400">
                                        Insumos vinculados: {b.usedWithdrawalFolios}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-right shrink-0">
                                    <div className="font-mono font-bold text-emerald-800">
                                      +{formatInt(b.quantityProduced)} u.
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                      Recogido: {formatInt(b.quantityPickedUp)} u.
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: PRODUCTOS TERMINADOS / RECOGIDAS PARCIALES O TOTALES           */}
      {/* ===================================================================== */}
      {subTab === 'RECOGIDA' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Productos Terminados y Recogidas (Parciales o Totales)
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Recoge productos ya terminados (por ejemplo: recoger 2,000 de 3,500 unidades) y
                pásalos a stock disponible en el almacén destino <strong>sin volver a descontar</strong>{' '}
                UDP ni empaques.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700">Almacén que Recibe:</span>
                <select
                  value={fgDestWarehouseId}
                  onChange={(e) => setFgDestWarehouseId(Number(e.target.value))}
                  className="text-xs border border-slate-300 rounded-xl px-3 py-2 bg-white font-semibold"
                >
                  {data.allWarehousesSummary.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-2 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={fgDirectReceive}
                  onChange={(e) => setFgDirectReceive(e.target.checked)}
                />
                Confirmar recepción inmediata como Disponible
              </label>
            </div>
          </div>

          {finishedPendingBalances.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center max-w-lg mx-auto space-y-2 shadow-2xs">
              <PackageCheck className="w-8 h-8 text-slate-400 mx-auto" />
              <h3 className="text-sm font-bold text-slate-900">
                No hay productos terminados pendientes de recogida
              </h3>
              <p className="text-xs text-slate-500">
                Cuando registres producción en una Orden de Producción, los productos terminados
                aparecerán aquí listos para su recogida parcial o total.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {finishedPendingBalances.map((bal) => {
                const prod = data.products.find((p) => p.id === bal.productId);
                const ord = data.productionOrders.find((o) => o.id === bal.productionOrderId);
                const wh = data.allWarehousesSummary.find((w) => w.id === bal.warehouseId);
                const key = `${bal.productionOrderId}-${bal.productId}`;
                const inputQty = fgDispatchQtyMap[key] ?? bal.quantity;

                return (
                  <div
                    key={bal.id}
                    className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col justify-between gap-4 shadow-2xs"
                  >
                    <div className="flex items-center gap-3.5">
                      {prod?.imageUrl && (
                        <img
                          src={prod.imageUrl}
                          alt={prod.name}
                          className="w-14 h-14 rounded-xl object-cover border border-slate-200 shrink-0"
                        />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-indigo-700 font-bold">
                            {prod?.sku}
                          </span>
                          {ord && (
                            <span className="text-[11px] font-mono font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                              {ord.orderNumber}
                            </span>
                          )}
                        </div>
                        <div className="text-sm font-bold text-slate-900 mt-0.5">{prod?.name}</div>
                        <div className="text-xs text-slate-600 mt-1">
                          Ubicación actual: <strong>{wh?.name}</strong> · Pendiente de recoger:{' '}
                          <strong className="font-mono text-indigo-700">
                            {formatInt(bal.quantity)} u.
                          </strong>
                        </div>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                      <div className="text-xs text-slate-500">
                        Restante tras recoger:{' '}
                        <strong className="font-mono text-slate-800">
                          {formatInt(Math.max(0, bal.quantity - inputQty))} u.
                        </strong>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={bal.quantity}
                          value={inputQty}
                          onChange={(e) =>
                            setFgDispatchQtyMap({
                              ...fgDispatchQtyMap,
                              [key]: Math.max(
                                1,
                                Math.min(bal.quantity, Math.floor(Number(e.target.value)))
                              ),
                            })
                          }
                          className="w-28 text-xs font-mono font-bold border border-slate-300 rounded-xl px-3 py-2"
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
                          className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl cursor-pointer"
                        >
                          {fgDirectReceive ? 'Recoger y Recibir' : 'Despachar'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {data.finishedGoodsDispatches.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
              <h3 className="text-sm font-bold text-slate-900 mb-3">
                Historial de Entregas y Recogidas de Producto Terminado
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200">
                      <th className="py-2.5 px-3">Folio</th>
                      <th className="py-2.5 px-3">Orden</th>
                      <th className="py-2.5 px-3">Producto Terminado</th>
                      <th className="py-2.5 px-3 text-right">Cantidad</th>
                      <th className="py-2.5 px-3">Estado</th>
                      <th className="py-2.5 px-3 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {data.finishedGoodsDispatches.map((fg) => {
                      const p = data.products.find((pr) => pr.id === fg.finishedProductId);
                      const ord = data.productionOrders.find(
                        (o) => o.id === fg.productionOrderId
                      );
                      return (
                        <tr key={fg.id}>
                          <td className="py-2.5 px-3 font-mono font-bold">{fg.dispatchFolio}</td>
                          <td className="py-2.5 px-3 font-mono text-sky-700">
                            {ord?.orderNumber || `#${fg.productionOrderId}`}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-900">
                            {p?.sku} — {p?.name}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold">
                            {formatInt(fg.dispatchedQty)} u.
                          </td>
                          <td className="py-2.5 px-3 font-semibold">
                            {fg.status === 'RECEIVED' ? (
                              <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                                Recibido en Almacén
                              </span>
                            ) : (
                              <span className="text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                                En Tránsito
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {fg.status === 'IN_TRANSIT' ? (
                              <button
                                onClick={() => handleReceiveFinished(fg.id, fg.dispatchedQty)}
                                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg cursor-pointer"
                              >
                                Confirmar Recepción
                              </button>
                            ) : (
                              <span className="text-slate-400 font-mono">
                                {formatBoliviaDateTime(fg.receivedAt)}
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
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 1: + NUEVA ORDEN DE PRODUCCIÓN                                  */}
      {/* ===================================================================== */}
      {orderModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-slate-200 my-8">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3.5">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Nueva Orden de Producción
                </h3>
                <p className="text-xs text-slate-500">
                  Asigna y envía componentes estratégicos (UDP / microSD) a custodia de producción
                </p>
              </div>
              <button
                onClick={() => setOrderModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Almacén de Origen (Salida) *
                  </label>
                  <select
                    value={opSourceWhId}
                    onChange={(e) => setOpSourceWhId(Number(e.target.value))}
                    className="w-full text-sm border border-slate-300 rounded-xl px-3 py-2.5 bg-white font-semibold"
                  >
                    {data.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Almacén / Taller de Producción *
                  </label>
                  <select
                    value={opTargetWhId}
                    onChange={(e) => setOpTargetWhId(Number(e.target.value))}
                    className="w-full text-sm border border-slate-300 rounded-xl px-3 py-2.5 bg-white font-semibold"
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
                <label className="block font-bold text-slate-700 mb-1">
                  Componente Estratégico a Entregar (UDP / microSD) *
                </label>
                <select
                  value={opStrategicId}
                  onChange={(e) => setOpStrategicId(Number(e.target.value))}
                  className="w-full text-sm border border-slate-300 rounded-xl px-3 py-2.5 bg-white font-semibold"
                >
                  {selectableStrategicProducts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.name} ({p.family})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700">
                    Cantidad a Entregar a la Orden *
                  </label>
                  <div className="flex items-center gap-1">
                    {[500, 1000, 2000, 4000, 5000].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setOpAuthorizedQty(preset)}
                        className="px-2 py-0.5 text-[11px] font-mono font-bold bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-md cursor-pointer"
                      >
                        {formatInt(preset)}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={opAuthorizedQty}
                  onChange={(e) =>
                    setOpAuthorizedQty(Math.max(1, Math.floor(Number(e.target.value))))
                  }
                  className="w-full text-lg font-mono font-bold border border-slate-300 rounded-xl px-3.5 py-2.5"
                  required
                />
                {opAuthorizedQty > strategicAvailInOrigin && (
                  <p className="text-red-600 font-semibold mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Stock disponible insuficiente en el almacén de origen (Disponible:{' '}
                    {formatInt(strategicAvailInOrigin)} u.).
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Operario Responsable *
                  </label>
                  <select
                    value={opAssignedUserId}
                    onChange={(e) => setOpAssignedUserId(Number(e.target.value))}
                    className="w-full text-sm border border-slate-300 rounded-xl px-3 py-2 bg-white"
                  >
                    {data.usersPublic.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName} ({u.username})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Modelos sugeridos / Observaciones
                  </label>
                  <input
                    type="text"
                    value={opInstructions}
                    onChange={(e) => setOpInstructions(e.target.value)}
                    placeholder="Ej. Armar HP, Sony y Samsung 8 GB"
                    className="w-full text-sm border border-slate-300 rounded-xl px-3 py-2"
                  />
                </div>
              </div>

              {/* Live Mathematical Preview */}
              <div className="p-3.5 bg-sky-50 border border-sky-200 rounded-xl grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[11px] text-sky-900">Disponible en Origen</div>
                  <div className="text-base font-mono font-bold text-slate-900">
                    {formatInt(strategicAvailInOrigin)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-sky-900">Asignado a OP</div>
                  <div className="text-base font-mono font-bold text-sky-700">
                    -{formatInt(opAuthorizedQty)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] font-bold text-sky-950">Disponible Restante</div>
                  <div
                    className={`text-base font-mono font-extrabold ${
                      strategicAvailInOrigin - opAuthorizedQty < 0
                        ? 'text-red-600'
                        : 'text-emerald-800'
                    }`}
                  >
                    {formatInt(strategicAvailInOrigin - opAuthorizedQty)}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setOrderModalOpen(false)}
                  className="px-4 py-2.5 font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={
                    submitting ||
                    opAuthorizedQty <= 0 ||
                    opAuthorizedQty > strategicAvailInOrigin
                  }
                  className="px-5 py-2.5 font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-xl flex items-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  {submitting ? 'Creando orden...' : 'Confirmar y Enviar a Producción'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: REGISTRAR PRODUCCIÓN (MULTI-MODELO SIN RECETAS)              */}
      {/* ===================================================================== */}
      {produceModalOrder && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-5 shadow-2xl border border-slate-200 my-8">
            {(() => {
              const stratProd = data.products.find(
                (p) => p.id === produceModalOrder.strategicProductId
              );
              const custodyLeft =
                produceModalOrder.receivedInProductionQty -
                produceModalOrder.consumedQty -
                produceModalOrder.returnedQty -
                produceModalOrder.wasteQty;
              const totalToProduce = batchLines.reduce(
                (s, l) => s + (Number(l.quantityProduced) || 0),
                0
              );
              const totalStrategicToConsume = batchLines.reduce(
                (s, l) => s + (Number(l.strategicQtyConsumed) || 0),
                0
              );

              const orderWithdrawDocs = data.movementDocuments.filter(
                (d) =>
                  d.productionOrderId === produceModalOrder.id &&
                  d.movementType === 'RETIRO_PRODUCCION'
              );

              return (
                <>
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3.5">
                    <div>
                      <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        {produceModalOrder.orderNumber}
                      </span>
                      <h3 className="text-base font-bold text-slate-900 mt-1">
                        Registrar Productos Terminados Fabricados (Sin Recetas)
                      </h3>
                      <p className="text-xs text-slate-500">
                        Agrega uno o varios modelos terminados (ej. HP, Sony, Samsung) y consume el
                        componente en custodia sin volver a descontar empaques ya retirados.
                      </p>
                    </div>
                    <button
                      onClick={() => setProduceModalOrder(null)}
                      className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <form onSubmit={handleConfirmProductionBatch} className="space-y-4 text-xs">
                    {/* Lines of Finished Products */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="font-bold text-slate-800">
                          Líneas de Productos Terminados Obtenidos:
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setBatchLines([
                              ...batchLines,
                              {
                                finishedProductId: selectableFinishedProducts[0]?.id || 0,
                                quantityProduced: 500,
                                strategicQtyConsumed: 500,
                                notes: '',
                              },
                            ])
                          }
                          className="px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-xl font-bold cursor-pointer"
                        >
                          + Agregar otro modelo / marca en esta orden
                        </button>
                      </div>

                      {batchLines.map((line, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3"
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="sm:col-span-1">
                              <label className="block font-semibold text-slate-700 mb-1">
                                Producto Terminado *
                              </label>
                              <select
                                value={line.finishedProductId}
                                onChange={(e) => {
                                  const copy = [...batchLines];
                                  copy[idx].finishedProductId = Number(e.target.value);
                                  setBatchLines(copy);
                                }}
                                className="w-full border border-slate-300 rounded-lg px-2.5 py-2 bg-white font-semibold"
                              >
                                {selectableFinishedProducts.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.sku} — {p.name}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block font-semibold text-slate-700 mb-1">
                                Cantidad Producida *
                              </label>
                              <input
                                type="number"
                                min={1}
                                step={1}
                                value={line.quantityProduced}
                                onChange={(e) => {
                                  const val = Math.max(1, Math.floor(Number(e.target.value)));
                                  const copy = [...batchLines];
                                  copy[idx].quantityProduced = val;
                                  copy[idx].strategicQtyConsumed = val; // default 1:1
                                  setBatchLines(copy);
                                }}
                                className="w-full font-mono font-bold text-sm border border-slate-300 rounded-lg px-2.5 py-2 bg-white"
                                required
                              />
                            </div>

                            <div>
                              <label className="block font-semibold text-slate-700 mb-1">
                                {stratProd?.sku || 'UDP'} Consumidos *
                              </label>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={line.strategicQtyConsumed}
                                  onChange={(e) => {
                                    const val = Math.max(1, Math.floor(Number(e.target.value)));
                                    const copy = [...batchLines];
                                    copy[idx].strategicQtyConsumed = val;
                                    setBatchLines(copy);
                                  }}
                                  className="w-full font-mono font-bold text-sm border border-slate-300 rounded-lg px-2.5 py-2 bg-white"
                                  required
                                />
                                {batchLines.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setBatchLines(batchLines.filter((_, i) => i !== idx))
                                    }
                                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Reference Withdrawn Supplies without Double Deduction */}
                    <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2">
                      <div className="font-bold text-amber-950">
                        Insumos secundarios ya retirados para esta orden (Sin doble descuento):
                      </div>
                      {orderWithdrawDocs.length === 0 ? (
                        <div className="text-amber-900 text-[11px]">
                          No hay retiros previos registrados en esta orden, o puedes retirarlos con
                          el botón "Retirar insumos".
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {orderWithdrawDocs.map((d) => {
                            const checked = selectedWithdrawalFolios.includes(d.folio);
                            return (
                              <label
                                key={d.id}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white border border-amber-300 rounded-lg cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedWithdrawalFolios([
                                        ...selectedWithdrawalFolios,
                                        d.folio,
                                      ]);
                                    } else {
                                      setSelectedWithdrawalFolios(
                                        selectedWithdrawalFolios.filter((f) => f !== d.folio)
                                      );
                                    }
                                  }}
                                />
                                <span className="font-mono font-bold text-amber-900">
                                  {d.folio}
                                </span>
                                <span className="text-slate-600">({d.recipientOrTarget})</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Custody Conservation Preview */}
                    <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl grid grid-cols-4 gap-2 text-center">
                      <div>
                        <div className="text-[11px] text-emerald-900">Custodia Actual</div>
                        <div className="text-sm font-mono font-bold text-slate-900">
                          {formatInt(custodyLeft)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-emerald-900">UDP a Consumir</div>
                        <div className="text-sm font-mono font-bold text-amber-700">
                          -{formatInt(totalStrategicToConsume)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-emerald-900">Terminados a Crear</div>
                        <div className="text-sm font-mono font-bold text-emerald-700">
                          +{formatInt(totalToProduce)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] font-bold text-emerald-950">
                          Custodia Restante
                        </div>
                        <div
                          className={`text-sm font-mono font-extrabold ${
                            custodyLeft - totalStrategicToConsume < 0
                              ? 'text-red-600'
                              : 'text-sky-800'
                          }`}
                        >
                          {formatInt(custodyLeft - totalStrategicToConsume)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-200">
                      <button
                        type="button"
                        onClick={() => setProduceModalOrder(null)}
                        className="px-4 py-2.5 font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={
                          submitting ||
                          totalToProduce <= 0 ||
                          totalStrategicToConsume > custodyLeft
                        }
                        className="px-5 py-2.5 font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl cursor-pointer"
                      >
                        {submitting
                          ? 'Registrando producción...'
                          : 'Confirmar Producción Terminada'}
                      </button>
                    </div>
                  </form>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: DEVOLVER SOBRANTES AL ALMACÉN ORIGEN O REPORTAR MERMA        */}
      {/* ===================================================================== */}
      {returnModalOrder && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl border border-slate-200">
            {(() => {
              const custodyLeft =
                returnModalOrder.receivedInProductionQty -
                returnModalOrder.consumedQty -
                returnModalOrder.returnedQty -
                returnModalOrder.wasteQty;
              return (
                <>
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <div>
                      <span className="font-mono text-xs font-bold text-sky-700">
                        {returnModalOrder.orderNumber}
                      </span>
                      <h3 className="text-base font-bold text-slate-900">
                        Devolver Sobrantes o Reportar Merma
                      </h3>
                    </div>
                    <button
                      onClick={() => setReturnModalOrder(null)}
                      className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <form onSubmit={handleConfirmReturnOrWaste} className="space-y-4 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setReturnMode('RETURN_TO_ORIGIN')}
                        className={`p-3 rounded-xl border text-left font-bold cursor-pointer ${
                          returnMode === 'RETURN_TO_ORIGIN'
                            ? 'bg-emerald-50 border-emerald-500 text-emerald-950'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        Devolver sobrantes al almacén origen
                      </button>
                      <button
                        type="button"
                        onClick={() => setReturnMode('REPORT_WASTE')}
                        className={`p-3 rounded-xl border text-left font-bold cursor-pointer ${
                          returnMode === 'REPORT_WASTE'
                            ? 'bg-red-50 border-red-500 text-red-950'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        Reportar merma / daño en taller
                      </button>
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        Cantidad (Máx. en custodia: {formatInt(custodyLeft)} u.) *
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={custodyLeft}
                        value={returnQty}
                        onChange={(e) =>
                          setReturnQty(
                            Math.max(1, Math.min(custodyLeft, Math.floor(Number(e.target.value))))
                          )
                        }
                        className="w-full text-lg font-mono font-bold border border-slate-300 rounded-xl px-3 py-2"
                        required
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        Motivo / Observación *
                      </label>
                      <input
                        type="text"
                        required
                        value={returnReason}
                        onChange={(e) => setReturnReason(e.target.value)}
                        className="w-full text-sm border border-slate-300 rounded-xl px-3 py-2"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-200">
                      <button
                        type="button"
                        onClick={() => setReturnModalOrder(null)}
                        className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={submitting || returnQty <= 0 || returnQty > custodyLeft}
                        className="px-5 py-2 font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer"
                      >
                        {submitting ? 'Procesando...' : 'Confirmar Operación'}
                      </button>
                    </div>
                  </form>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
