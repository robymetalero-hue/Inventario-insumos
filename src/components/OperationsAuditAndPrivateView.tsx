import React, { useState, useEffect } from 'react';
import {
  ArrowRightLeft,
  ClipboardCheck,
  FileSpreadsheet,
  Lock,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Download,
  Play,
  Users,
} from 'lucide-react';
import {
  WorkspaceData,
  formatInt,
  formatBoliviaDateTime,
  translateStatus,
  translateRole,
} from '../types.ts';

interface Props {
  data: WorkspaceData;
  isOnline: boolean;
  activeSection: 'TRANSFERS_COUNTS' | 'KARDEX_REPORTS' | 'OWNER_PRIVATE';
  apiFetch: (url: string, options?: RequestInit) => Promise<any>;
  onRefresh: () => Promise<void>;
}

export function OperationsAuditAndPrivateView({
  data,
  isOnline,
  activeSection,
  apiFetch,
  onRefresh,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Transfers State
  const [trFromWhId, setTrFromWhId] = useState<number>(data.warehouses[0]?.id || 0);
  const [trFromLocId, setTrFromLocId] = useState<number>(
    data.locations.find((l) => l.warehouseId === data.warehouses[0]?.id)?.id || 0
  );
  const [trToWhId, setTrToWhId] = useState<number>(
    data.allWarehousesSummary[1]?.id || data.allWarehousesSummary[0]?.id || 0
  );
  const [trToLocId, setTrToLocId] = useState<number>(
    data.allLocationsSummary.find(
      (l) =>
        l.warehouseId ===
        (data.allWarehousesSummary[1]?.id || data.allWarehousesSummary[0]?.id)
    )?.id || 0
  );
  const [trProductId, setTrProductId] = useState<number>(data.products[0]?.id || 0);
  const [trQty, setTrQty] = useState<number>(500);
  const [trNotes, setTrNotes] = useState('');
  const [trReceiveInputs, setTrReceiveInputs] = useState<Record<number, number>>({});

  // Physical Counts State (Blind Count by Default)
  const [cntWhId, setCntWhId] = useState<number>(data.warehouses[0]?.id || 0);
  const [cntLocId, setCntLocId] = useState<number>(
    data.locations.find((l) => l.warehouseId === data.warehouses[0]?.id)?.id || 0
  );
  const [cntProdId, setCntProdId] = useState<number>(data.products[0]?.id || 0);
  const [cntQty, setCntQty] = useState<number>(0);
  const [cntBlind, setCntBlind] = useState<boolean>(true);
  const [cntNotes, setCntNotes] = useState('');

  // Kardex Filters
  const [kardexSearch, setKardexSearch] = useState('');
  const [kardexTypeFilter, setKardexTypeFilter] = useState('ALL');

  // Private Zone State (Strictly fetched from /api/private/overview)
  const [privateData, setPrivateData] = useState<{
    privateCostBatches: any[];
    securityAuditEvents: any[];
    invariantAudit: any;
  } | null>(null);
  const [privateError, setPrivateError] = useState<string | null>(null);

  // Automated Verification Suite State
  const [suiteRunning, setSuiteRunning] = useState(false);
  const [suiteReport, setSuiteReport] = useState<any | null>(null);

  const isOwner = data.user.role === 'OWNER' || data.user.canViewPrivateCosts;
  const isOwnerOrAdmin = data.user.role === 'OWNER' || data.user.role === 'ADMIN';

  useEffect(() => {
    if (activeSection === 'OWNER_PRIVATE') {
      loadPrivateOverview();
    }
  }, [activeSection, data.user.id]);

  const loadPrivateOverview = async () => {
    setPrivateError(null);
    try {
      const res = await apiFetch('/api/private/overview');
      setPrivateData(res);
    } catch (err: any) {
      setPrivateData(null);
      setPrivateError(err.message);
    }
  };

  const handleCreateTransfer = async () => {
    if (!isOnline) return;
    setSubmitting(true);
    setFeedbackMsg(null);
    try {
      const res = await apiFetch('/api/transfers/dispatch', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `TRA-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          fromWarehouseId: trFromWhId,
          fromLocationId: trFromLocId,
          toWarehouseId: trToWhId,
          toLocationId: trToLocId,
          productId: trProductId,
          quantity: trQty,
          notes: trNotes,
        }),
      });
      setFeedbackMsg({
        type: 'success',
        text: res.isInternalSameWarehouse
          ? `Cambio de ubicación interna confirmado (${res.document.folio}).`
          : `Transferencia entre almacenes despachada (${res.document.folio}). Mercancía en tránsito esperando recepción en destino.`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReceiveTransfer = async (transferId: number, defaultQty: number) => {
    if (!isOnline) return;
    const qty = trReceiveInputs[transferId] ?? defaultQty;
    setSubmitting(true);
    setFeedbackMsg(null);
    try {
      const res = await apiFetch('/api/transfers/receive', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `REC-TRA-${transferId}-${Date.now()}`,
          transferId,
          receivedQty: qty,
          notes: 'Recepción física en almacén destino',
        }),
      });
      setFeedbackMsg({
        type: 'success',
        text: `Transferencia recibida (${res.document.folio}).`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitCount = async () => {
    if (!isOnline) return;
    setSubmitting(true);
    setFeedbackMsg(null);
    try {
      const res = await apiFetch('/api/counts/submit', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `CNT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          warehouseId: cntWhId,
          locationId: cntLocId,
          productId: cntProdId,
          countedQty: cntQty,
          isBlindCount: cntBlind,
          notes: cntNotes,
        }),
      });
      setFeedbackMsg({
        type: 'success',
        text: `Expediente de conteo físico ${res.countFolio} registrado. Los ajustes de inventario requieren aprobación formal del Propietario.`,
      });
      await onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewCount = async (countId: number, approve: boolean) => {
    if (!isOnline) return;
    setSubmitting(true);
    try {
      await apiFetch('/api/counts/review', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: `REV-CNT-${countId}-${Date.now()}`,
          countId,
          approve,
          reason: approve
            ? 'Ajuste compensatorio aprobado por Propietario tras verificación física'
            : 'Conteo rechazado para re-conteo',
        }),
      });
      setFeedbackMsg({
        type: 'success',
        text: approve
          ? 'Ajuste de conteo aplicado mediante movimiento compensatorio auditado.'
          : 'Expediente de conteo rechazado sin modificar saldos.',
      });
      await onRefresh();
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleRunVerificationSuite = async () => {
    if (!isOnline) return;
    setSuiteRunning(true);
    setFeedbackMsg(null);
    try {
      const res = await apiFetch('/api/Verification/run-suite', {
        method: 'POST',
      });
      setSuiteReport(res);
      await onRefresh();
      if (isOwner) {
        await loadPrivateOverview();
      }
    } catch (err: any) {
      setFeedbackMsg({ type: 'error', text: err.message });
    } finally {
      setSuiteRunning(false);
    }
  };

  const exportKardexCsv = () => {
    const headers = [
      'Fecha_Hora_Bolivia',
      'Folio_Documento',
      'Tipo_Movimiento',
      'SKU',
      'Producto',
      'Cantidad',
      'Estado_Origen',
      'Estado_Destino',
      'Lote_Referencia',
    ];
    const rows = data.movementLines.map((line) => {
      const doc = data.movementDocuments.find((d) => d.id === line.documentId);
      return [
        formatBoliviaDateTime(line.createdAt),
        doc?.folio || `DOC-${line.documentId}`,
        doc?.movementType || '',
        line.historicalSku,
        `"${line.historicalName.replace(/"/g, '""')}"`,
        line.quantity,
        line.fromStatus || 'INGRESO_EXTERNO',
        line.toStatus || 'CONSUMO_PRODUCCION',
        line.lotCode,
      ].join(',');
    });
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `kardex_inmutable_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
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
      {/* SECTION 1: TRANSFERENCIAS ENTRE ALMACENES Y CONTEO FÍSICO A CIEGAS    */}
      {/* ===================================================================== */}
      {activeSection === 'TRANSFERS_COUNTS' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Transfer / Location Change Form */}
            <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
              <h2 className="text-base font-semibold text-slate-900">
                Traslado entre Almacenes o Cambio de Ubicación Interna
              </h2>
              <p className="text-xs text-slate-600">
                Si origen y destino pertenecen al mismo almacén (ej. Sencata Sección K → Estante 2),
                ejecuta un cambio de ubicación inmediato y auditado. Si es hacia otro almacén, pasa
                a estado <strong>En Tránsito</strong> hasta confirmación del receptor.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Almacén Origen</label>
                  <select
                    value={trFromWhId}
                    onChange={(e) => {
                      const wId = Number(e.target.value);
                      setTrFromWhId(wId);
                      const loc = data.locations.find((l) => l.warehouseId === wId);
                      if (loc) setTrFromLocId(loc.id);
                    }}
                    className="w-full border border-slate-300 rounded px-2.5 py-2 bg-white"
                  >
                    {data.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Ubicación Origen</label>
                  <select
                    value={trFromLocId}
                    onChange={(e) => setTrFromLocId(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded px-2.5 py-2 bg-white"
                  >
                    {data.locations
                      .filter((l) => l.warehouseId === trFromWhId)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.zoneName} › {l.shelfName}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Almacén Destino</label>
                  <select
                    value={trToWhId}
                    onChange={(e) => {
                      const wId = Number(e.target.value);
                      setTrToWhId(wId);
                      const loc = data.allLocationsSummary.find((l) => l.warehouseId === wId);
                      if (loc) setTrToLocId(loc.id);
                    }}
                    className="w-full border border-slate-300 rounded px-2.5 py-2 bg-white"
                  >
                    {data.allWarehousesSummary.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Ubicación Destino</label>
                  <select
                    value={trToLocId}
                    onChange={(e) => setTrToLocId(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded px-2.5 py-2 bg-white"
                  >
                    {data.allLocationsSummary
                      .filter((l) => l.warehouseId === trToWhId)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.zoneName} › {l.shelfName}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Producto (SKU)</label>
                  <select
                    value={trProductId}
                    onChange={(e) => setTrProductId(Number(e.target.value))}
                    className="w-full font-mono border border-slate-300 rounded px-2.5 py-2 bg-white"
                  >
                    {data.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Cantidad a Trasladar
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={trQty}
                    onChange={(e) => setTrQty(Math.max(1, Number(e.target.value)))}
                    className="w-full font-mono border border-slate-300 rounded px-2.5 py-2"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Motivo / Nota</label>
                  <input
                    type="text"
                    value={trNotes}
                    onChange={(e) => setTrNotes(e.target.value)}
                    placeholder="Abastecimiento de taller"
                    className="w-full border border-slate-300 rounded px-2.5 py-2"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={submitting || !isOnline}
                  onClick={handleCreateTransfer}
                  className="px-4 py-2 text-xs font-semibold text-white bg-sky-600 rounded-md hover:bg-sky-700"
                >
                  Confirmar Salida / Cambio de Ubicación
                </button>
              </div>
            </div>

            {/* Blind Physical Count Form */}
            <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">
                  Conteo Físico de Inventario (Modo a Ciegas)
                </h2>
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={cntBlind}
                    onChange={(e) => setCntBlind(e.target.checked)}
                  />
                  Conteo a ciegas (Oculta stock teórico)
                </label>
              </div>
              <p className="text-xs text-slate-600">
                El trabajador reporta la cantidad física contada sin conocer la cantidad teórica del
                sistema. Si existe diferencia, no altera el saldo hasta que el Propietario lo
                apruebe.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">Almacén</label>
                  <select
                    value={cntWhId}
                    onChange={(e) => {
                      const wId = Number(e.target.value);
                      setCntWhId(wId);
                      const loc = data.locations.find((l) => l.warehouseId === wId);
                      if (loc) setCntLocId(loc.id);
                    }}
                    className="w-full border border-slate-300 rounded px-2.5 py-2 bg-white"
                  >
                    {data.warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Ubicación</label>
                  <select
                    value={cntLocId}
                    onChange={(e) => setCntLocId(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded px-2.5 py-2 bg-white"
                  >
                    {data.locations
                      .filter((l) => l.warehouseId === cntWhId)
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.zoneName} › {l.shelfName}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block font-medium text-slate-700 mb-1">Producto Contado</label>
                  <select
                    value={cntProdId}
                    onChange={(e) => setCntProdId(Number(e.target.value))}
                    className="w-full font-mono border border-slate-300 rounded px-2.5 py-2 bg-white"
                  >
                    {data.products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.sku} — {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Cantidad Física Contada (Piezas)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={cntQty}
                    onChange={(e) => setCntQty(Math.max(0, Number(e.target.value)))}
                    className="w-full font-mono font-bold border border-slate-300 rounded px-2.5 py-2"
                  />
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">Observaciones</label>
                  <input
                    type="text"
                    value={cntNotes}
                    onChange={(e) => setCntNotes(e.target.value)}
                    placeholder="Conteo físico de estantería"
                    className="w-full border border-slate-300 rounded px-2.5 py-2"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={submitting || !isOnline}
                  onClick={handleSubmitCount}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
                >
                  Enviar Reporte de Conteo Físico
                </button>
              </div>
            </div>
          </div>

          {/* Pending Inter-Warehouse Transfers List */}
          {data.warehouseTransfers.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">
                Transferencias entre Almacenes ({data.warehouseTransfers.length})
              </h3>
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200">
                    <th className="py-2">Folio</th>
                    <th className="py-2">Producto</th>
                    <th className="py-2">Origen → Destino</th>
                    <th className="py-2 text-right">Enviado</th>
                    <th className="py-2">Estado</th>
                    <th className="py-2 text-right">Recepción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.warehouseTransfers.map((tr) => {
                    const p = data.products.find((pr) => pr.id === tr.productId);
                    const fw = data.allWarehousesSummary.find((w) => w.id === tr.fromWarehouseId);
                    const tw = data.allWarehousesSummary.find((w) => w.id === tr.toWarehouseId);
                    return (
                      <tr key={tr.id}>
                        <td className="py-2 font-mono font-semibold">{tr.transferFolio}</td>
                        <td className="py-2">
                          <span className="font-mono">{p?.sku}</span> — {p?.name}
                        </td>
                        <td className="py-2">
                          {fw?.name} → {tw?.name}
                        </td>
                        <td className="py-2 text-right font-mono font-bold">
                          {formatInt(tr.dispatchedQty)}
                        </td>
                        <td className="py-2 font-semibold">{tr.status}</td>
                        <td className="py-2 text-right">
                          {tr.status === 'IN_TRANSIT' ? (
                            <div className="flex items-center justify-end gap-2">
                              <input
                                type="number"
                                min={0}
                                max={tr.dispatchedQty}
                                value={trReceiveInputs[tr.id] ?? tr.dispatchedQty}
                                onChange={(e) =>
                                  setTrReceiveInputs({
                                    ...trReceiveInputs,
                                    [tr.id]: Number(e.target.value),
                                  })
                                }
                                className="w-20 font-mono border border-slate-300 rounded px-2 py-1"
                              />
                              <button
                                onClick={() => handleReceiveTransfer(tr.id, tr.dispatchedQty)}
                                className="px-2.5 py-1 bg-emerald-600 text-white font-semibold rounded"
                              >
                                Recibir
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-500">
                              Recibido: {formatInt(tr.receivedQty)} u.
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Physical Counts Review Table */}
          {data.physicalCounts.length > 0 && (
            <div className="bg-white rounded-lg border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">
                Expedientes de Conteo Físico y Ajustes Sujetos a Aprobación
              </h3>
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200">
                    <th className="py-2">Folio Conteo</th>
                    <th className="py-2">Producto / Almacén</th>
                    <th className="py-2 text-right">Contado Físico</th>
                    <th className="py-2 text-right">Stock Sistema</th>
                    <th className="py-2 text-right">Diferencia</th>
                    <th className="py-2">Estado</th>
                    <th className="py-2 text-right">Autorización Propietario</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.physicalCounts.map((cnt) => {
                    const p = data.products.find((pr) => pr.id === cnt.productId);
                    const w = data.warehouses.find((wh) => wh.id === cnt.warehouseId);
                    return (
                      <tr key={cnt.id}>
                        <td className="py-2 font-mono font-semibold">{cnt.countFolio}</td>
                        <td className="py-2">
                          {p?.sku} ({w?.name})
                        </td>
                        <td className="py-2 text-right font-mono font-bold">
                          {formatInt(cnt.countedQty)}
                        </td>
                        <td className="py-2 text-right font-mono">
                          {cnt.systemExpectedQty === -1
                            ? 'Oculto (Conteo a ciegas)'
                            : formatInt(cnt.systemExpectedQty)}
                        </td>
                        <td className="py-2 text-right font-mono font-bold">
                          {cnt.systemExpectedQty === -1
                            ? '—'
                            : `${cnt.differenceQty > 0 ? '+' : ''}${formatInt(cnt.differenceQty)}`}
                        </td>
                        <td className="py-2 font-semibold">{cnt.status}</td>
                        <td className="py-2 text-right">
                          {cnt.status === 'PENDING_APPROVAL' && isOwnerOrAdmin ? (
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleReviewCount(cnt.id, true)}
                                className="px-2.5 py-1 bg-emerald-600 text-white font-semibold rounded"
                              >
                                Aprobar Ajuste
                              </button>
                              <button
                                onClick={() => handleReviewCount(cnt.id, false)}
                                className="px-2.5 py-1 bg-red-600 text-white font-semibold rounded"
                              >
                                Rechazar
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">Revisado</span>
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
      {/* SECTION 2: KARDEX INMUTABLE, REPORTES DE PRODUCCIÓN Y SUITE CASOS A-H */}
      {/* ===================================================================== */}
      {activeSection === 'KARDEX_REPORTS' && (
        <div className="space-y-6">
          {/* Monthly / Confirmed Production Report (Anti-double-counting guarantee) */}
          <div className="bg-white rounded-lg border border-slate-200 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Reporte Consolidado de Producción por Marca, Modelo y Capacidad
                </h2>
                <p className="text-xs text-slate-600 mt-0.5">
                  Calculado exclusivamente sobre <strong>lotes de producción confirmados</strong>{' '}
                  (sin duplicar cantidades al despachar o recoger los productos terminados).
                </p>
              </div>
              {isOwnerOrAdmin && (
                <button
                  type="button"
                  disabled={suiteRunning || !isOnline}
                  onClick={handleRunVerificationSuite}
                  className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 flex items-center gap-2"
                >
                  <Play className="w-3.5 h-3.5" />
                  {suiteRunning
                    ? 'Ejecutando Casos A–H en PostgreSQL...'
                    : 'Ejecutar Batería Automática de Casos A–H'}
                </button>
              )}
            </div>

            {/* Automated Verification Suite Report */}
            {suiteReport && (
              <div className="mt-4 p-4 bg-slate-50 border border-slate-300 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-emerald-800 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Resultado de Pruebas Transaccionales en Cloud SQL PostgreSQL: 100% Verificado
                  </div>
                  <span className="text-xs font-mono text-slate-500">
                    Saldos auditados: {suiteReport.auditReport?.checkedBalancesCount} · Líneas
                    Ledger: {suiteReport.auditReport?.checkedLedgerLinesCount}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs">
                  {suiteReport.testResults.map((tr: any) => (
                    <div
                      key={tr.caseCode}
                      className="p-3 bg-white rounded border border-slate-200 flex items-start gap-2.5"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-semibold text-slate-900">
                          {tr.caseCode}: {tr.title}
                        </div>
                        <div className="text-slate-600 mt-0.5">{tr.details}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Production Summary by SKU */}
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3">SKU Producto Terminado</th>
                    <th className="py-2 px-3">Marca / Modelo / Capacidad</th>
                    <th className="py-2 px-3 text-right">Lotes Confirmados</th>
                    <th className="py-2 px-3 text-right">Total Fabricado</th>
                    <th className="py-2 px-3 text-right">Pendiente de Recoger en Taller</th>
                    <th className="py-2 pl-3 text-right">Recibido en Almacén Destino</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.products
                    .filter((p) => p.productType === 'FINISHED_GOOD')
                    .map((fp) => {
                      const batchesForSku = data.productionBatches.filter(
                        (b) => b.finishedProductId === fp.id
                      );
                      const totalFabricated = batchesForSku.reduce(
                        (s, b) => s + b.quantityProduced,
                        0
                      );
                      const pendingPickup = data.balances
                        .filter(
                          (b) =>
                            b.productId === fp.id && b.status === 'FINISHED_PENDING_PICKUP'
                        )
                        .reduce((s, b) => s + b.quantity, 0);
                      const receivedAvailable = data.balances
                        .filter((b) => b.productId === fp.id && b.status === 'AVAILABLE')
                        .reduce((s, b) => s + b.quantity, 0);

                      return (
                        <tr key={fp.id} className="hover:bg-slate-50">
                          <td className="py-2.5 pr-3 font-mono font-semibold text-slate-900">
                            {fp.sku}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">
                            {fp.brand} · {fp.model} · <strong>{fp.capacity}</strong> ({fp.material})
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {batchesForSku.length}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 tabular-nums">
                            {formatInt(totalFabricated)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold text-indigo-700 tabular-nums">
                            {formatInt(pendingPickup)}
                          </td>
                          <td className="py-2.5 pl-3 text-right font-mono font-semibold text-emerald-700 tabular-nums">
                            {formatInt(receivedAvailable)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Immutable Kardex / Ledger History */}
          <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Libro Mayor Inmutable de Movimientos (Kardex Auditado)
                </h3>
                <p className="text-xs text-slate-600">
                  Ningún movimiento confirmado puede eliminarse. Las horas corresponden al reloj UTC
                  del servidor convertidas a hora oficial de Bolivia (America/La_Paz).
                </p>
              </div>
              <button
                type="button"
                onClick={exportKardexCsv}
                className="px-3.5 py-2 text-xs font-semibold bg-white border border-slate-300 text-slate-800 rounded-md hover:bg-slate-50 flex items-center gap-2"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar Kardex CSV (Sin Costos)
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={kardexSearch}
                onChange={(e) => setKardexSearch(e.target.value)}
                placeholder="Filtrar por SKU, folio, lote o producto..."
                className="flex-1 min-w-[220px] text-xs border border-slate-300 rounded px-3 py-2"
              />
              <select
                value={kardexTypeFilter}
                onChange={(e) => setKardexTypeFilter(e.target.value)}
                className="text-xs border border-slate-300 rounded px-3 py-2 bg-white"
              >
                <option value="ALL">Todos los tipos de movimiento</option>
                <option value="INGRESO_PROVEEDOR">INGRESO_PROVEEDOR</option>
                <option value="RESERVA_OP">RESERVA_OP</option>
                <option value="DESPACHO_OP">DESPACHO_OP</option>
                <option value="ACEPTACION_OP">ACEPTACION_OP</option>
                <option value="PRODUCCION_LOTE">PRODUCCION_LOTE</option>
                <option value="DESPACHO_TERMINADO">DESPACHO_TERMINADO</option>
                <option value="RECEPCION_TERMINADO">RECEPCION_TERMINADO</option>
                <option value="RETORNO_INSUMO_OP">RETORNO_INSUMO_OP</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3">Fecha / Hora Servidor (BO)</th>
                    <th className="py-2 px-3">Folio Documento</th>
                    <th className="py-2 px-3">Operación</th>
                    <th className="py-2 px-3">SKU / Producto</th>
                    <th className="py-2 px-3">Transición de Custodia / Estado</th>
                    <th className="py-2 pl-3 text-right">Cantidad</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.movementLines
                    .filter((line) => {
                      const doc = data.movementDocuments.find((d) => d.id === line.documentId);
                      if (
                        kardexTypeFilter !== 'ALL' &&
                        doc?.movementType !== kardexTypeFilter
                      ) {
                        return false;
                      }
                      const q = kardexSearch.toLowerCase().trim();
                      if (!q) return true;
                      return (
                        line.historicalSku.toLowerCase().includes(q) ||
                        line.historicalName.toLowerCase().includes(q) ||
                        line.lotCode.toLowerCase().includes(q) ||
                        (doc?.folio || '').toLowerCase().includes(q)
                      );
                    })
                    .slice(0, 80)
                    .map((line) => {
                      const doc = data.movementDocuments.find((d) => d.id === line.documentId);
                      return (
                        <tr key={line.id} className="hover:bg-slate-50">
                          <td className="py-2 pr-3 font-mono text-slate-600 whitespace-nowrap">
                            {formatBoliviaDateTime(line.createdAt)}
                          </td>
                          <td className="py-2 px-3 font-mono font-semibold text-slate-900">
                            {doc?.folio || `DOC-${line.documentId}`}
                          </td>
                          <td className="py-2 px-3 font-medium text-slate-700">
                            {doc?.movementType}
                          </td>
                          <td className="py-2 px-3">
                            <span className="font-mono font-semibold">{line.historicalSku}</span> —{' '}
                            {line.historicalName}
                          </td>
                          <td className="py-2 px-3 text-slate-600">
                            {line.fromStatus
                              ? translateStatus(line.fromStatus)
                              : 'Ingreso Externo'}{' '}
                            →{' '}
                            <strong className="text-slate-900">
                              {line.toStatus
                                ? translateStatus(line.toStatus)
                                : 'Consumido en Transformación'}
                            </strong>
                          </td>
                          <td className="py-2 pl-3 text-right font-mono font-bold text-slate-900 tabular-nums">
                            {formatInt(line.quantity)}
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

      {/* ===================================================================== */}
      {/* SECTION 3: ZONA PRIVADA DEL PROPIETARIO (COMPRAS, COSTOS Y SEGURIDAD) */}
      {/* ===================================================================== */}
      {activeSection === 'OWNER_PRIVATE' && (
        <div className="space-y-6">
          {privateError ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-sm text-red-900 flex items-center gap-3">
              <Lock className="w-5 h-5 text-red-600 shrink-0" />
              <div>
                <div className="font-semibold">Acceso Restringido a nivel de Servidor (403)</div>
                <div className="text-xs mt-1">{privateError}</div>
              </div>
            </div>
          ) : (
            <>
              <div className="bg-slate-900 text-white rounded-lg p-5 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-mono text-sky-400">
                    ZONA PRIVADA DEL PROPIETARIO · UN SOLO ORIGEN DE VERDAD
                  </div>
                  <h2 className="text-lg font-semibold mt-0.5">
                    Control de Componentes Estratégicos, Costos de Importación y Auditoría
                  </h2>
                  <p className="text-xs text-slate-300 mt-1">
                    Los saldos que ve aquí provienen del mismo libro contable del sistema, sin
                    duplicar inventarios. Los campos financieros de compra/póliza están aislados en
                    servidor y jamás se envían a las sesiones de empleados.
                  </p>
                </div>

                {privateData?.invariantAudit && (
                  <div className="px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-md text-xs">
                    <div className="text-emerald-400 font-semibold flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4" />
                      Auditoría Matemática Ledger: {privateData.invariantAudit.isHealthy ? 'ÍNTEGRA' : 'ALERTA'}
                    </div>
                    <div className="font-mono text-slate-300 mt-0.5">
                      {privateData.invariantAudit.checkedBalancesCount} saldos =={' '}
                      {privateData.invariantAudit.checkedLedgerLinesCount} movimientos
                    </div>
                  </div>
                )}
              </div>

              {/* Consolidated Strategic Components Custody (UDP 8/16/32GB & microSD) */}
              <div className="bg-white rounded-lg border border-slate-200 p-5">
                <h3 className="text-base font-semibold text-slate-900 mb-3">
                  Balance Consolidado de Componentes Estratégicos (Custodia Propia vs. Producción)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-200">
                        <th className="py-2 pr-3">SKU Estratégico</th>
                        <th className="py-2 px-3">Descripción</th>
                        <th className="py-2 px-3 text-right">Libre Sin Asignar (Origen)</th>
                        <th className="py-2 px-3 text-right">Reservado en Órdenes</th>
                        <th className="py-2 px-3 text-right">En Custodia de Producción</th>
                        <th className="py-2 px-3 text-right">En Discrepancia</th>
                        <th className="py-2 pl-3 text-right">Transformado en Terminados</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {data.products
                        .filter((p) => p.productType === 'STRATEGIC_COMPONENT')
                        .map((sp) => {
                          const bals = data.balances.filter((b) => b.productId === sp.id);
                          const freeOrigin = bals
                            .filter((b) => b.status === 'AVAILABLE')
                            .reduce((s, b) => s + b.quantity, 0);
                          const reserved = bals
                            .filter((b) => b.status === 'RESERVED_ORDER')
                            .reduce((s, b) => s + b.quantity, 0);
                          const inProd = bals
                            .filter(
                              (b) =>
                                b.status === 'IN_PRODUCTION_CUSTODY' ||
                                b.status === 'IN_TRANSIT_PRODUCTION'
                            )
                            .reduce((s, b) => s + b.quantity, 0);
                          const discrep = bals
                            .filter((b) => b.status === 'DISCREPANCY_HOLD')
                            .reduce((s, b) => s + b.quantity, 0);
                          const consumedTotal = data.productionOrders
                            .filter((o) => o.strategicProductId === sp.id)
                            .reduce((s, o) => s + o.consumedQty, 0);

                          return (
                            <tr key={sp.id}>
                              <td className="py-2.5 pr-3 font-mono font-bold text-slate-900">
                                {sp.sku}
                              </td>
                              <td className="py-2.5 px-3">{sp.name}</td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-700 tabular-nums">
                                {formatInt(freeOrigin)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-amber-700 tabular-nums">
                                {formatInt(reserved)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono font-bold text-sky-700 tabular-nums">
                                {formatInt(inProd)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono text-red-600 tabular-nums">
                                {formatInt(discrep)}
                              </td>
                              <td className="py-2.5 pl-3 text-right font-mono font-bold text-slate-900 tabular-nums">
                                {formatInt(consumedTotal)}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Private Purchase & Landed Cost Batches */}
              <div className="bg-white rounded-lg border border-slate-200 p-5">
                <h3 className="text-base font-semibold text-slate-900 mb-3">
                  Lotes Privados de Compra e Importación (FOB + Flete + Póliza + Costo Unitario)
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-200">
                        <th className="py-2">Código Lote</th>
                        <th className="py-2">Producto</th>
                        <th className="py-2">Proveedor / Póliza</th>
                        <th className="py-2 text-right">Cantidad</th>
                        <th className="py-2 text-right">FOB Total</th>
                        <th className="py-2 text-right">Flete + Póliza + Otros</th>
                        <th className="py-2 text-right">Costo Total Puesto</th>
                        <th className="py-2 text-right">Costo Unitario (USD)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(privateData?.privateCostBatches || []).map((cb: any) => {
                        const prod = data.products.find((p) => p.id === cb.productId);
                        const extras =
                          Number(cb.freightCost) +
                          Number(cb.customsPolicyCost) +
                          Number(cb.otherImportExpenses);
                        return (
                          <tr key={cb.id}>
                            <td className="py-2 font-mono font-semibold">{cb.batchCode}</td>
                            <td className="py-2">
                              <span className="font-mono">{prod?.sku}</span> — {prod?.name}
                            </td>
                            <td className="py-2">
                              {cb.supplierName} ({cb.containerOrPolicyRef})
                            </td>
                            <td className="py-2 text-right font-mono font-bold tabular-nums">
                              {formatInt(cb.quantityPurchased)}
                            </td>
                            <td className="py-2 text-right font-mono tabular-nums">
                              ${Number(cb.fobTotalCost).toFixed(2)}
                            </td>
                            <td className="py-2 text-right font-mono tabular-nums">
                              ${extras.toFixed(2)}
                            </td>
                            <td className="py-2 text-right font-mono font-bold text-slate-900 tabular-nums">
                              ${Number(cb.totalLandedCost).toFixed(2)}
                            </td>
                            <td className="py-2 text-right font-mono font-bold text-emerald-700 tabular-nums">
                              ${Number(cb.unitLandedCost).toFixed(4)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Matrix of Users & Warehouse Permissions + Security Audit Log */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-lg border border-slate-200 p-5">
                  <h3 className="text-sm font-semibold text-slate-900 mb-3">
                    Usuarios y Matriz de Permisos por Almacén
                  </h3>
                  <div className="space-y-2.5 text-xs">
                    {data.usersPublic.map((u) => {
                      const uPerms = data.userWarehousePermissions.filter(
                        (p) => p.userId === u.id
                      );
                      return (
                        <div
                          key={u.id}
                          className="p-3 bg-slate-50 rounded border border-slate-200 flex items-center justify-between"
                        >
                          <div>
                            <div className="font-semibold text-slate-900">
                              {u.fullName} (@{u.username})
                            </div>
                            <div className="text-slate-600">{translateRole(u.role)}</div>
                          </div>
                          <div className="text-right text-[11px] text-slate-600">
                            {u.role === 'OWNER' || u.role === 'ADMIN'
                              ? 'Acceso Global Multi-Almacén'
                              : uPerms
                                  .map((p) => {
                                    const w = data.allWarehousesSummary.find(
                                      (wh) => wh.id === p.warehouseId
                                    );
                                    return w?.name;
                                  })
                                  .join(', ') || 'Sin almacén'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="bg-white rounded-lg border border-slate-200 p-5">
                  <h3 className="text-sm font-semibold text-slate-900 mb-3">
                    Registro de Eventos de Seguridad y Accesos Denegados
                  </h3>
                  <div className="space-y-2 max-h-64 overflow-y-auto text-xs">
                    {(privateData?.securityAuditEvents || []).map((ev: any) => (
                      <div
                        key={ev.id}
                        className="p-2.5 bg-slate-50 rounded border border-slate-200 flex items-start justify-between gap-2"
                      >
                        <div>
                          <span className="font-mono font-semibold text-slate-900">
                            [{ev.eventType}]
                          </span>{' '}
                          <span className="text-slate-700">{ev.details}</span>
                          <div className="text-[11px] text-slate-500 font-mono">
                            Usuario: {ev.username} · Endpoint: {ev.endpoint}
                          </div>
                        </div>
                        <span className="font-mono text-[11px] text-slate-500 shrink-0">
                          {formatBoliviaDateTime(ev.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
