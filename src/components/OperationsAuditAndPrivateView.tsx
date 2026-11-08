import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import {
  WorkspaceData,
  formatInt,
  formatBoliviaDateTime,
  translateRole,
  translateStatus,
} from '../types.ts';

interface Props {
  data: WorkspaceData;
  isOnline: boolean;
  initialSubView?: 'TRANSFERS' | 'KARDEX' | 'USERS' | 'PRIVATE_OWNER';
  apiFetch: (url: string, options?: RequestInit) => Promise<any>;
  onRefresh: () => Promise<void>;
}

export function OperationsAuditAndPrivateView({
  data,
  isOnline,
  initialSubView = 'TRANSFERS',
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
  const [trToWh, setTrToWh] = useState<number>(data.allWarehousesSummary[1]?.id || data.warehouses[0]?.id || 0);
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

  // User Management State
  const [showUserModal, setShowUserModal] = useState(false);
  const [uUsername, setUUsername] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [uFullName, setUFullName] = useState('');
  const [uRole, setURole] = useState<string>('WAREHOUSE_MANAGER');
  const [uWarehouseId, setUWarehouseId] = useState<string>('');
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

  // Kardex filter
  const [kardexWhFilter, setKardexWhFilter] = useState<number | 'ALL'>('ALL');

  const notify = (text: string, type: 'success' | 'error' = 'success') => {
    setFeedback({ text, type });
    setTimeout(() => setFeedback(null), 4000);
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

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingUser(true);
    try {
      await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          username: uUsername,
          password: uPassword,
          fullName: uFullName,
          role: uRole,
          warehouseId: uWarehouseId ? Number(uWarehouseId) : null,
        }),
      });
      notify('Usuario creado correctamente');
      setShowUserModal(false);
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

  const enrichedLines = data.movementLines.map((line) => {
    const doc = data.movementDocuments.find((d) => d.id === line.documentId);
    return {
      ...line,
      folio: doc?.folio || `DOC-${line.documentId}`,
      movementType: doc?.movementType || 'MOVIMIENTO',
      notes: doc?.notes || doc?.reason || '',
    };
  });

  const filteredLines = enrichedLines.filter((l) => {
    if (kardexWhFilter === 'ALL') return true;
    return l.fromWarehouseId === kardexWhFilter || l.toWarehouseId === kardexWhFilter;
  });

  const exportKardexCSV = () => {
    const headers = ['Fecha', 'Folio', 'Tipo', 'SKU', 'Producto', 'Cantidad', 'Origen', 'Destino', 'Detalle'];
    const rows = filteredLines.map((m) => [
      formatBoliviaDateTime(m.createdAt),
      m.folio,
      m.movementType,
      m.historicalSku,
      `"${m.historicalName.replace(/"/g, '""')}"`,
      m.quantity,
      `"${getWarehouseName(m.fromWarehouseId)}"`,
      `"${getWarehouseName(m.toWarehouseId)}"`,
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
          2. KARDEX E HISTORIAL DE MOVIMIENTOS
         ===================================================================== */}
      {subTab === 'KARDEX' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <History className="w-5 h-5 text-blue-600" />
                Historial General de Movimientos (Kardex)
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Registro auditable de todas las entradas, salidas, producciones y entregas.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
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
              <button
                onClick={exportKardexCSV}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl cursor-pointer"
              >
                <Download className="w-4 h-4" />
                Exportar Excel (CSV)
              </button>
            </div>
          </div>

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
                    <th className="py-3.5 px-4">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredLines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400">
                        No hay movimientos registrados todavía.
                      </td>
                    </tr>
                  ) : (
                    filteredLines.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">
                          {formatBoliviaDateTime(m.createdAt)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-mono font-bold text-slate-800">{m.folio}</div>
                          <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold bg-slate-100 text-slate-700">
                            {m.movementType}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{m.historicalName}</div>
                          <div className="font-mono text-[11px] text-slate-400">{m.historicalSku}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {getWarehouseName(m.fromWarehouseId)} → {getWarehouseName(m.toWarehouseId)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                          {formatInt(m.quantity)}
                        </td>
                        <td className="py-3 px-4 text-slate-600">{m.notes}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          3. GESTION DE USUARIOS Y ACCESOS
         ===================================================================== */}
      {subTab === 'USERS' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" />
                Usuarios, Operarios y Permisos
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">
                Administra las cuentas de acceso para encargados de almacén, producción o recogida.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
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
                  onClick={() => setShowUserModal(true)}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-xs cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  Nuevo Usuario
                </button>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase text-slate-500">
                  <th className="py-3.5 px-4">Usuario (Login)</th>
                  <th className="py-3.5 px-4">Nombre Completo</th>
                  <th className="py-3.5 px-4">Rol en el Sistema</th>
                  <th className="py-3.5 px-4">Almacenes Permitidos</th>
                  <th className="py-3.5 px-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {data.usersPublic.map((u) => {
                  const perms = data.userWarehousePermissions.filter((p) => p.userId === u.id);
                  return (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900">{u.username}</td>
                      <td className="py-3.5 px-4 font-medium text-slate-800">{u.fullName}</td>
                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          {translateRole(u.role)}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 text-xs">
                        {u.role === 'OWNER' || u.role === 'ADMIN'
                          ? 'Todos los almacenes'
                          : perms.map((p) => getWarehouseName(p.warehouseId)).join(', ') || 'Sin asignar'}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {u.username !== 'admin' && data.user.role === 'OWNER' && (
                          <button
                            onClick={() => handleDeleteUser(u.id, u.username)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Eliminar
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Create User Modal */}
          {showUserModal && (
            <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl border border-slate-200">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
                  <h3 className="text-lg font-bold text-slate-900">Crear Nuevo Usuario</h3>
                  <button
                    onClick={() => setShowUserModal(false)}
                    className="text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <form onSubmit={handleCreateUser} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Usuario (Login) *
                      </label>
                      <input
                        type="text"
                        required
                        value={uUsername}
                        onChange={(e) => setUUsername(e.target.value)}
                        placeholder="Ej. juan"
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Contraseña *
                      </label>
                      <input
                        type="text"
                        required
                        value={uPassword}
                        onChange={(e) => setUPassword(e.target.value)}
                        placeholder="Ej. 1234"
                        className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-xl"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Nombre Completo *
                    </label>
                    <input
                      type="text"
                      required
                      value={uFullName}
                      onChange={(e) => setUFullName(e.target.value)}
                      placeholder="Ej. Juan Pérez"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Rol *</label>
                    <select
                      value={uRole}
                      onChange={(e) => setURole(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                    >
                      <option value="WAREHOUSE_MANAGER">Encargado de Almacén</option>
                      <option value="PRODUCTION_MANAGER">Encargado de Producción (Taller)</option>
                      <option value="OPERATOR">Operario de Taller</option>
                      <option value="ADMIN">Administrador Operativo</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Almacén Asignado
                    </label>
                    <select
                      value={uWarehouseId}
                      onChange={(e) => setUWarehouseId(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-xl"
                    >
                      <option value="">Seleccionar almacén...</option>
                      {data.warehouses.map((w) => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setShowUserModal(false)}
                      className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={submittingUser}
                      className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl cursor-pointer"
                    >
                      {submittingUser ? 'Guardando...' : 'Crear Usuario'}
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
                    {resetting ? 'Reiniciando...' : 'Sí, dejar todo en cero'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          4. ZONA PRIVADA DEL PROPIETARIO (COSTOS CONFIDENCIALES)
         ===================================================================== */}
      {subTab === 'PRIVATE_OWNER' && (
        <div className="space-y-6">
          <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-300 text-xs font-bold mb-2">
                <Lock className="w-3.5 h-3.5" />
                ZONA PRIVADA DEL ADMINISTRADOR PRINCIPAL
              </div>
              <h2 className="text-xl font-bold">Costos de Importación / Compra por Lote</h2>
              <p className="text-sm text-slate-300 mt-0.5">
                Los costos registrados al ingresar mercadería solo son visibles en esta bóveda privada.
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/50">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-amber-600" />
                Lotes con Costos Registrados ({privateOverview?.privateCostBatches?.length || 0})
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] font-bold uppercase text-slate-500">
                    <th className="py-3.5 px-4">Código Lote</th>
                    <th className="py-3.5 px-4">Producto</th>
                    <th className="py-3.5 px-4">Proveedor</th>
                    <th className="py-3.5 px-4 text-right">Cantidad</th>
                    <th className="py-3.5 px-4 text-right">Costo Unitario</th>
                    <th className="py-3.5 px-4 text-right">Costo Total Lote</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {loadingPrivate ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400">
                        Cargando costos privados...
                      </td>
                    </tr>
                  ) : !privateOverview?.privateCostBatches ||
                    privateOverview.privateCostBatches.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400">
                        No hay lotes con costos privados registrados aún. Puedes registrar el costo al ingresar stock de cualquier producto.
                      </td>
                    </tr>
                  ) : (
                    privateOverview.privateCostBatches.map((b: any) => (
                      <tr key={b.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">{b.batchCode}</td>
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          {getProductName(b.productId)}
                        </td>
                        <td className="py-3 px-4 text-slate-600">{b.supplierName || '—'}</td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                          {formatInt(b.quantityReceived)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold text-emerald-700">
                          {((b.unitPurchaseCostCents + b.unitImportExpenseCents) / 100).toFixed(2)}{' '}
                          {b.currency}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-bold text-slate-900">
                          {(b.totalLandedCostCents / 100).toFixed(2)} {b.currency}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
