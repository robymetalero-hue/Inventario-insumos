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
  Box,
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
  initialSubView?: 'ORDENES' | 'RECOGIDA';
  onRequestWithdrawForOrder?: (orderId: number) => void;
  onNavigateToKardexForOrder?: (orderId: number) => void;
  apiFetch: (url: string, options?: RequestInit) => Promise<any>;
  onRefresh: () => Promise<void>;
}

interface BatchLineForm {
  packagingProductId: number;
  discountPackagingFromStock: boolean;
  finishedProductId: number;
  finishedModelName: string;
  quantityProduced: number;
  strategicQtyConsumed: number;
  notes: string;
}

export function ProductionAndPickupView({
  data,
  isOnline,
  initialSubView = 'ORDENES',
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
  const canProduce = isAdmin || Boolean(data.user.canProduce);
  const canWithdraw = isAdmin || Boolean(data.user.canWithdraw);

  // Helper: derive a clean finished model name from an Empaque/Case name
  const suggestFinishedNameFromPackaging = (packagingName: string, strategicName?: string) => {
    const cleanPack = packagingName
      .replace(/^(case|empaque|carcasa|blister|caja)\s+/i, '')
      .trim();
    const isMicroSd = (strategicName || '').toLowerCase().includes('micro');
    const prefix = isMicroSd ? 'Memoria' : 'USB';
    if (!cleanPack) return `${prefix} Terminado`;
    if (cleanPack.toLowerCase().startsWith('usb') || cleanPack.toLowerCase().startsWith('memoria')) {
      return cleanPack;
    }
    return `${prefix} ${cleanPack}`;
  };

  // Helper: get predetermined warehouse & location with highest available balance for a product
  const getPredeterminedStockSource = (productId: number) => {
    const prodBalances = data.balances
      .filter((b) => b.productId === productId && b.status === 'AVAILABLE' && b.quantity > 0)
      .sort((a, b) => b.quantity - a.quantity);
    const totalAvail = prodBalances.reduce((s, b) => s + b.quantity, 0);
    const topBal = prodBalances[0];
    const wh = topBal
      ? data.allWarehousesSummary.find((w) => w.id === topBal.warehouseId)
      : undefined;
    const loc = topBal
      ? data.allLocationsSummary.find((l) => l.id === topBal.locationId)
      : undefined;
    return {
      totalAvail,
      warehouseId: topBal?.warehouseId || data.warehouses[0]?.id || 0,
      locationId: topBal?.locationId || data.allLocationsSummary[0]?.id || 0,
      warehouseName: wh?.name || 'Almacén',
      locationName: loc ? `${loc.zoneName} - ${loc.shelfName}` : 'Ubicación principal',
      topLocationAvail: topBal?.quantity || 0,
    };
  };

  // =========================================================================
  // 1. MODAL: + NUEVA ORDEN DE PRODUCCIÓN
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
  const [opAssignedUserId, setOpAssignedUserId] = useState<number>(data.user.id);
  const [opInstructions, setOpInstructions] = useState('');

  // =========================================================================
  // 2. MODAL: REGISTRAR PRODUCCIÓN Y USO DE EMPAQUES EN LA ORDEN
  // =========================================================================
  const [produceModalOrder, setProduceModalOrder] = useState<ProductionOrder | null>(null);
  const [batchLines, setBatchLines] = useState<BatchLineForm[]>([]);
  const [selectedWithdrawalFolios, setSelectedWithdrawalFolios] = useState<string[]>([]);

  // =========================================================================
  // 3. MODAL RÁPIDO: DESCONTAR / ASIGNAR EMPAQUE DIRECTAMENTE EN LA ORDEN
  // =========================================================================
  const [assignPackOrder, setAssignPackOrder] = useState<ProductionOrder | null>(null);
  const [assignPackProductId, setAssignPackProductId] = useState<number>(0);
  const [assignPackQty, setAssignPackQty] = useState<number>(500);
  const [assignPackTargetModel, setAssignPackTargetModel] = useState<string>('');

  // =========================================================================
  // 4. MODAL: DEVOLVER SOBRANTES O REPORTAR MERMA DE LA ORDEN
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
      p.name.toLowerCase().includes('terminado')
  );

  const strategicProducts = data.products.filter(
    (p) =>
      p.productType === 'STRATEGIC_COMPONENT' ||
      p.family.toLowerCase().includes('udp') ||
      p.family.toLowerCase().includes('microsd') ||
      p.sku.toLowerCase().includes('udp') ||
      p.name.toLowerCase().includes('udp')
  );
  const selectableStrategicProducts =
    strategicProducts.length > 0 ? strategicProducts : data.products;

  // Empaques / Cases / Secondary supplies available in stock
  const packagingCandidates = data.products.filter((p) => {
    const avail = getPredeterminedStockSource(p.id).totalAvail;
    if (avail <= 0) return false;
    return true;
  });

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
    const pred = getPredeterminedStockSource(firstStrat);
    const defOriginWh = pred.warehouseId || data.warehouses[0]?.id || 0;
    const defTargetWh =
      data.allWarehousesSummary.find((w) => w.isProductionPlant)?.id ||
      data.allWarehousesSummary[1]?.id ||
      defOriginWh;

    setOpStrategicId(firstStrat);
    setOpSourceWhId(defOriginWh);
    setOpTargetWhId(defTargetWh);
    setOpAssignedUserId(data.user.id);
    setOpAuthorizedQty(0);
    setOpInstructions('');
    setOrderModalOpen(true);
  };

  const handleCreateOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || !opStrategicId || opAuthorizedQty <= 0) return;

    const srcLoc =
      data.balances.find(
        (b) =>
          b.productId === opStrategicId &&
          b.warehouseId === opSourceWhId &&
          b.status === 'AVAILABLE' &&
          b.quantity >= opAuthorizedQty
      )?.locationId ||
      data.allLocationsSummary.find((l) => l.warehouseId === opSourceWhId)?.id;
    const dstLoc = data.allLocationsSummary.find((l) => l.warehouseId === opTargetWhId)?.id;
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
          sourceLocationId: srcLoc,
          targetWarehouseId: opTargetWhId,
          targetLocationId: dstLoc,
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
        text: `Orden ${res.order.orderNumber} creada con ${formatInt(
          opAuthorizedQty
        )} u. Confirma la recepción con el botón "Aceptar entrega".`,
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
        )} unidades en custodia listas para armar).`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  // Open Quick Assign / Discount Packaging Modal inside an Order
  const openAssignPackModal = (order: ProductionOrder) => {
    const stratProd = data.products.find((p) => p.id === order.strategicProductId);
    const packCandidates = packagingCandidates.filter((p) => p.id !== order.strategicProductId);
    const defaultPack = packCandidates[0] || packagingCandidates[0];
    const custodyLeft =
      order.receivedInProductionQty -
      order.consumedQty -
      order.returnedQty -
      order.wasteQty;

    setAssignPackOrder(order);
    setAssignPackProductId(defaultPack?.id || 0);
    setAssignPackQty(0);
    setAssignPackTargetModel(
      defaultPack
        ? suggestFinishedNameFromPackaging(defaultPack.name, stratProd?.name)
        : ''
    );
  };

  const handleConfirmAssignPack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline || !assignPackOrder || !assignPackProductId || assignPackQty <= 0) return;

    const source = getPredeterminedStockSource(assignPackProductId);
    const packProd = data.products.find((p) => p.id === assignPackProductId);
    const targetDesc = assignPackTargetModel.trim() || `Armado en ${assignPackOrder.orderNumber}`;

    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await apiFetch('/api/inventory/withdrawals', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `OP-PACK-${assignPackOrder.id}-${Date.now()}`,
          fromWarehouseId: source.warehouseId,
          fromLocationId: source.locationId,
          withdrawalMode: 'PRODUCTION_ORDER',
          productionOrderId: assignPackOrder.id,
          recipientOrTarget: `${targetDesc} (${assignPackOrder.orderNumber})`,
          reason: `Empaque asignado a ${assignPackOrder.orderNumber} para ${targetDesc}`,
          notes: `Destino: ${targetDesc}`,
          items: [
            {
              productId: assignPackProductId,
              quantity: assignPackQty,
            },
          ],
        }),
      });
      setAssignPackOrder(null);
      setFeedback({
        type: 'success',
        text: `Empaque descontado (${res.folio}): -${formatInt(assignPackQty)} u. de ${
          packProd?.name || 'Empaque'
        } desde ${source.warehouseName} → Destino: ${targetDesc}.`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  // Open Production & Packaging Registration Modal inside an Order
  const openProduceModal = (order: ProductionOrder) => {
    const stratProd = data.products.find((p) => p.id === order.strategicProductId);
    const custodyLeft =
      order.receivedInProductionQty -
      order.consumedQty -
      order.returnedQty -
      order.wasteQty;
    const defaultQty = Math.min(500, Math.max(1, custodyLeft));

    // Find withdrawals already linked to this order
    const orderWithdrawDocs = data.movementDocuments.filter(
      (d) => d.productionOrderId === order.id && d.movementType === 'RETIRO_PRODUCCION'
    );

    // Candidate empaques (anything other than the strategic product itself)
    const packOptions = packagingCandidates.filter((p) => p.id !== order.strategicProductId);
    const firstPack = packOptions[0];
    const suggestedModel = firstPack
      ? suggestFinishedNameFromPackaging(firstPack.name, stratProd?.name)
      : finishedProducts[0]?.name || `Producto Terminado ${stratProd?.name || ''}`.trim();

    setProduceModalOrder(order);
    setBatchLines([
      {
        packagingProductId: firstPack?.id || 0,
        discountPackagingFromStock: orderWithdrawDocs.length === 0 && Boolean(firstPack),
        finishedProductId: finishedProducts[0]?.id || 0,
        finishedModelName: suggestedModel,
        quantityProduced: 0,
        strategicQtyConsumed: 0,
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
            packagingProductId: line.packagingProductId ? Number(line.packagingProductId) : 0,
            discountPackagingFromStock: Boolean(
              line.packagingProductId && line.discountPackagingFromStock
            ),
            finishedProductId: line.finishedProductId ? Number(line.finishedProductId) : 0,
            finishedModelName: line.finishedModelName.trim(),
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
        text: `Producción registrada (${res.folio}): +${formatInt(
          res.totalFinishedProduced
        )} terminados creados y -${formatInt(
          res.totalStrategicConsumed
        )} componentes consumidos. Quedan ${formatInt(
          res.remainingCustodyQty
        )} u. en custodia.`,
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
    setReturnReason('Devolución de sobrantes al almacén de origen');
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
              }).`
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
            )} productos terminados ya están DISPONIBLES en el almacén destino.`
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
      {/* Sub-navigation */}
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

        {canProduce && subTab === 'ORDENES' && (
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
      {/* TAB 1: ÓRDENES DE PRODUCCIÓN                                          */}
      {/* ===================================================================== */}
      {subTab === 'ORDENES' && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Órdenes de Producción y Asignación de Empaques / Cases
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                Desde cada orden puedes descontar directamente los empaques/cases de su almacén
                indicando qué modelo se está armando y cuántas unidades van a cada destino.
              </p>
            </div>
            {canProduce && (
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
                componentes (por ejemplo: 1,000 UDP) hacia producción y reportar ahí mismo los
                empaques utilizados.
              </p>
              {canProduce && (
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
                            Componente Principal: {stratProd?.name} ({stratProd?.sku})
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
                        {order.reservedQty > 0 && canProduce && (
                          <button
                            type="button"
                            disabled={submitting}
                            onClick={() => handleDispatchOrder(order)}
                            className="px-3.5 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl cursor-pointer"
                          >
                            Enviar {formatInt(order.reservedQty)} u. a Producción
                          </button>
                        )}

                        {canWithdraw && (
                          <button
                            type="button"
                            onClick={() => openAssignPackModal(order)}
                            className="px-3.5 py-2 text-xs font-bold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-xl flex items-center gap-1.5 cursor-pointer"
                          >
                            <ArrowUpFromLine className="w-3.5 h-3.5" />
                            Descontar empaque / case
                          </button>
                        )}

                        {custodyLeft > 0 && canProduce && (
                          <button
                            type="button"
                            onClick={() => openProduceModal(order)}
                            className="px-4 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl flex items-center gap-1.5 cursor-pointer shadow-2xs"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Registrar armado / producción
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

                        {custodyLeft > 0 && canProduce && (
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
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            placeholder="Cantidad"
                            value={
                              (ackInputs[d.id]?.qty ?? d.dispatchedQty) > 0
                                ? String(ackInputs[d.id]?.qty ?? d.dispatchedQty)
                                : ''
                            }
                            onChange={(e) => {
                              const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '');
                              setAckInputs({
                                ...ackInputs,
                                [d.id]: {
                                  qty: digits ? Math.min(d.dispatchedQty, Number(digits)) : 0,
                                  notes: ackInputs[d.id]?.notes || '',
                                },
                              });
                            }}
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

                    {/* Two-Column Breakdown: Empaques Descontados y Destino vs Lotes Terminados */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
                      {/* Withdrawn Secondary Supplies for this Order */}
                      <div className="p-4 rounded-xl bg-amber-50/40 border border-amber-200/80 space-y-2.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-amber-950">
                            Empaques / Cases Descontados en esta Orden ({orderWithdrawalLines.length})
                          </span>
                          {canWithdraw && (
                            <button
                              type="button"
                              onClick={() => openAssignPackModal(order)}
                              className="text-[11px] font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 px-2.5 py-1 rounded-lg cursor-pointer"
                            >
                              + Descontar empaque aquí
                            </button>
                          )}
                        </div>
                        {orderWithdrawalLines.length === 0 ? (
                          <div className="text-slate-500 py-2">
                            Al registrar el armado o hacer clic en{' '}
                            <strong>"Descontar empaque / case"</strong>, se descontarán
                            automáticamente de su almacén y verás aquí a qué modelo fueron.
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {orderWithdrawalLines.map((wl) => {
                              const wDoc = orderWithdrawalDocs.find((d) => d.id === wl.documentId);
                              const fromWh = data.allWarehousesSummary.find(
                                (w) => w.id === wDoc?.sourceWarehouseId
                              );
                              return (
                                <div
                                  key={wl.id}
                                  className="p-2.5 bg-white rounded-lg border border-amber-200/90 flex items-center justify-between gap-2"
                                >
                                  <div className="min-w-0">
                                    <div className="font-bold text-slate-900 truncate">
                                      {wl.historicalName}{' '}
                                      <span className="font-mono text-[11px] text-slate-500">
                                        ({wl.historicalSku})
                                      </span>
                                    </div>
                                    <div className="text-[11px] text-amber-900 mt-0.5">
                                      Salió de: <strong>{fromWh?.name || 'Almacén'}</strong> →{' '}
                                      <span>Destino: </span>
                                      <strong>{wDoc?.recipientOrTarget || 'Producción'}</strong>
                                    </div>
                                  </div>
                                  <span className="font-mono font-extrabold text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg shrink-0">
                                    -{formatInt(wl.quantity)} u.
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
                            Productos Terminados Armados en esta Orden ({orderBatches.length})
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
                          <div className="text-slate-500 py-2">
                            Aún no se han registrado modelos terminados en esta orden. Haz clic en{' '}
                            <strong>"Registrar armado / producción"</strong>.
                          </div>
                        ) : (
                          <div className="space-y-1.5">
                            {orderBatches.map((b) => {
                              const fp = data.products.find((p) => p.id === b.finishedProductId);
                              return (
                                <div
                                  key={b.id}
                                  className="p-2.5 bg-white rounded-lg border border-emerald-200/80 flex items-center justify-between gap-2"
                                >
                                  <div className="min-w-0">
                                    <span className="font-mono font-bold text-emerald-700">
                                      {b.batchFolio}
                                    </span>{' '}
                                    · <strong>{fp?.name}</strong>{' '}
                                    <span className="text-slate-400 font-mono">({fp?.sku})</span>
                                    {b.usedWithdrawalFolios && (
                                      <span className="block text-[10px] text-slate-500 mt-0.5">
                                        Empaque descontado: {b.usedWithdrawalFolios}
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
                Recoge productos ya terminados y pásalos a stock disponible en el almacén destino{' '}
                <strong>sin volver a descontar</strong> UDP ni empaques.
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
                Cuando registres el armado en una Orden de Producción, los productos terminados
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
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          placeholder="Cantidad"
                          value={inputQty > 0 ? String(inputQty) : ''}
                          onChange={(e) => {
                            const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '');
                            setFgDispatchQtyMap({
                              ...fgDispatchQtyMap,
                              [key]: digits ? Math.min(bal.quantity, Number(digits)) : 0,
                            });
                          }}
                          className="w-28 text-xs font-mono font-bold border border-slate-300 rounded-xl px-3 py-2"
                        />
                        <button
                          type="button"
                          disabled={submitting || inputQty <= 0}
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
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl border border-slate-200 my-8">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Nueva Orden de Producción
                </h3>
                <p className="text-xs text-slate-500">
                  Selecciona el componente principal (UDP / microSD) y la cantidad a trabajar
                </p>
              </div>
              <button
                onClick={() => setOrderModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateOrder} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Componente Principal (UDP / microSD) *
                </label>
                <select
                  value={opStrategicId}
                  onChange={(e) => {
                    const newId = Number(e.target.value);
                    setOpStrategicId(newId);
                    const pred = getPredeterminedStockSource(newId);
                    if (pred.warehouseId) setOpSourceWhId(pred.warehouseId);
                  }}
                  className="w-full text-sm border border-slate-300 rounded-xl px-3 py-2.5 bg-white font-semibold"
                >
                  {selectableStrategicProducts.map((p) => {
                    const src = getPredeterminedStockSource(p.id);
                    return (
                      <option key={p.id} value={p.id}>
                        {p.name} — Disp: {formatInt(src.totalAvail)} u. ({src.warehouseName})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                <span className="text-slate-600">
                  Saliendo de: <strong className="text-slate-900">{
                    data.allWarehousesSummary.find((w) => w.id === opSourceWhId)?.name || 'Almacén'
                  }</strong>
                </span>
                <span className="font-mono font-bold text-sky-700">
                  Disp: {formatInt(strategicAvailInOrigin)} u.
                </span>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-bold text-slate-700">
                    Cantidad a Entregar a la Orden *
                  </label>
                  <div className="flex items-center gap-1">
                    {[500, 1000, 2000, 5000].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() =>
                          setOpAuthorizedQty(
                            strategicAvailInOrigin > 0
                              ? Math.min(strategicAvailInOrigin, preset)
                              : preset
                          )
                        }
                        className="px-2 py-0.5 text-[11px] font-mono font-bold bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-md cursor-pointer"
                      >
                        {formatInt(preset)}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoFocus
                  placeholder="Escribe la cantidad (ej. 1000)"
                  value={opAuthorizedQty > 0 ? String(opAuthorizedQty) : ''}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '');
                    setOpAuthorizedQty(digits ? Number(digits) : 0);
                  }}
                  className="w-full text-lg font-mono font-bold border border-slate-300 rounded-xl px-3.5 py-2"
                  required
                />
                {opAuthorizedQty > strategicAvailInOrigin && (
                  <p className="text-red-600 font-semibold mt-1 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    Stock disponible insuficiente ({formatInt(strategicAvailInOrigin)} u.).
                  </p>
                )}
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Observación opcional
                </label>
                <input
                  type="text"
                  value={opInstructions}
                  onChange={(e) => setOpInstructions(e.target.value)}
                  placeholder="Ej. Armado Samsung / HP"
                  className="w-full text-sm border border-slate-300 rounded-xl px-3 py-2"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setOrderModalOpen(false)}
                  className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer"
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
                  className="px-5 py-2 font-bold text-white bg-sky-600 hover:bg-sky-700 disabled:opacity-50 rounded-xl flex items-center gap-1.5 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  {submitting ? 'Creando...' : 'Crear Orden'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL RÁPIDO: DESCONTAR EMPAQUE / CASE DIRECTAMENTE EN LA ORDEN       */}
      {/* ===================================================================== */}
      {assignPackOrder && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl border border-slate-200">
            {(() => {
              const packSource = getPredeterminedStockSource(assignPackProductId);
              const afterStock = packSource.totalAvail - assignPackQty;
              return (
                <>
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <div>
                      <span className="font-mono text-xs font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                        {assignPackOrder.orderNumber}
                      </span>
                      <h3 className="text-base font-bold text-slate-900 mt-1">
                        Descontar Empaque / Case en esta Orden
                      </h3>
                    </div>
                    <button
                      onClick={() => setAssignPackOrder(null)}
                      className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <form onSubmit={handleConfirmAssignPack} className="space-y-3.5 text-xs">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        Empaque / Case a descontar *
                      </label>
                      <select
                        value={assignPackProductId}
                        onChange={(e) => {
                          const newId = Number(e.target.value);
                          setAssignPackProductId(newId);
                          const p = data.products.find((pr) => pr.id === newId);
                          const strat = data.products.find(
                            (pr) => pr.id === assignPackOrder.strategicProductId
                          );
                          if (p) {
                            setAssignPackTargetModel(
                              suggestFinishedNameFromPackaging(p.name, strat?.name)
                            );
                          }
                        }}
                        className="w-full text-sm border border-slate-300 rounded-xl px-3 py-2.5 bg-white font-semibold"
                      >
                        {packagingCandidates.map((p) => {
                          const src = getPredeterminedStockSource(p.id);
                          return (
                            <option key={p.id} value={p.id}>
                              {p.name} — Disp: {formatInt(src.totalAvail)} u. ({src.warehouseName})
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    {/* Predetermined origin badge */}
                    <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                      <span className="text-slate-600">
                        Saliendo de:{' '}
                        <strong className="text-slate-900">
                          {packSource.warehouseName} · {packSource.locationName}
                        </strong>
                      </span>
                      <span className="font-mono font-bold text-amber-800">
                        {formatInt(packSource.totalAvail)} → {formatInt(Math.max(0, afterStock))} u.
                      </span>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="font-bold text-slate-700">
                          Cantidad de Empaques *
                        </label>
                        <div className="flex items-center gap-1">
                          {[100, 500, 1000, 2000].map((preset) => (
                            <button
                              key={preset}
                              type="button"
                              onClick={() =>
                                setAssignPackQty(Math.min(packSource.totalAvail || preset, preset))
                              }
                              className="px-2 py-0.5 text-[11px] font-mono font-bold bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-md cursor-pointer"
                            >
                              {formatInt(preset)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoFocus
                        placeholder="Escribe la cantidad a retirar"
                        value={assignPackQty > 0 ? String(assignPackQty) : ''}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '');
                          setAssignPackQty(digits ? Number(digits) : 0);
                        }}
                        className="w-full text-lg font-mono font-bold border border-slate-300 rounded-xl px-3.5 py-2"
                        required
                      />
                    </div>

                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        ¿A dónde van estos empaques? (Modelo que se arma) *
                      </label>
                      <input
                        type="text"
                        required
                        value={assignPackTargetModel}
                        onChange={(e) => setAssignPackTargetModel(e.target.value)}
                        placeholder="Ej. USB Samsung 8gb"
                        className="w-full text-sm border border-slate-300 rounded-xl px-3 py-2 font-semibold"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                      <button
                        type="button"
                        onClick={() => setAssignPackOrder(null)}
                        className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={
                          submitting ||
                          !assignPackProductId ||
                          assignPackQty <= 0 ||
                          assignPackQty > packSource.totalAvail
                        }
                        className="px-5 py-2 font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-xl cursor-pointer"
                      >
                        {submitting ? 'Descontando...' : 'Descontar Empaque'}
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
      {/* MODAL 2: REGISTRAR ARMADO / PRODUCCIÓN Y DESCONTAR EMPAQUES           */}
      {/* ===================================================================== */}
      {produceModalOrder && (
        <div className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full p-5 space-y-4 shadow-2xl border border-slate-200 my-8">
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

              const packOptions = packagingCandidates.filter(
                (p) => p.id !== produceModalOrder.strategicProductId
              );

              return (
                <>
                  <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                    <div>
                      <span className="font-mono text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                        {produceModalOrder.orderNumber}
                      </span>
                      <h3 className="text-base font-bold text-slate-900 mt-1">
                        Registrar Armado y Uso de Empaques
                      </h3>
                      <p className="text-xs text-slate-500">
                        Selecciona el empaque/case utilizado, la cantidad armada y a qué producto
                        terminado va.
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
                    <div className="space-y-3">
                      {batchLines.map((line, idx) => {
                        const packSource = line.packagingProductId
                          ? getPredeterminedStockSource(line.packagingProductId)
                          : null;
                        return (
                          <div
                            key={idx}
                            className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-3"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-slate-800 flex items-center gap-1.5">
                                <Box className="w-3.5 h-3.5 text-emerald-600" />
                                Lote #{idx + 1}
                              </span>
                              {batchLines.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setBatchLines(batchLines.filter((_, i) => i !== idx))
                                  }
                                  className="text-red-600 hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" /> Quitar
                                </button>
                              )}
                            </div>

                            {/* 1. Empaque / Case Utilizado */}
                            <div>
                              <label className="block font-bold text-slate-700 mb-1">
                                1. Empaque / Case utilizado
                              </label>
                              <select
                                value={line.packagingProductId}
                                onChange={(e) => {
                                  const packId = Number(e.target.value);
                                  const packProd = data.products.find((p) => p.id === packId);
                                  const copy = [...batchLines];
                                  copy[idx].packagingProductId = packId;
                                  if (packId > 0 && packProd) {
                                    copy[idx].discountPackagingFromStock = true;
                                    copy[idx].finishedModelName = suggestFinishedNameFromPackaging(
                                      packProd.name,
                                      stratProd?.name
                                    );
                                  } else {
                                    copy[idx].discountPackagingFromStock = false;
                                  }
                                  setBatchLines(copy);
                                }}
                                className="w-full text-sm border border-slate-300 rounded-xl px-3 py-2 bg-white font-semibold"
                              >
                                <option value={0}>
                                  -- Sin descontar empaque adicional (o ya descontado antes) --
                                </option>
                                {packOptions.map((p) => {
                                  const src = getPredeterminedStockSource(p.id);
                                  return (
                                    <option key={p.id} value={p.id}>
                                      {p.name} — Disp: {formatInt(src.totalAvail)} u. en{' '}
                                      {src.warehouseName}
                                    </option>
                                  );
                                })}
                              </select>

                              {line.packagingProductId > 0 && packSource && (
                                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 bg-amber-50/80 border border-amber-200 rounded-lg text-[11px]">
                                  <label className="flex items-center gap-1.5 font-semibold text-amber-950 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={line.discountPackagingFromStock}
                                      onChange={(e) => {
                                        const copy = [...batchLines];
                                        copy[idx].discountPackagingFromStock = e.target.checked;
                                        setBatchLines(copy);
                                      }}
                                    />
                                    Descontar {formatInt(line.quantityProduced)} u. de{' '}
                                    {packSource.warehouseName}
                                  </label>
                                  {line.discountPackagingFromStock && (
                                    <span className="font-mono font-bold text-amber-800">
                                      Stock: {formatInt(packSource.totalAvail)} →{' '}
                                      {formatInt(
                                        Math.max(0, packSource.totalAvail - line.quantityProduced)
                                      )}{' '}
                                      u.
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* 2. Cantidad y Producto / Modelo Terminado */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <div className="flex items-center justify-between mb-1">
                                  <label className="font-bold text-slate-700">
                                    2. Cantidad Armada *
                                  </label>
                                  <div className="flex items-center gap-1">
                                    {[100, 500, 1000].map((preset) => (
                                      <button
                                        key={preset}
                                        type="button"
                                        onClick={() => {
                                          const val = Math.min(custodyLeft || preset, preset);
                                          const copy = [...batchLines];
                                          copy[idx].quantityProduced = val;
                                          copy[idx].strategicQtyConsumed = val;
                                          setBatchLines(copy);
                                        }}
                                        className="px-1.5 py-0.5 text-[10px] font-mono font-bold bg-white border border-slate-300 rounded cursor-pointer"
                                      >
                                        {preset}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  placeholder="Cantidad"
                                  value={line.quantityProduced > 0 ? String(line.quantityProduced) : ''}
                                  onChange={(e) => {
                                    const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '');
                                    const val = digits ? Number(digits) : 0;
                                    const copy = [...batchLines];
                                    copy[idx].quantityProduced = val;
                                    copy[idx].strategicQtyConsumed = val;
                                    setBatchLines(copy);
                                  }}
                                  className="w-full font-mono font-bold text-base border border-slate-300 rounded-xl px-3 py-2 bg-white"
                                  required
                                />
                              </div>

                              <div>
                                <label className="block font-bold text-slate-700 mb-1">
                                  3. ¿A dónde va / Modelo Terminado? *
                                </label>
                                <input
                                  type="text"
                                  required
                                  value={line.finishedModelName}
                                  onChange={(e) => {
                                    const copy = [...batchLines];
                                    copy[idx].finishedModelName = e.target.value;
                                    setBatchLines(copy);
                                  }}
                                  placeholder="Ej. USB Samsung 8gb"
                                  className="w-full text-sm font-semibold border border-slate-300 rounded-xl px-3 py-2 bg-white"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}

                      <button
                        type="button"
                        onClick={() => {
                          const firstPack = packOptions[0];
                          setBatchLines([
                            ...batchLines,
                            {
                              packagingProductId: firstPack?.id || 0,
                              discountPackagingFromStock: Boolean(firstPack),
                              finishedProductId: 0,
                              finishedModelName: firstPack
                                ? suggestFinishedNameFromPackaging(firstPack.name, stratProd?.name)
                                : `USB Terminado`,
                              quantityProduced: Math.min(
                                500,
                                Math.max(1, custodyLeft - totalStrategicToConsume)
                              ),
                              strategicQtyConsumed: Math.min(
                                500,
                                Math.max(1, custodyLeft - totalStrategicToConsume)
                              ),
                              notes: '',
                            },
                          ]);
                        }}
                        className="w-full py-2 bg-sky-50 hover:bg-sky-100 text-sky-800 border border-sky-200 rounded-xl font-bold cursor-pointer"
                      >
                        + Agregar otro modelo / empaque en esta misma orden
                      </button>
                    </div>

                    {/* Custody Conservation Preview */}
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between">
                      <span className="text-emerald-950 font-semibold">
                        Custodia de <strong>{stratProd?.name}</strong>:
                      </span>
                      <span className="font-mono font-extrabold text-sm text-emerald-800">
                        {formatInt(custodyLeft)} →{' '}
                        {formatInt(custodyLeft - totalStrategicToConsume)} u.
                      </span>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200">
                      <button
                        type="button"
                        onClick={() => setProduceModalOrder(null)}
                        className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 rounded-xl cursor-pointer"
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
                        className="px-5 py-2 font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-xl cursor-pointer"
                      >
                        {submitting ? 'Guardando...' : 'Confirmar Armado'}
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
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="Cantidad"
                        value={returnQty > 0 ? String(returnQty) : ''}
                        onChange={(e) => {
                          const digits = e.target.value.replace(/\D/g, '').replace(/^0+/, '');
                          setReturnQty(digits ? Math.min(custodyLeft, Number(digits)) : 0);
                        }}
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
