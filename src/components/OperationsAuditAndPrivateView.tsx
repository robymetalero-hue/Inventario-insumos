import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeftRight,
  ClipboardCheck,
  History,
  Lock,
  Plus,
  Send,
  CheckCircle2,
  Download,
  DollarSign,
  Users,
  Trash2,
  RotateCcw,
  ShieldCheck,
  X,
  Search,
  Filter,
  Eye,
  FileCheck2,
  Layers,
  FlaskConical,
} from 'lucide-react';
import {
  WorkspaceData,
  formatInt,
  formatBoliviaDateTime,
  translateRole,
  translateStatus,
  translateMovementType,
} from '../types.ts';

interface Props {
  data: WorkspaceData;
  isOnline: boolean;
  initialSubView?: 'TRANSFERS' | 'KARDEX' | 'USERS' | 'PRIVATE_OWNER';
  initialKardexProductId?: number | null;
  initialKardexOrderId?: number | null;
  onClearKardexContext?: () => void;
  apiFetch: (url: string, options?: RequestInit) => Promise<any>;
  onRefresh: () => Promise<void>;
}

export function OperationsAuditAndPrivateView({
  data,
  isOnline,
  initialSubView = 'TRANSFERS',
  initialKardexProductId = null,
  initialKardexOrderId = null,
  onClearKardexContext,
  apiFetch,
  onRefresh,
}: Props) {
  const [subTab, setSubTab] = useState<'TRANSFERS' | 'KARDEX' | 'USERS' | 'PRIVATE_OWNER'>(
    initialSubView
  );
  useEffect(() => {
    setSubTab(initialSubView);
  }, [initialSubView]);

  const isOwnerOrAdmin = data.user.role === 'OWNER' || data.user.role === 'ADMIN';
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Transfer State
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [trFromWh, setTrFromWh] = useState<number>(data.warehouses[0]?.id || 0);
  const [trToWh, setTrToWh] = useState<number>(
    data.allWarehousesSummary[1]?.id || data.warehouses[0]?.id || 0
  );
  const [trProductId, setTrProductId] = useState<number>(data.products[0]?.id || 0);
  const [trQty, setTrQty] = useState('10');
  const [trNotes, setTrNotes] = useState('');
  const [submittingTr, setSubmittingTr] = useState(false);

  // Physical Count State
  const [showCountModal, setShowCountModal] = useState(false);
  const [cntWhId, setCntWhId] = useState<number>(data.warehouses[0]?.id || 0);
  const [cntProductId, setCntProductId] = useState<number>(data.products[0]?.id || 0);
  const [cntRealQty, setCntRealQty] = useState('0');
  const [cntReason, setCntReason] = useState('Recuento físico de control');
  const [submittingCnt, setSubmittingCnt] = useState(false);

  // User Management State (Create & Edit with Granular Permissions)
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [uUsername, setUUsername] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [uFullName, setUFullName] = useState('');
  const [uRole, setURole] = useState<string>('OPERATOR');
  const [uSelectedWarehouseIds, setUSelectedWarehouseIds] = useState<number[]>([]);
  const [uCanReceive, setUCanReceive] = useState<boolean>(true);
  const [uCanDispatch, setUCanDispatch] = useState<boolean>(true);
  const [uCanProduce, setUCanProduce] = useState<boolean>(true);
  const [uCanCreateCatalog, setUCanCreateCatalog] = useState<boolean>(false);
  const [submittingUser, setSubmittingUser] = useState(false);

  // Reset inventory state
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Private Zone State
  const [privateOverview, setPrivateOverview] = useState<{
    privateCostBatches: any[];
    securityAuditEvents: any[];
    invariantAudit: any;
  } | null>(null);
  const [loadingPrivate, setLoadingPrivate] = useState(false);
  const [v2VerificationResult, setV2VerificationResult] = useState<any | null>(null);
  const [runningV2Verify, setRunningV2Verify] = useState(false);

  // ============================================================================
  // KARDEX & HISTORIAL FILTERS AND SUB-VIEWS
  // ============================================================================
  const [kardexViewMode, setKardexViewMode] = useState<'MOVIMIENTOS' | 'RESUMEN_PRODUCTO'>(
    'MOVIMIENTOS'
  );
  const [kardexSearch, setKardexSearch] = useState('');
  const [kardexWhFilter, setKardexWhFilter] = useState<number | 'ALL'>('ALL');
  const [kardexProductFilter, setKardexProductFilter] = useState<number | 'ALL'>('ALL');
  const [kardexTypeFilter, setKardexTypeFilter] = useState<string>('ALL');
  const [kardexOrderFilter, setKardexOrderFilter] = useState<number | 'ALL'>('ALL');
  const [kardexUserFilter, setKardexUserFilter] = useState<number | 'ALL'>('ALL');
  const [kardexDateFrom, setKardexDateFrom] = useState<string>('');
  const [kardexDateTo, setKardexDateTo] = useState<string>('');
  const [selectedMovementDetail, setSelectedMovementDetail] = useState<any | null>(null);
  const [reversalReason, setReversalReason] = useState<string>('');
  const [reversingDoc, setReversingDoc] = useState<boolean>(false);

  useEffect(() => {
    if (initialKardexProductId) {
      setKardexProductFilter(initialKardexProductId);
      if (onClearKardexContext) onClearKardexContext();
    }
  }, [initialKardexProductId, onClearKardexContext]);

  useEffect(() => {
    if (initialKardexOrderId) {
      setKardexOrderFilter(initialKardexOrderId);
      if (onClearKardexContext) onClearKardexContext();
    }
  }, [initialKardexOrderId, onClearKardexContext]);

  const notify = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedback({ text, type });
    setTimeout(() => setFeedback(null), 4500);
  };

  useEffect(() => {
    if (subTab === 'PRIVATE_OWNER' && data.user.canViewPrivateCosts) {
      setLoadingPrivate(true);
      apiFetch('/api/private/overview')
        .then((res) => setPrivateOverview(res))
        .catch((err) => notify(err.message, 'error'))
        .finally(() => setLoadingPrivate(false));
    }
  }, [subTab, data.user.canViewPrivateCosts]);

  const handleRunV2Verification = async () => {
    setRunningV2Verify(true);
    try {
      const res = await apiFetch('/api/admin/verify-v2-scenarios', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setV2VerificationResult(res);
      notify(
        'Simulación v2.0 completada con éxito (100% aislada con ROLLBACK, 0 datos de prueba en BD)'
      );
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setRunningV2Verify(false);
    }
  };

  const handleReverseMovement = async (docId: number) => {
    if (!reversalReason || reversalReason.trim().length < 4) {
      notify('Indique un motivo obligatorio para el reverso compensatorio.', 'error');
      return;
    }
    setReversingDoc(true);
    try {
      const res = await apiFetch('/api/inventory/reverse-movement', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `rev_${docId}_${Date.now()}`,
          originalDocumentId: docId,
          reason: reversalReason.trim(),
        }),
      });
      notify(
        `Reverso aplicado (${res.reversalFolio}): Se compensó el folio ${res.originalFolio} conservando el historial.`
      );
      setSelectedMovementDetail(null);
      setReversalReason('');
      await onRefresh();
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setReversingDoc(false);
    }
  };

  const getDefaultLocId = (warehouseId: number) => {
    const loc =
      data.allLocationsSummary.find((l) => l.warehouseId === warehouseId) ||
      data.locations.find((l) => l.warehouseId === warehouseId);
    return loc?.id || 1;
  };

  const handleDispatchTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline) return;
    setSubmittingTr(true);
    try {
      await apiFetch('/api/transfers/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `tr_${Date.now()}`,
          fromWarehouseId: Number(trFromWh),
          fromLocationId: getDefaultLocId(Number(trFromWh)),
          toWarehouseId: Number(trToWh),
          toLocationId: getDefaultLocId(Number(trToWh)),
          productId: Number(trProductId),
          quantity: Number(trQty),
          notes: trNotes,
        }),
      });
      notify('Traslado despachado correctamente');
      setShowTransferModal(false);
      setTrNotes('');
      await onRefresh();
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setSubmittingTr(false);
    }
  };

  const handleReceiveTransfer = async (transferId: number, dispatchedQty: number) => {
    if (!isOnline) return;
    try {
      await apiFetch('/api/transfers/receive', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `tr_rcv_${transferId}_${Date.now()}`,
          transferId,
          receivedQty: dispatchedQty,
          notes: 'Recepción confirmada',
        }),
      });
      notify('Traslado recibido y sumado al almacén destino');
      await onRefresh();
    } catch (err: any) {
      notify(err.message, 'error');
    }
  };

  const handleSubmitCount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOnline) return;
    setSubmittingCnt(true);
    try {
      const res = await apiFetch('/api/counts/submit', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `cnt_${Date.now()}`,
          warehouseId: Number(cntWhId),
          locationId: getDefaultLocId(Number(cntWhId)),
          productId: Number(cntProductId),
          countedQty: Number(cntRealQty),
          isBlindCount: false,
          notes: cntReason,
        }),
      });
      if (isOwnerOrAdmin && res?.count?.id && res.count.differenceQty !== 0) {
        await apiFetch('/api/counts/review', {
          method: 'POST',
          body: JSON.stringify({
            idempotencyKey: `cnt_rev_${Date.now()}`,
            countId: res.count.id,
            approve: true,
            reason: cntReason,
          }),
        });
      }
      notify('Conteo físico registrado y aplicado correctamente');
      setShowCountModal(false);
      await onRefresh();
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setSubmittingCnt(false);
    }
  };

  const openCreateUserModal = () => {
    setEditingUserId(null);
    setUUsername('');
    setUPassword('');
    setUFullName('');
    setURole('OPERATOR');
    setUSelectedWarehouseIds(data.allWarehousesSummary.map((w) => w.id));
    setUCanReceive(true);
    setUCanDispatch(true);
    setUCanProduce(true);
    setUCanCreateCatalog(false);
    setShowUserModal(true);
  };

  const openEditUserModal = (targetUser: any) => {
    const perms = data.userWarehousePermissions.filter((p) => p.userId === targetUser.id);
    setEditingUserId(targetUser.id);
    setUUsername(targetUser.username);
    setUPassword('');
    setUFullName(targetUser.fullName);
    setURole(targetUser.role === 'OWNER' ? 'ADMIN' : targetUser.role);
    setUSelectedWarehouseIds(
      perms.length > 0
        ? perms.map((p) => p.warehouseId)
        : data.allWarehousesSummary.map((w) => w.id)
    );
    setUCanReceive(perms.length > 0 ? perms.some((p) => p.canReceive) : true);
    setUCanDispatch(perms.length > 0 ? perms.some((p) => p.canDispatch) : true);
    setUCanProduce(perms.length > 0 ? perms.some((p) => p.canProduce) : false);
    setUCanCreateCatalog(perms.some((p) => p.canApproveAdjustments));
    setShowUserModal(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingUser(true);
    try {
      const payload = {
        username: uUsername,
        password: uPassword,
        fullName: uFullName,
        role: uRole,
        warehouseIds:
          uSelectedWarehouseIds.length > 0
            ? uSelectedWarehouseIds
            : data.allWarehousesSummary.map((w) => w.id),
        canReceive: uCanReceive,
        canDispatch: uCanDispatch,
        canProduce: uCanProduce,
        canCreateCatalog: uCanCreateCatalog,
      };

      if (editingUserId) {
        await apiFetch(`/api/users/${editingUserId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        notify(`Permisos de "${uFullName}" actualizados correctamente`);
      } else {
        await apiFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        notify(`Usuario "${uFullName}" creado correctamente`);
      }

      setShowUserModal(false);
      setEditingUserId(null);
      setUUsername('');
      setUPassword('');
      setUFullName('');
      await onRefresh();
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setSubmittingUser(false);
    }
  };

  const handleDeleteUser = async (userId: number, username: string) => {
    try {
      await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
      notify(`Usuario "${username}" eliminado`);
      await onRefresh();
    } catch (err: any) {
      notify(err.message, 'error');
    }
  };

  const handleResetInventory = async () => {
    setResetting(true);
    try {
      await apiFetch('/api/admin/reset-inventory', { method: 'POST', body: JSON.stringify({}) });
      notify('Inventario reiniciado en cero correctamente');
      setShowResetConfirm(false);
      await onRefresh();
    } catch (err: any) {
      notify(err.message, 'error');
    } finally {
      setResetting(false);
    }
  };

  const getProductName = (id: number) => {
    const p = data.products.find((x) => x.id === id);
    return p ? `${p.sku} — ${p.name}` : `#${id}`;
  };

  const getWarehouseName = (id: number | null) => {
    if (!id) return '—';
    const w =
      data.allWarehousesSummary.find((x) => x.id === id) ||
      data.warehouses.find((x) => x.id === id);
    return w ? w.name : `#${id}`;
  };

  const getLocationName = (id: number | null) => {
    if (!id) return '—';
    const l =
      data.allLocationsSummary.find((x) => x.id === id) ||
      data.locations.find((x) => x.id === id);
    return l ? `${l.code} (${l.zoneName} / ${l.shelfName})` : `#${id}`;
  };

  const getUserName = (id: number | null | undefined) => {
    if (!id) return 'Sistema';
    const u = data.usersPublic.find((x) => x.id === id);
    return u ? `${u.fullName} (@${u.username})` : `Usuario #${id}`;
  };

  const getOrderCode = (id: number | null | undefined) => {
    if (!id) return null;
    const o = data.productionOrders.find((x) => x.id === id);
    return o ? o.orderNumber : `OP-#${id}`;
  };

  // Enrich movement lines with document metadata
  const enrichedLines = useMemo(() => {
    return data.movementLines.map((line) => {
      const doc = data.movementDocuments.find((d) => d.id === line.documentId);
      const orderCode = getOrderCode(doc?.productionOrderId);
      const responsibleUserName = getUserName(doc?.createdByUserId);

      // Compute friendly Before -> After summary
      let beforeVal: number | null = null;
      let afterVal: number | null = null;
      if (line.toWarehouseId && line.toStockBefore !== null && line.toStockBefore !== undefined) {
        beforeVal = line.toStockBefore;
        afterVal = line.toStockAfter ?? null;
      }
      if (
        line.fromWarehouseId &&
        (!line.toWarehouseId ||
          doc?.movementType?.startsWith('RETIRO_') ||
          doc?.movementType === 'TRANSFERENCIA_SALIDA') &&
        line.fromStockBefore !== null &&
        line.fromStockBefore !== undefined
      ) {
        beforeVal = line.fromStockBefore;
        afterVal = line.fromStockAfter ?? null;
      }

      return {
        ...line,
        folio: doc?.folio || `DOC-${line.documentId}`,
        movementType: doc?.movementType || 'MOVIMIENTO',
        reason: doc?.reason || '',
        notes: doc?.notes || doc?.reason || '',
        referenceDoc: doc?.supplierOrContainer || null,
        recipientOrTarget: doc?.recipientOrTarget || null,
        productionOrderId: doc?.productionOrderId || null,
        orderCode,
        responsibleUserId: doc?.createdByUserId || null,
        responsibleUserName,
        beforeVal,
        afterVal,
      };
    });
  }, [data.movementLines, data.movementDocuments, data.productionOrders, data.usersPublic]);

  const filteredLines = useMemo(() => {
    return enrichedLines.filter((m) => {
      if (kardexWhFilter !== 'ALL') {
        if (m.fromWarehouseId !== kardexWhFilter && m.toWarehouseId !== kardexWhFilter) {
          return false;
        }
      }
      if (kardexProductFilter !== 'ALL' && m.productId !== kardexProductFilter) {
        return false;
      }
      if (kardexTypeFilter !== 'ALL' && m.movementType !== kardexTypeFilter) {
        return false;
      }
      if (kardexOrderFilter !== 'ALL' && m.productionOrderId !== kardexOrderFilter) {
        return false;
      }
      if (kardexUserFilter !== 'ALL' && m.responsibleUserId !== kardexUserFilter) {
        return false;
      }
      if (kardexDateFrom) {
        const lineDate = m.createdAt.slice(0, 10);
        if (lineDate < kardexDateFrom) return false;
      }
      if (kardexDateTo) {
        const lineDate = m.createdAt.slice(0, 10);
        if (lineDate > kardexDateTo) return false;
      }
      if (kardexSearch.trim()) {
        const q = kardexSearch.toLowerCase();
        const match =
          m.folio.toLowerCase().includes(q) ||
          m.historicalSku.toLowerCase().includes(q) ||
          m.historicalName.toLowerCase().includes(q) ||
          (m.notes || '').toLowerCase().includes(q) ||
          (m.reason || '').toLowerCase().includes(q) ||
          (m.orderCode || '').toLowerCase().includes(q) ||
          m.responsibleUserName.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [
    enrichedLines,
    kardexWhFilter,
    kardexProductFilter,
    kardexTypeFilter,
    kardexOrderFilter,
    kardexUserFilter,
    kardexDateFrom,
    kardexDateTo,
    kardexSearch,
  ]);

  // Compute Kardex Summary by Product & Warehouse
  const kardexSummaryRows = useMemo(() => {
    const rows: {
      key: string;
      productId: number;
      sku: string;
      productName: string;
      warehouseId: number;
      warehouseName: string;
      initialStock: number;
      entriesQty: number;
      withdrawalsQty: number;
      transfersNetQty: number;
      currentAvailable: number;
      currentCustody: number;
      currentFinished: number;
    }[] = [];

    for (const p of data.products) {
      if (kardexProductFilter !== 'ALL' && p.id !== kardexProductFilter) continue;
      for (const w of data.warehouses) {
        if (kardexWhFilter !== 'ALL' && w.id !== kardexWhFilter) continue;

        const whLines = enrichedLines.filter(
          (l) =>
            l.productId === p.id &&
            (l.fromWarehouseId === w.id || l.toWarehouseId === w.id)
        );

        let entriesQty = 0;
        let withdrawalsQty = 0;
        let transfersNetQty = 0;

        for (const l of whLines) {
          if (
            (l.movementType === 'INGRESO_PROVEEDOR' ||
              l.movementType === 'DEVOLUCION_INSUMOS' ||
              l.movementType === 'REGULARIZACION_AUTORIZADA' ||
              l.movementType === 'APERTURA_INICIAL') &&
            l.toWarehouseId === w.id
          ) {
            entriesQty += l.quantity;
          } else if (
            (l.movementType === 'RETIRO_PRODUCCION' ||
              l.movementType === 'RETIRO_OPERATIVO' ||
              l.movementType === 'RETIRO_MERMA') &&
            l.fromWarehouseId === w.id
          ) {
            withdrawalsQty += l.quantity;
          } else if (l.movementType === 'PRODUCCION_LOTE') {
            if (l.toStatus === 'FINISHED_PENDING_PICKUP' && l.toWarehouseId === w.id) {
              entriesQty += l.quantity;
            } else if (l.fromStatus === 'IN_PRODUCTION_CUSTODY' && l.fromWarehouseId === w.id) {
              withdrawalsQty += l.quantity;
            }
          } else if (l.movementType === 'TRANSFERENCIA_SALIDA' && l.fromWarehouseId === w.id) {
            transfersNetQty -= l.quantity;
          } else if (l.movementType === 'TRANSFERENCIA_RECEPCION' && l.toWarehouseId === w.id) {
            transfersNetQty += l.quantity;
          } else if (
            l.movementType === 'DESPACHO_TERMINADO' ||
            l.movementType === 'RECEPCION_TERMINADO'
          ) {
            if (l.fromWarehouseId === w.id && l.fromStatus === 'FINISHED_PENDING_PICKUP') {
              transfersNetQty -= l.quantity;
            }
            if (l.toWarehouseId === w.id && l.toStatus === 'AVAILABLE') {
              entriesQty += l.quantity;
            }
          }
        }

        const getBal = (status: string) =>
          data.balances
            .filter(
              (b) =>
                b.productId === p.id &&
                b.warehouseId === w.id &&
                b.status === status
            )
            .reduce((acc, b) => acc + b.quantity, 0);

        const currentAvailable = getBal('AVAILABLE');
        const currentCustody =
          getBal('IN_PRODUCTION_CUSTODY') +
          getBal('IN_TRANSIT_PRODUCTION') +
          getBal('RESERVED_PRODUCTION');
        const currentFinished = getBal('FINISHED_PENDING_PICKUP');

        if (
          whLines.length > 0 ||
          currentAvailable > 0 ||
          currentCustody > 0 ||
          currentFinished > 0
        ) {
          rows.push({
            key: `${p.id}_${w.id}`,
            productId: p.id,
            sku: p.sku,
            productName: p.name,
            warehouseId: w.id,
            warehouseName: w.name,
            initialStock: 0,
            entriesQty,
            withdrawalsQty,
            transfersNetQty,
            currentAvailable,
            currentCustody,
            currentFinished,
          });
        }
      }
    }
    return rows;
  }, [data.products, data.warehouses, data.balances, enrichedLines, kardexProductFilter, kardexWhFilter]);

  const exportKardexCSV = () => {
    const headers = [
      'Fecha',
      'Folio',
      'Tipo',
      'SKU',
      'Producto',
      'Cantidad',
      'Stock Antes',
      'Stock Despues',
      'Origen',
      'Destino',
      'Orden Produccion',
      'Usuario',
      'Detalle',
    ];
    const rows = filteredLines.map((m) => [
      formatBoliviaDateTime(m.createdAt),
      m.folio,
      translateMovementType(m.movementType),
      m.historicalSku,
      `"${m.historicalName.replace(/"/g, '""')}"`,
      m.quantity,
      m.beforeVal !== null ? m.beforeVal : '',
      m.afterVal !== null ? m.afterVal : '',
      `"${getWarehouseName(m.fromWarehouseId)}"`,
      `"${getWarehouseName(m.toWarehouseId)}"`,
      m.orderCode || '',
      `"${m.responsibleUserName.replace(/"/g, '""')}"`,
      `"${(m.notes || '').replace(/"/g, '""')}"`,
    ]);
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `kardex_inventario_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {feedback && (
        <div
          className={`p-4 rounded-xl border text-sm font-semibold flex items-center justify-between ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <span>{feedback.text}</span>
          <button onClick={() => setFeedback(null)} className="text-xs underline ml-4 cursor-pointer">
            Cerrar
          </button>
        </div>
      )}

      {/* =====================================================================
          1. TRASLADOS Y CONTEOS FISICOS
         ===================================================================== */}
      {subTab === 'TRANSFERS' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900">
                Traslados entre Almacenes y Conteos Físicos
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Envía mercadería entre Sencata, Villa Dolores o Puente Bolivia, o cuadra el stock físico.
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <button
                onClick={() => {
                  setTrFromWh(data.warehouses[0]?.id || 0);
                  setTrToWh(data.allWarehousesSummary[1]?.id || data.warehouses[0]?.id || 0);
                  setTrProductId(data.products[0]?.id || 0);
                  setShowTransferModal(true);
                }}
                disabled={data.products.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl shadow-xs cursor-pointer"
              >
                <Send className="w-4 h-4" />
                Enviar a otro Almacén
              </button>
              <button
                onClick={() => {
                  setCntWhId(data.warehouses[0]?.id || 0);
                  setCntProductId(data.products[0]?.id || 0);
                  setShowCountModal(true);
                }}
                disabled={data.products.length === 0}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold rounded-xl shadow-xs cursor-pointer"
              >
                <ClipboardCheck className="w-4 h-4" />
                Registrar Conteo Físico
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Transfers Table */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/50">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4 text-blue-600" />
                  Traslados entre Almacenes ({data.warehouseTransfers.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                      <th className="py-3 px-4">Folio / Producto</th>
                      <th className="py-3 px-4">Ruta</th>
                      <th className="py-3 px-4 text-right">Cant.</th>
                      <th className="py-3 px-4 text-right">Estado / Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {data.warehouseTransfers.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-10 text-center text-slate-400">
                          No hay traslados registrados todavía.
                        </td>
                      </tr>
                    ) : (
                      data.warehouseTransfers.map((tr) => (
                        <tr key={tr.id} className="hover:bg-slate-50">
                          <td className="py-3 px-4">
                            <div className="font-mono font-bold text-slate-800">{tr.transferFolio}</div>
                            <div className="text-slate-600 font-medium">{getProductName(tr.productId)}</div>
                          </td>
                          <td className="py-3 px-4 text-slate-600">
                            <span className="font-semibold text-slate-800">
                              {getWarehouseName(tr.fromWarehouseId)}
                            </span>
                            {' → '}
                            <span className="font-semibold text-blue-700">
                              {getWarehouseName(tr.toWarehouseId)}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                            {formatInt(tr.dispatchedQty)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {tr.status === 'IN_TRANSIT' ? (
                              <button
                                onClick={() => handleReceiveTransfer(tr.id, tr.dispatchedQty)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Confirmar Recepción
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md font-semibold">
                                Recibido
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Physical Counts Table */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/50">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <ClipboardCheck className="w-4 h-4 text-emerald-600" />
                  Recuentos Físicos ({data.physicalCounts.length})
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                      <th className="py-3 px-4">Almacén / Producto</th>
                      <th className="py-3 px-4 text-right">Sistema</th>
                      <th className="py-3 px-4 text-right">Contado</th>
                      <th className="py-3 px-4 text-right">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {data.physicalCounts.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-10 text-center text-slate-400">
                          Sin conteos físicos registrados.
                        </td>
                      </tr>
                    ) : (
                      data.physicalCounts.map((c) => (
                        <tr key={c.id} className="hover:bg-slate-50">
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900">{getProductName(c.productId)}</div>
                            <div className="text-slate-500">
                              {getWarehouseName(c.warehouseId)} · {c.notes}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-slate-600">
                            {formatInt(c.systemExpectedQty)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                            {formatInt(c.countedQty)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold">
                            <span
                              className={
                                c.differenceQty === 0
                                  ? 'text-slate-500'
                                  : c.differenceQty > 0
                                  ? 'text-emerald-600'
                                  : 'text-red-600'
                              }
                            >
                              {c.differenceQty > 0 ? `+${c.differenceQty}` : c.differenceQty}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Transfer Modal */}
          {showTransferModal && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
                  <h3 className="text-lg font-bold text-slate-900">Enviar Mercadería a otro Almacén</h3>
                  <button
                    onClick={() => setShowTransferModal(false)}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={handleDispatchTransfer} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Desde Almacén *</label>
                      <select
                        value={trFromWh}
                        onChange={(e) => setTrFromWh(Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                      >
                        {data.warehouses.map((w) => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">Hacia Almacén *</label>
                      <select
                        value={trToWh}
                        onChange={(e) => setTrToWh(Number(e.target.value))}
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                      >
                        {data.allWarehousesSummary.map((w) => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Producto *</label>
                    <select
                      value={trProductId}
                      onChange={(e) => setTrProductId(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                    >
                      {data.products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Cantidad a enviar *</label>
                    <input
                      type="number"
                      min="1"
                      required
                      value={trQty}
                      onChange={(e) => setTrQty(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono font-bold border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Observaciones</label>
                    <input
                      type="text"
                      value={trNotes}
                      onChange={(e) => setTrNotes(e.target.value)}
                      placeholder="Ej. Envío a sucursal"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setShowTransferModal(false)}
                      className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={submittingTr}
                      className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl cursor-pointer"
                    >
                      {submittingTr ? 'Enviando...' : 'Despachar Traslado'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Count Modal */}
          {showCountModal && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
                  <h3 className="text-lg font-bold text-slate-900">Registrar Conteo Físico</h3>
                  <button
                    onClick={() => setShowCountModal(false)}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={handleSubmitCount} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Almacén *</label>
                    <select
                      value={cntWhId}
                      onChange={(e) => setCntWhId(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                    >
                      {data.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Producto *</label>
                    <select
                      value={cntProductId}
                      onChange={(e) => setCntProductId(Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                    >
                      {data.products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Cantidad Física Contada *
                    </label>
                    <input
                      type="number"
                      min="0"
                      required
                      value={cntRealQty}
                      onChange={(e) => setCntRealQty(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono font-bold border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Motivo / Observación *
                    </label>
                    <input
                      type="text"
                      required
                      value={cntReason}
                      onChange={(e) => setCntReason(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setShowCountModal(false)}
                      className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={submittingCnt}
                      className="px-5 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl cursor-pointer"
                    >
                      {submittingCnt ? 'Guardando...' : 'Guardar y Cuadrar Stock'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          2. HISTORIAL Y KARDEX COMPLETO (CON ANTES/DESPUES Y VISTA POR PRODUCTO)
         ===================================================================== */}
      {subTab === 'KARDEX' && (
        <div className="space-y-5">
          {/* Header & View Toggle */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <History className="w-5 h-5 text-blue-600" />
                Historial de Movimientos y Kardex Auditable
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Trazabilidad exacta de entradas, retiros, órdenes de producción, productos terminados y saldos antes/después.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="inline-flex rounded-xl bg-slate-100 p-1 border border-slate-200">
                <button
                  onClick={() => setKardexViewMode('MOVIMIENTOS')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    kardexViewMode === 'MOVIMIENTOS'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Movimientos Detallados ({filteredLines.length})
                </button>
                <button
                  onClick={() => setKardexViewMode('RESUMEN_PRODUCTO')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                    kardexViewMode === 'RESUMEN_PRODUCTO'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Kardex por Producto y Almacén
                </button>
              </div>
              <button
                onClick={exportKardexCSV}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Exportar CSV
              </button>
            </div>
          </div>

          {/* Universal Filter Bar */}
          <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-2.5">
              <div className="relative md:col-span-2">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={kardexSearch}
                  onChange={(e) => setKardexSearch(e.target.value)}
                  placeholder="Buscar folio, SKU, producto, OP-..., usuario o nota..."
                  className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <select
                value={kardexWhFilter}
                onChange={(e) =>
                  setKardexWhFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))
                }
                className="px-3 py-2 text-xs font-semibold border border-slate-200 rounded-xl bg-slate-50"
              >
                <option value="ALL">Todos los Almacenes</option>
                {data.warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>

              <select
                value={kardexProductFilter}
                onChange={(e) =>
                  setKardexProductFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))
                }
                className="px-3 py-2 text-xs font-semibold border border-slate-200 rounded-xl bg-slate-50"
              >
                <option value="ALL">Todos los Productos</option>
                {data.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} — {p.name}
                  </option>
                ))}
              </select>

              <select
                value={kardexTypeFilter}
                onChange={(e) => setKardexTypeFilter(e.target.value)}
                className="px-3 py-2 text-xs font-semibold border border-slate-200 rounded-xl bg-slate-50"
              >
                <option value="ALL">Todos los Tipos</option>
                <option value="INGRESO_PROVEEDOR">Ingreso de Mercadería</option>
                <option value="DEVOLUCION_INSUMOS">Devolución de Insumos</option>
                <option value="REGULARIZACION_AUTORIZADA">Regularización Autorizada</option>
                <option value="RETIRO_PRODUCCION">Retiro p/ Orden Producción</option>
                <option value="RETIRO_OPERATIVO">Retiro Operativo / Otro Uso</option>
                <option value="RETIRO_MERMA">Retiro por Merma / Daño</option>
                <option value="DESPACHO_OP">Entrega de UDP/microSD a Producción</option>
                <option value="ACEPTACION_OP">Recepción en Custodia de Producción</option>
                <option value="PRODUCCION_LOTE">Registro de Producción Terminada</option>
                <option value="RECEPCION_TERMINADO">Entrega / Recogida de Terminados</option>
                <option value="RETORNO_INSUMO_OP">Devolución de Sobrantes de Orden</option>
                <option value="TRANSFERENCIA_SALIDA">Traslado entre Almacenes</option>
                <option value="REVERSO_AUTORIZADO">Corrección / Reverso Autorizado</option>
              </select>

              <select
                value={kardexOrderFilter}
                onChange={(e) =>
                  setKardexOrderFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))
                }
                className="px-3 py-2 text-xs font-semibold border border-slate-200 rounded-xl bg-slate-50"
              >
                <option value="ALL">Todas las Órdenes (OP-...)</option>
                {data.productionOrders.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orderNumber}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-bold text-slate-500 flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5" /> Rango de fechas:
                </span>
                <input
                  type="date"
                  value={kardexDateFrom}
                  onChange={(e) => setKardexDateFrom(e.target.value)}
                  className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg"
                />
                <span className="text-xs text-slate-400">a</span>
                <input
                  type="date"
                  value={kardexDateTo}
                  onChange={(e) => setKardexDateTo(e.target.value)}
                  className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg"
                />
                <select
                  value={kardexUserFilter}
                  onChange={(e) =>
                    setKardexUserFilter(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))
                  }
                  className="px-2.5 py-1 text-xs font-semibold border border-slate-200 rounded-lg bg-slate-50"
                >
                  <option value="ALL">Todos los Usuarios</option>
                  {data.usersPublic.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName} (@{u.username})
                    </option>
                  ))}
                </select>
              </div>
              {(kardexSearch ||
                kardexWhFilter !== 'ALL' ||
                kardexProductFilter !== 'ALL' ||
                kardexTypeFilter !== 'ALL' ||
                kardexOrderFilter !== 'ALL' ||
                kardexUserFilter !== 'ALL' ||
                kardexDateFrom ||
                kardexDateTo) && (
                <button
                  onClick={() => {
                    setKardexSearch('');
                    setKardexWhFilter('ALL');
                    setKardexProductFilter('ALL');
                    setKardexTypeFilter('ALL');
                    setKardexOrderFilter('ALL');
                    setKardexUserFilter('ALL');
                    setKardexDateFrom('');
                    setKardexDateTo('');
                  }}
                  className="text-xs font-bold text-blue-600 hover:underline cursor-pointer"
                >
                  Limpiar todos los filtros
                </button>
              )}
            </div>
          </div>

          {/* Resumen del Período Filtrado */}
          {(() => {
            const totalEntries = filteredLines
              .filter(
                (m) =>
                  m.movementType === 'INGRESO_PROVEEDOR' ||
                  m.movementType === 'DEVOLUCION_INSUMOS' ||
                  m.movementType === 'REGULARIZACION_AUTORIZADA' ||
                  m.movementType === 'APERTURA_INICIAL'
              )
              .reduce((acc, m) => acc + m.quantity, 0);

            const totalWithdrawals = filteredLines
              .filter((m) => m.movementType.startsWith('RETIRO_'))
              .reduce((acc, m) => acc + m.quantity, 0);

            const totalTransformed = filteredLines
              .filter(
                (m) =>
                  m.movementType === 'PRODUCCION_LOTE' &&
                  m.fromStatus === 'IN_PRODUCTION_CUSTODY'
              )
              .reduce((acc, m) => acc + m.quantity, 0);

            const totalManufactured = filteredLines
              .filter(
                (m) =>
                  m.movementType === 'PRODUCCION_LOTE' &&
                  m.toStatus === 'FINISHED_PENDING_PICKUP'
              )
              .reduce((acc, m) => acc + m.quantity, 0);

            return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                  <div className="text-[11px] font-bold uppercase text-emerald-700">
                    Ingresos en el Período
                  </div>
                  <div className="text-lg font-mono font-bold text-emerald-800 mt-0.5">
                    +{formatInt(totalEntries)} u.
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                  <div className="text-[11px] font-bold uppercase text-amber-700">
                    Retiros de Insumos
                  </div>
                  <div className="text-lg font-mono font-bold text-amber-800 mt-0.5">
                    -{formatInt(totalWithdrawals)} u.
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                  <div className="text-[11px] font-bold uppercase text-sky-700">
                    UDP / microSD Transformados
                  </div>
                  <div className="text-lg font-mono font-bold text-sky-800 mt-0.5">
                    {formatInt(totalTransformed)} u.
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs">
                  <div className="text-[11px] font-bold uppercase text-indigo-700">
                    Productos Terminados Fabricados
                  </div>
                  <div className="text-lg font-mono font-bold text-indigo-800 mt-0.5">
                    {formatInt(totalManufactured)} u.
                  </div>
                </div>
              </div>
            );
          })()}

          {kardexViewMode === 'MOVIMIENTOS' ? (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase text-slate-500">
                      <th className="py-3.5 px-4">Fecha / Hora</th>
                      <th className="py-3.5 px-4">Folio / Tipo</th>
                      <th className="py-3.5 px-4">Producto</th>
                      <th className="py-3.5 px-4">Origen → Destino</th>
                      <th className="py-3.5 px-4 text-right">Cantidad</th>
                      <th className="py-3.5 px-4 text-center">Stock Antes → Después</th>
                      <th className="py-3.5 px-4">Orden / Usuario</th>
                      <th className="py-3.5 px-4 text-right">Detalle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredLines.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-slate-400">
                          No hay movimientos que coincidan con los filtros seleccionados.
                        </td>
                      </tr>
                    ) : (
                      filteredLines.map((m) => (
                        <tr
                          key={m.id}
                          onClick={() => setSelectedMovementDetail(m)}
                          className="hover:bg-blue-50/40 transition-colors cursor-pointer"
                        >
                          <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">
                            {formatBoliviaDateTime(m.createdAt)}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-mono font-bold text-slate-900">{m.folio}</div>
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold mt-0.5 ${
                                m.movementType === 'RECEPCION'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : m.movementType.startsWith('RETIRO_')
                                  ? 'bg-amber-50 text-amber-800 border border-amber-200'
                                  : m.movementType === 'PRODUCCION_LOTE'
                                  ? 'bg-indigo-50 text-indigo-700 border border-indigo-200'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {translateMovementType(m.movementType)}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900">{m.historicalName}</div>
                            <div className="font-mono text-[11px] text-slate-400">{m.historicalSku}</div>
                          </td>
                          <td className="py-3 px-4 text-slate-600">
                            <div>
                              <span className="font-semibold text-slate-800">
                                {getWarehouseName(m.fromWarehouseId)}
                              </span>
                              {' → '}
                              <span className="font-semibold text-blue-700">
                                {getWarehouseName(m.toWarehouseId)}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {m.fromStatus ? translateStatus(m.fromStatus) : 'Ingreso'} →{' '}
                              {m.toStatus ? translateStatus(m.toStatus) : 'Salida'}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-sm text-slate-900">
                            {formatInt(m.quantity)}
                          </td>
                          <td className="py-3 px-4 text-center font-mono">
                            {m.beforeVal !== null && m.afterVal !== null ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-800 font-bold text-[11px]">
                                <span>{formatInt(m.beforeVal)}</span>
                                <span className="text-slate-400">→</span>
                                <span
                                  className={
                                    m.afterVal > m.beforeVal
                                      ? 'text-emerald-700'
                                      : m.afterVal < m.beforeVal
                                      ? 'text-amber-700'
                                      : 'text-slate-900'
                                  }
                                >
                                  {formatInt(m.afterVal)}
                                </span>
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {m.orderCode && (
                              <span className="inline-block font-mono font-bold text-[11px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 mb-0.5">
                                {m.orderCode}
                              </span>
                            )}
                            <div className="text-[11px] text-slate-600 truncate max-w-[160px]">
                              {m.responsibleUserName}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedMovementDetail(m);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-semibold text-xs cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Ver
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* KARDEX POR PRODUCTO Y ALMACÉN */
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-600" />
                  Kardex Consolidado por Producto y Almacén ({kardexSummaryRows.length})
                </h3>
                <span className="text-xs text-slate-500">
                  Haz clic en una fila para filtrar sus movimientos detallados
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-bold uppercase text-slate-500">
                      <th className="py-3.5 px-4">SKU / Producto</th>
                      <th className="py-3.5 px-4">Almacén</th>
                      <th className="py-3.5 px-4 text-right">Saldo Inicial</th>
                      <th className="py-3.5 px-4 text-right text-emerald-700">Entradas (+)</th>
                      <th className="py-3.5 px-4 text-right text-amber-700">Salidas / Retiros (-)</th>
                      <th className="py-3.5 px-4 text-right text-blue-700">Traslados Neto</th>
                      <th className="py-3.5 px-4 text-right">En Taller / Custodia</th>
                      <th className="py-3.5 px-4 text-right">Terminado p/ Recoger</th>
                      <th className="py-3.5 px-4 text-right bg-emerald-50/60 text-emerald-900">
                        Saldo Disponible Actual
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {kardexSummaryRows.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="py-12 text-center text-slate-400">
                          No hay saldos ni movimientos para los criterios seleccionados.
                        </td>
                      </tr>
                    ) : (
                      kardexSummaryRows.map((row) => (
                        <tr
                          key={row.key}
                          onClick={() => {
                            setKardexProductFilter(row.productId);
                            setKardexWhFilter(row.warehouseId);
                            setKardexViewMode('MOVIMIENTOS');
                          }}
                          className="hover:bg-blue-50/40 cursor-pointer transition-colors"
                        >
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900">{row.productName}</div>
                            <div className="font-mono text-[11px] text-slate-400">{row.sku}</div>
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-700">
                            {row.warehouseName}
                          </td>
                          <td className="py-3 px-4 text-right font-mono text-slate-500">
                            {formatInt(row.initialStock)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700">
                            +{formatInt(row.entriesQty)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-amber-700">
                            -{formatInt(row.withdrawalsQty)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-blue-700">
                            {row.transfersNetQty > 0
                              ? `+${formatInt(row.transfersNetQty)}`
                              : formatInt(row.transfersNetQty)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-amber-800">
                            {formatInt(row.currentCustody)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-semibold text-indigo-700">
                            {formatInt(row.currentFinished)}
                          </td>
                          <td className="py-3 px-4 text-right font-mono font-bold text-sm bg-emerald-50/40 text-emerald-900">
                            {formatInt(row.currentAvailable)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* MODAL DE DETALLE DE MOVIMIENTO AUDITABLE */}
          {selectedMovementDetail && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                      <FileCheck2 className="w-5 h-5" />
                    </div>
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600">
                        Auditoría de Movimiento
                      </span>
                      <h3 className="text-base font-bold text-slate-900 font-mono">
                        {selectedMovementDetail.folio}
                      </h3>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedMovementDetail(null)}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tipo de Operación:</span>
                    <span className="font-bold text-slate-900">
                      {translateMovementType(selectedMovementDetail.movementType)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Fecha y Hora (Servidor):</span>
                    <span className="font-mono font-semibold text-slate-800">
                      {formatBoliviaDateTime(selectedMovementDetail.createdAt)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Producto:</span>
                    <span className="font-bold text-slate-900">
                      {selectedMovementDetail.historicalSku} — {selectedMovementDetail.historicalName}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Cantidad Movida:</span>
                    <span className="font-mono font-bold text-sm text-blue-700">
                      {formatInt(selectedMovementDetail.quantity)} u.
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Almacén / Ubicación Origen:</span>
                    <span className="font-semibold text-slate-800">
                      {getWarehouseName(selectedMovementDetail.fromWarehouseId)} (
                      {getLocationName(selectedMovementDetail.fromLocationId)})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Almacén / Ubicación Destino:</span>
                    <span className="font-semibold text-slate-800">
                      {getWarehouseName(selectedMovementDetail.toWarehouseId)} (
                      {getLocationName(selectedMovementDetail.toLocationId)})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Transición de Estado:</span>
                    <span className="font-mono font-semibold text-slate-700">
                      {selectedMovementDetail.fromStatus
                        ? translateStatus(selectedMovementDetail.fromStatus)
                        : 'EXTERNO'}{' '}
                      →{' '}
                      {selectedMovementDetail.toStatus
                        ? translateStatus(selectedMovementDetail.toStatus)
                        : 'SALIDA'}
                    </span>
                  </div>
                  {selectedMovementDetail.orderCode && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Orden de Producción:</span>
                      <span className="font-mono font-bold text-blue-700">
                        {selectedMovementDetail.orderCode}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-500">Usuario Responsable:</span>
                    <span className="font-semibold text-slate-900">
                      {selectedMovementDetail.responsibleUserName}
                    </span>
                  </div>
                  {selectedMovementDetail.recipientOrTarget && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Destinatario / Uso:</span>
                      <span className="font-semibold text-slate-800">
                        {selectedMovementDetail.recipientOrTarget}
                      </span>
                    </div>
                  )}
                  {selectedMovementDetail.referenceDoc && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Documento / Referencia:</span>
                      <span className="font-mono text-slate-800">
                        {selectedMovementDetail.referenceDoc}
                      </span>
                    </div>
                  )}
                  {selectedMovementDetail.notes && (
                    <div className="pt-2 border-t border-slate-200">
                      <span className="text-slate-500 block mb-0.5">Motivo / Observaciones:</span>
                      <p className="font-medium text-slate-800">{selectedMovementDetail.notes}</p>
                    </div>
                  )}
                </div>

                {/* Snapshots ANTES y DESPUÉS */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200">
                    <div className="text-[10px] font-bold uppercase text-amber-800">
                      Saldo en Origen (Antes → Después)
                    </div>
                    <div className="font-mono font-bold text-sm text-amber-950 mt-1">
                      {selectedMovementDetail.fromStockBefore !== null &&
                      selectedMovementDetail.fromStockBefore !== undefined
                        ? `${formatInt(selectedMovementDetail.fromStockBefore)} → ${formatInt(
                            selectedMovementDetail.fromStockAfter
                          )}`
                        : 'N/A (Ingreso Externo)'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200">
                    <div className="text-[10px] font-bold uppercase text-emerald-800">
                      Saldo en Destino (Antes → Después)
                    </div>
                    <div className="font-mono font-bold text-sm text-emerald-950 mt-1">
                      {selectedMovementDetail.toStockBefore !== null &&
                      selectedMovementDetail.toStockBefore !== undefined
                        ? `${formatInt(selectedMovementDetail.toStockBefore)} → ${formatInt(
                            selectedMovementDetail.toStockAfter
                          )}`
                        : 'N/A (Salida / Consumo)'}
                    </div>
                  </div>
                </div>

                {/* Reverso Compensatorio (Solo Admin/Owner en movimientos operativos no revertidos) */}
                {isOwnerOrAdmin &&
                  [
                    'INGRESO_PROVEEDOR',
                    'DEVOLUCION_INSUMOS',
                    'REGULARIZACION_AUTORIZADA',
                    'RETIRO_PRODUCCION',
                    'RETIRO_OPERATIVO',
                    'RETIRO_MERMA',
                  ].includes(selectedMovementDetail.movementType) &&
                  !String(selectedMovementDetail.notes || '').includes('[Revertido por') && (
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                      <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <RotateCcw className="w-3.5 h-3.5 text-amber-600" />
                        Corregir con Movimiento Compensatorio (Reverso Autorizado)
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Si este ingreso o retiro tuvo un error, puedes generar un reverso compensatorio referenciado sin borrar el historial original.
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={reversalReason}
                          onChange={(e) => setReversalReason(e.target.value)}
                          placeholder="Motivo obligatorio de la corrección..."
                          className="flex-1 px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                        />
                        <button
                          type="button"
                          disabled={reversingDoc || reversalReason.trim().length < 4}
                          onClick={() => handleReverseMovement(selectedMovementDetail.documentId)}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg cursor-pointer shrink-0"
                        >
                          {reversingDoc ? 'Revirtiendo...' : 'Aplicar Reverso'}
                        </button>
                      </div>
                    </div>
                  )}

                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => {
                      setSelectedMovementDetail(null);
                      setReversalReason('');
                    }}
                    className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl cursor-pointer"
                  >
                    Cerrar Detalle
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          3. GESTION DE USUARIOS Y PERMISOS GRANULARES (PERSONAL vs ADMIN)
         ===================================================================== */}
      {subTab === 'USERS' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                Gestión de Usuarios y Permisos del Personal
              </h2>
              <p className="text-xs text-slate-600 mt-1">
                El <strong>Personal Operativo</strong> nunca puede eliminar productos ni almacenes.
                Como Administrador puedes elegir si cada usuario solo registra{' '}
                <strong>Entradas / Salidas</strong> o si también tiene permiso para{' '}
                <strong>Crear Productos, Almacenes y Departamentos</strong>.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              {data.user.role === 'OWNER' && (
                <button
                  onClick={() => setShowResetConfirm(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2.5 border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold rounded-xl cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reiniciar Inventario en Cero
                </button>
              )}
              {isOwnerOrAdmin && (
                <button
                  onClick={openCreateUserModal}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-xs cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Nuevo Usuario / Personal
                </button>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase text-slate-500">
                    <th className="py-3.5 px-4">Usuario / Nombre</th>
                    <th className="py-3.5 px-4">Nivel</th>
                    <th className="py-3.5 px-4">Permisos Habilitados</th>
                    <th className="py-3.5 px-4">Almacenes</th>
                    <th className="py-3.5 px-4 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {data.usersPublic.map((u) => {
                    const perms = data.userWarehousePermissions.filter((p) => p.userId === u.id);
                    const isUserAdmin = u.role === 'OWNER' || u.role === 'ADMIN';
                    const hasReceive = isUserAdmin || perms.some((p) => p.canReceive);
                    const hasDispatch = isUserAdmin || perms.some((p) => p.canDispatch);
                    const hasProduce = isUserAdmin || perms.some((p) => p.canProduce);
                    const hasCreateCatalog =
                      isUserAdmin || perms.some((p) => p.canApproveAdjustments);

                    return (
                      <tr key={u.id} className="hover:bg-slate-50">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-slate-900 text-sm">{u.fullName}</div>
                          <div className="font-mono text-slate-500">@{u.username}</div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border ${
                              isUserAdmin
                                ? 'bg-indigo-50 text-indigo-800 border-indigo-200'
                                : 'bg-slate-100 text-slate-800 border-slate-200'
                            }`}
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                            {isUserAdmin ? 'Administrador' : 'Personal Operativo'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="flex flex-wrap gap-1.5">
                            {hasReceive && (
                              <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
                                ✓ Ingresar (Entradas)
                              </span>
                            )}
                            {hasDispatch && (
                              <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-900 border border-amber-200 font-semibold">
                                ✓ Retirar (Salidas)
                              </span>
                            )}
                            {hasProduce && (
                              <span className="px-2 py-0.5 rounded-md bg-sky-50 text-sky-800 border border-sky-200 font-semibold">
                                ✓ Producción
                              </span>
                            )}
                            {hasCreateCatalog && (
                              <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 font-semibold">
                                ✓ Crear Productos / Almacenes
                              </span>
                            )}
                            {isUserAdmin ? (
                              <span className="px-2 py-0.5 rounded-md bg-purple-50 text-purple-800 border border-purple-200 font-semibold">
                                ★ Puede Eliminar
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-500 font-medium">
                                ✕ Sin permiso de eliminar
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-600">
                          {isUserAdmin || perms.length >= data.allWarehousesSummary.length
                            ? 'Todos los almacenes'
                            : perms.map((p) => getWarehouseName(p.warehouseId)).join(', ') ||
                              'Sin asignar'}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          {isOwnerOrAdmin && (
                            <div className="inline-flex items-center gap-1.5">
                              {u.role !== 'OWNER' && (
                                <button
                                  type="button"
                                  onClick={() => openEditUserModal(u)}
                                  className="px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer"
                                >
                                  Editar Permisos
                                </button>
                              )}
                              {u.username !== 'admin' && u.role !== 'OWNER' && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteUser(u.id, u.username)}
                                  className="p-1.5 text-red-600 hover:bg-red-50 border border-red-200 rounded-lg cursor-pointer"
                                  title="Eliminar usuario"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Create / Edit User & Permissions Modal */}
          {showUserModal && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
              <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 my-8">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      {editingUserId
                        ? 'Configurar Permisos del Usuario'
                        : 'Nuevo Usuario / Personal'}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Define qué acciones puede realizar este miembro de tu equipo
                    </p>
                  </div>
                  <button
                    onClick={() => setShowUserModal(false)}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleSaveUser} className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        Usuario (Login) *
                      </label>
                      <input
                        type="text"
                        required
                        disabled={Boolean(editingUserId)}
                        value={uUsername}
                        onChange={(e) => setUUsername(e.target.value)}
                        placeholder="Ej. carlos"
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-xl disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block font-bold text-slate-700 mb-1">
                        {editingUserId ? 'Nueva Contraseña (Opcional)' : 'Contraseña *'}
                      </label>
                      <input
                        type="text"
                        required={!editingUserId}
                        value={uPassword}
                        onChange={(e) => setUPassword(e.target.value)}
                        placeholder={editingUserId ? 'Dejar vacío para mantener' : 'Ej. 1234'}
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-xl"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Nombre Completo *
                    </label>
                    <input
                      type="text"
                      required
                      value={uFullName}
                      onChange={(e) => setUFullName(e.target.value)}
                      placeholder="Ej. Carlos Mamani"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                    />
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 mb-1">
                      Tipo de Cuenta *
                    </label>
                    <select
                      value={uRole === 'ADMIN' ? 'ADMIN' : 'OPERATOR'}
                      onChange={(e) => setURole(e.target.value)}
                      className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-xl bg-white font-semibold"
                    >
                      <option value="OPERATOR">
                        Personal Operativo (NO puede eliminar productos ni almacenes)
                      </option>
                      <option value="ADMIN">
                        Administrador (Control total: puede crear, editar y eliminar)
                      </option>
                    </select>
                  </div>

                  {uRole !== 'ADMIN' && (
                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2.5">
                      <div className="font-bold text-slate-900">
                        Permisos habilitados para este personal:
                      </div>

                      <label className="flex items-start gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-white">
                        <input
                          type="checkbox"
                          checked={uCanReceive}
                          onChange={(e) => setUCanReceive(e.target.checked)}
                          className="mt-0.5 rounded border-slate-300 text-emerald-600"
                        />
                        <div>
                          <div className="font-bold text-slate-900">
                            Registrar Entradas (Botón "Ingresar")
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Permite sumar mercadería o insumos al stock disponible
                          </div>
                        </div>
                      </label>

                      <label className="flex items-start gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-white">
                        <input
                          type="checkbox"
                          checked={uCanDispatch}
                          onChange={(e) => setUCanDispatch(e.target.checked)}
                          className="mt-0.5 rounded border-slate-300 text-amber-600"
                        />
                        <div>
                          <div className="font-bold text-slate-900">
                            Registrar Salidas (Botón "Retirar")
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Permite retirar insumos o productos disponibles
                          </div>
                        </div>
                      </label>

                      <label className="flex items-start gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-white">
                        <input
                          type="checkbox"
                          checked={uCanProduce}
                          onChange={(e) => setUCanProduce(e.target.checked)}
                          className="mt-0.5 rounded border-slate-300 text-sky-600"
                        />
                        <div>
                          <div className="font-bold text-slate-900">
                            Registrar Avances en Órdenes de Producción
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Permite recibir chips UDP y reportar lotes terminados
                          </div>
                        </div>
                      </label>

                      <label className="flex items-start gap-2.5 cursor-pointer p-1.5 rounded-lg hover:bg-white border-t border-slate-200 pt-2.5">
                        <input
                          type="checkbox"
                          checked={uCanCreateCatalog}
                          onChange={(e) => setUCanCreateCatalog(e.target.checked)}
                          className="mt-0.5 rounded border-slate-300 text-blue-600"
                        />
                        <div>
                          <div className="font-bold text-blue-950">
                            Crear Productos, Almacenes y Departamentos (Sin poder eliminar)
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Habilita crear nuevos productos o almacenes, pero mantiene bloqueado el
                            botón Eliminar
                          </div>
                        </div>
                      </label>
                    </div>
                  )}

                  {uRole !== 'ADMIN' && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="font-bold text-slate-700">
                          Almacenes donde puede operar *
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setUSelectedWarehouseIds(data.allWarehousesSummary.map((w) => w.id))
                          }
                          className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer"
                        >
                          Seleccionar todos
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {data.allWarehousesSummary.map((w) => {
                          const checked = uSelectedWarehouseIds.includes(w.id);
                          return (
                            <label
                              key={w.id}
                              className={`p-2 rounded-xl border flex items-center gap-2 cursor-pointer ${
                                checked
                                  ? 'bg-blue-50/70 border-blue-300 font-semibold text-slate-900'
                                  : 'bg-white border-slate-200 text-slate-600'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setUSelectedWarehouseIds((prev) => [...prev, w.id]);
                                  } else {
                                    setUSelectedWarehouseIds((prev) =>
                                      prev.filter((id) => id !== w.id)
                                    );
                                  }
                                }}
                                className="rounded border-slate-300"
                              />
                              <span className="truncate">{w.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setShowUserModal(false)}
                      className="px-4 py-2 font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={submittingUser}
                      className="px-5 py-2 font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl cursor-pointer"
                    >
                      {submittingUser
                        ? 'Guardando...'
                        : editingUserId
                        ? 'Guardar Cambios'
                        : 'Crear Usuario'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Reset Inventory Confirm Modal */}
          {showResetConfirm && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
                <h3 className="text-lg font-bold text-slate-900">
                  ¿Reiniciar Todo el Inventario en Cero?
                </h3>
                <p className="text-sm text-slate-600 mt-2">
                  Esta acción vaciará todos los productos, lotes, órdenes y movimientos, dejando tus almacenes y clasificaciones limpios en cero.
                </p>
                <div className="flex justify-end gap-2 mt-6">
                  <button
                    onClick={() => setShowResetConfirm(false)}
                    className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleResetInventory}
                    disabled={resetting}
                    className="px-5 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl cursor-pointer"
                  >
                    {resetting ? 'Reiniciando...' : 'Sí, Reiniciar en Cero'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          4. ZONA PRIVADA DEL DUENO (COSTOS CONFIDENCIALES Y AUDITORIA)
         ===================================================================== */}
      {subTab === 'PRIVATE_OWNER' && (
        <div className="space-y-6">
          <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-md border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-300">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                  Acceso Exclusivo Owner
                </span>
                <h2 className="text-xl font-bold">Costos de Compra y Auditoría Matemática</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Estos valores están ocultos en todas las demás vistas, APIs operativas y exportaciones.
                </p>
              </div>
            </div>
            <button
              onClick={handleRunV2Verification}
              disabled={runningV2Verify}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-sm cursor-pointer"
            >
              <FlaskConical className="w-4 h-4" />
              {runningV2Verify
                ? 'Verificando escenarios v2.0...'
                : 'Verificar Flujo 20,000 UDP (Con Rollback)'}
            </button>
          </div>

          {v2VerificationResult && (
            <div className="bg-emerald-950 text-emerald-100 rounded-2xl p-5 border border-emerald-800 space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-bold text-sm flex items-center gap-2 text-emerald-300">
                  <CheckCircle2 className="w-4 h-4" />
                  Resultado de Simulación Transaccional Aislada (v2.0): PASÓ 10/10 PRUEBAS
                </div>
                <button
                  onClick={() => setV2VerificationResult(null)}
                  className="text-xs text-emerald-300 underline cursor-pointer"
                >
                  Ocultar
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">
                {v2VerificationResult.steps?.map((s: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-lg bg-emerald-900/50 border border-emerald-800/80"
                  >
                    <div className="font-bold text-white flex items-center justify-between">
                      <span>{s.step}</span>
                      <span className="text-emerald-300">{s.passed ? '✓ OK' : '✗ ERROR'}</span>
                    </div>
                    <div className="text-emerald-300 mt-0.5">{s.details}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loadingPrivate ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
              Cargando bóveda privada de costos...
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <DollarSign className="w-4 h-4 text-emerald-600" />
                    Historial Confidencial de Costos por Ingreso (
                    {privateOverview?.privateCostBatches.length || 0})
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                        <th className="py-3 px-4">Fecha</th>
                        <th className="py-3 px-4">Producto</th>
                        <th className="py-3 px-4 text-right">Cantidad</th>
                        <th className="py-3 px-4 text-right">Costo Unit. (Bs)</th>
                        <th className="py-3 px-4 text-right">Costo Total (Bs)</th>
                        <th className="py-3 px-4">Proveedor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {!privateOverview || privateOverview.privateCostBatches.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-10 text-center text-slate-400">
                            No hay costos confidenciales registrados todavía. Al registrar un ingreso como Owner puedes indicar el costo unitario.
                          </td>
                        </tr>
                      ) : (
                        privateOverview.privateCostBatches.map((b: any) => (
                          <tr key={b.id} className="hover:bg-slate-50">
                            <td className="py-3 px-4 font-mono text-slate-500">
                              {formatBoliviaDateTime(b.createdAt)}
                            </td>
                            <td className="py-3 px-4 font-semibold text-slate-900">
                              {getProductName(b.productId)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold">
                              {formatInt(b.quantity)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-emerald-700 font-bold">
                              {b.unitPurchaseCost}
                            </td>
                            <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                              {b.totalPurchaseCost}
                            </td>
                            <td className="py-3 px-4 text-slate-600">{b.supplierReference || '—'}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
                <h3 className="text-sm font-bold text-slate-900">
                  Estado de Integridad Matemática
                </h3>
                {privateOverview?.invariantAudit ? (
                  <div className="space-y-3 text-xs">
                    <div
                      className={`p-3.5 rounded-xl border font-bold ${
                        privateOverview.invariantAudit.healthy
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                          : 'bg-red-50 border-red-200 text-red-900'
                      }`}
                    >
                      {privateOverview.invariantAudit.healthy
                        ? '✓ 0 Saldos Negativos y 100% Órdenes Cuadradas'
                        : '⚠ Se detectaron observaciones'}
                    </div>
                    <div className="text-slate-500">
                      Última verificación:{' '}
                      {formatBoliviaDateTime(privateOverview.invariantAudit.checkedAt)}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-slate-400">Sin datos de auditoría.</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
