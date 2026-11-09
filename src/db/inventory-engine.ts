import { db } from './index.ts';
import {
  products,
  warehouses,
  warehouseLocations,
  inventoryBalances,
  inventoryMovementDocuments,
  inventoryMovementLines,
  productionOrders,
  productionDispatches,
  productionBatches,
  finishedGoodsDispatches,
  warehouseTransfers,
  physicalCounts,
  privatePurchaseBatches,
  recipes,
  recipeVersions,
  recipeComponents,
  idempotencyKeys,
} from './schema.ts';
import { eq, and } from 'drizzle-orm';

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function runInTx<T>(
  externalTx: DbTx | undefined,
  fn: (tx: DbTx) => Promise<T>
): Promise<T> {
  if (externalTx) {
    return await fn(externalTx);
  }
  return await db.transaction(fn);
}

export interface LedgerTransition {
  productId: number;
  quantity: number;
  from?: {
    warehouseId: number;
    locationId: number;
    status: string;
    orderId?: number;
  };
  to?: {
    warehouseId: number;
    locationId: number;
    status: string;
    orderId?: number;
  };
  lotCode?: string;
  targetOrderIdForAudit?: number;
}

export interface TransitionSnapshot {
  productId: number;
  sku: string;
  name: string;
  quantity: number;
  fromWarehouseId: number | null;
  fromLocationId: number | null;
  fromStatus: string | null;
  fromStockBefore: number | null;
  fromStockAfter: number | null;
  toWarehouseId: number | null;
  toLocationId: number | null;
  toStatus: string | null;
  toStockBefore: number | null;
  toStockAfter: number | null;
}

function generateFolio(prefix: string): string {
  const now = new Date();
  const ymd =
    now.getUTCFullYear().toString().slice(-2) +
    String(now.getUTCMonth() + 1).padStart(2, '0') +
    String(now.getUTCDate()).padStart(2, '0');
  const rand = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${ymd}-${rand}`;
}

export function normalizeProductKey(
  brand: string,
  model: string,
  capacity: string,
  color: string,
  material = ''
): string {
  return [brand, model, capacity, color, material]
    .map((s) =>
      (s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
    )
    .join('_');
}

/**
 * Core atomic balance modifier using PostgreSQL transaction client.
 * Locks rows via SELECT ... FOR UPDATE to guarantee zero race conditions or negative stock.
 * Records exact before/after stock snapshots on every immutable movement line.
 */
async function applyTransitionsInTx(
  tx: DbTx,
  documentId: number,
  transitions: LedgerTransition[]
): Promise<TransitionSnapshot[]> {
  const snapshots: TransitionSnapshot[] = [];

  for (const t of transitions) {
    if (!Number.isInteger(t.quantity) || t.quantity <= 0) {
      throw new Error(
        `Cantidad inválida (${t.quantity}). Solo se permiten números enteros positivos mayores a cero.`
      );
    }

    const prodRows = await tx
      .select()
      .from(products)
      .where(eq(products.id, t.productId));
    const prod = prodRows[0];
    if (!prod) {
      throw new Error(`Producto ID ${t.productId} no existe en el catálogo maestro.`);
    }

    let fromStockBefore: number | null = null;
    let fromStockAfter: number | null = null;
    let toStockBefore: number | null = null;
    let toStockAfter: number | null = null;

    // 1. If there is a source, lock and deduct
    if (t.from) {
      const fromOrderId = t.from.orderId ?? 0;
      const existingFrom = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.productId, t.productId),
            eq(inventoryBalances.warehouseId, t.from.warehouseId),
            eq(inventoryBalances.locationId, t.from.locationId),
            eq(inventoryBalances.status, t.from.status),
            eq(inventoryBalances.productionOrderId, fromOrderId)
          )
        )
        .for('update');

      const currentBalance = existingFrom[0];
      const availableQty = currentBalance ? currentBalance.quantity : 0;

      if (!currentBalance || availableQty < t.quantity) {
        throw new Error(
          `Stock insuficiente para ${prod.sku} (${prod.name}). Disponible actual: ${availableQty}, Cantidad solicitada: ${t.quantity}.`
        );
      }

      fromStockBefore = availableQty;
      fromStockAfter = availableQty - t.quantity;

      await tx
        .update(inventoryBalances)
        .set({
          quantity: fromStockAfter,
          updatedAt: new Date(),
        })
        .where(eq(inventoryBalances.id, currentBalance.id));
    }

    // 2. If there is a destination, lock and add
    if (t.to) {
      const toOrderId = t.to.orderId ?? 0;
      const existingTo = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.productId, t.productId),
            eq(inventoryBalances.warehouseId, t.to.warehouseId),
            eq(inventoryBalances.locationId, t.to.locationId),
            eq(inventoryBalances.status, t.to.status),
            eq(inventoryBalances.productionOrderId, toOrderId)
          )
        )
        .for('update');

      if (existingTo[0]) {
        toStockBefore = existingTo[0].quantity;
        toStockAfter = toStockBefore + t.quantity;
        await tx
          .update(inventoryBalances)
          .set({
            quantity: toStockAfter,
            updatedAt: new Date(),
          })
          .where(eq(inventoryBalances.id, existingTo[0].id));
      } else {
        toStockBefore = 0;
        toStockAfter = t.quantity;
        await tx.insert(inventoryBalances).values({
          productId: t.productId,
          warehouseId: t.to.warehouseId,
          locationId: t.to.locationId,
          status: t.to.status,
          productionOrderId: toOrderId,
          quantity: t.quantity,
          updatedAt: new Date(),
        });
      }
    }

    // 3. Append immutable ledger line with before/after stock snapshots
    await tx.insert(inventoryMovementLines).values({
      documentId,
      productId: prod.id,
      historicalSku: prod.sku,
      historicalName: prod.name,
      quantity: t.quantity,
      fromWarehouseId: t.from?.warehouseId ?? null,
      fromLocationId: t.from?.locationId ?? null,
      fromStatus: t.from?.status ?? null,
      fromOrderId: t.from?.orderId ?? 0,
      fromStockBefore,
      fromStockAfter,
      toWarehouseId: t.to?.warehouseId ?? null,
      toLocationId: t.to?.locationId ?? null,
      toStatus: t.to?.status ?? null,
      toOrderId: t.to?.orderId ?? t.targetOrderIdForAudit ?? 0,
      toStockBefore,
      toStockAfter,
      lotCode: t.lotCode ?? '',
    });

    snapshots.push({
      productId: prod.id,
      sku: prod.sku,
      name: prod.name,
      quantity: t.quantity,
      fromWarehouseId: t.from?.warehouseId ?? null,
      fromLocationId: t.from?.locationId ?? null,
      fromStatus: t.from?.status ?? null,
      fromStockBefore,
      fromStockAfter,
      toWarehouseId: t.to?.warehouseId ?? null,
      toLocationId: t.to?.locationId ?? null,
      toStatus: t.to?.status ?? null,
      toStockBefore,
      toStockAfter,
    });
  }

  return snapshots;
}

/**
 * Checks idempotency key inside transaction. If already processed, returns cached response.
 */
async function checkIdempotencyInTx(
  tx: DbTx,
  idempotencyKey: string
): Promise<any | null> {
  if (!idempotencyKey || idempotencyKey.trim() === '') {
    throw new Error(
      'Se requiere clave única de solicitud (Idempotency-Key) para confirmar la operación.'
    );
  }
  const existing = await tx
    .select()
    .from(idempotencyKeys)
    .where(eq(idempotencyKeys.key, idempotencyKey));
  if (existing[0]) {
    return existing[0].responsePayload as any;
  }
  return null;
}

async function saveIdempotencyInTx<T>(
  tx: DbTx,
  idempotencyKey: string,
  userId: number,
  operationType: string,
  payload: T
) {
  await tx.insert(idempotencyKeys).values({
    key: idempotencyKey,
    userId,
    operationType,
    responsePayload: payload as object,
  });
}

/**
 * 1. INGRESAR STOCK (Goods Receipt / Return of Unused Supplies / Authorized Regularization)
 */
export async function registerGoodsReceipt(params: {
  idempotencyKey: string;
  userId: number;
  movementType:
    | 'INGRESO_PROVEEDOR'
    | 'DEVOLUCION_INSUMOS'
    | 'REGULARIZACION_AUTORIZADA'
    | 'APERTURA_INICIAL';
  warehouseId: number;
  locationId: number;
  supplierOrContainer: string;
  reason?: string;
  notes: string;
  lines: {
    productId: number;
    quantity: number;
    lotCode?: string;
    privateCost?: {
      fobTotalCost: number;
      freightCost: number;
      customsPolicyCost: number;
      otherImportExpenses: number;
      currency?: string;
      privateNotes?: string;
    };
  }[];
  externalTx?: DbTx;
}) {
  try {
    return await runInTx(params.externalTx, async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      if (!params.lines || params.lines.length === 0) {
        throw new Error('El ingreso debe incluir al menos una línea de producto.');
      }

      const prefix =
        params.movementType === 'APERTURA_INICIAL'
          ? 'APE'
          : params.movementType === 'DEVOLUCION_INSUMOS'
          ? 'DEV'
          : params.movementType === 'REGULARIZACION_AUTORIZADA'
          ? 'REG'
          : 'ING';
      const folio = generateFolio(prefix);

      const defaultReason =
        params.movementType === 'APERTURA_INICIAL'
          ? 'Apertura inicial auditada'
          : params.movementType === 'DEVOLUCION_INSUMOS'
          ? 'Devolución de insumos no utilizados'
          : params.movementType === 'REGULARIZACION_AUTORIZADA'
          ? 'Regularización autorizada de inventario'
          : 'Recepción de mercancía / proveedor';

      const [doc] = await tx
        .insert(inventoryMovementDocuments)
        .values({
          folio,
          movementType: params.movementType,
          status: 'CONFIRMED',
          destWarehouseId: params.warehouseId,
          destLocationId: params.locationId,
          supplierOrContainer: params.supplierOrContainer || 'Ingreso Directo',
          reason: params.reason || defaultReason,
          notes: params.notes || '',
          createdByUserId: params.userId,
          confirmedByUserId: params.userId,
          idempotencyKey: params.idempotencyKey,
        })
        .returning();

      const transitions: LedgerTransition[] = params.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        to: {
          warehouseId: params.warehouseId,
          locationId: params.locationId,
          status: 'AVAILABLE',
          orderId: 0,
        },
        lotCode: line.lotCode || folio,
      }));

      const snapshots = await applyTransitionsInTx(tx, doc.id, transitions);

      // Record optional private cost batches if provided by Owner
      for (const line of params.lines) {
        if (line.privateCost) {
          const fob = Number(line.privateCost.fobTotalCost || 0);
          const freight = Number(line.privateCost.freightCost || 0);
          const customs = Number(line.privateCost.customsPolicyCost || 0);
          const other = Number(line.privateCost.otherImportExpenses || 0);
          const totalLanded = fob + freight + customs + other;
          const unitLanded = line.quantity > 0 ? totalLanded / line.quantity : 0;

          await tx.insert(privatePurchaseBatches).values({
            batchCode: `${folio}-P${line.productId}`,
            movementDocumentId: doc.id,
            productId: line.productId,
            supplierName: params.supplierOrContainer || 'Importación Directa',
            containerOrPolicyRef: line.lotCode || folio,
            quantityPurchased: line.quantity,
            currency: line.privateCost.currency || 'USD',
            fobTotalCost: fob.toFixed(4),
            freightCost: freight.toFixed(4),
            customsPolicyCost: customs.toFixed(4),
            otherImportExpenses: other.toFixed(4),
            totalLandedCost: totalLanded.toFixed(4),
            unitLandedCost: unitLanded.toFixed(6),
            privateNotes: line.privateCost.privateNotes || '',
            createdByUserId: params.userId,
          });
        }
      }

      const firstSnap = snapshots[0];
      const result = {
        document: doc,
        folio: doc.folio,
        serverTimestamp: doc.serverTimestamp,
        linesProcessed: params.lines.length,
        snapshots,
        stockBefore: firstSnap?.toStockBefore ?? 0,
        quantityAdded: firstSnap?.quantity ?? 0,
        stockAfter: firstSnap?.toStockAfter ?? 0,
      };

      await saveIdempotencyInTx(
        tx,
        params.idempotencyKey,
        params.userId,
        params.movementType,
        result
      );
      return result;
    });
  } catch (error: any) {
    console.error('Error in registerGoodsReceipt:', error);
    throw new Error(error.message || 'No se pudo procesar el documento de ingreso.', {
      cause: error,
    });
  }
}

/**
 * 1B. RETIRAR STOCK (Fast & Audited Withdrawal of Supplies, Packaging, Cases, Adapters, etc.)
 * CRITICAL ACCOUNTING RULE:
 * - Deducts immediately from AVAILABLE stock in the selected warehouse/location.
 * - When withdrawalMode === 'ORDEN_PRODUCCION', binds the withdrawal to `productionOrderId`
 *   so that subsequent production registration references these withdrawn supplies WITHOUT
 *   ever deducting them a second time.
 */
export async function withdrawInventoryStock(params: {
  idempotencyKey: string;
  userId: number;
  warehouseId: number;
  locationId: number;
  productId: number;
  quantity: number;
  withdrawalMode: 'ORDEN_PRODUCCION' | 'CONSUMO_OPERATIVO' | 'MERMA_DANO';
  productionOrderId?: number;
  recipientOrTarget?: string;
  reason: string;
  notes?: string;
  externalTx?: DbTx;
}) {
  try {
    return await runInTx(params.externalTx, async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
        throw new Error('La cantidad a retirar debe ser un número entero positivo mayor a cero.');
      }

      let linkedOrderId: number | null = null;
      let orderNumberLabel = '';

      if (params.withdrawalMode === 'ORDEN_PRODUCCION') {
        if (!params.productionOrderId) {
          throw new Error(
            'Debe seleccionar una Orden de Producción activa para retirar insumos destinados a producción.'
          );
        }
        const orders = await tx
          .select()
          .from(productionOrders)
          .where(eq(productionOrders.id, params.productionOrderId));
        const order = orders[0];
        if (!order) {
          throw new Error('La Orden de Producción seleccionada no existe.');
        }
        if (order.status === 'CLOSED' || order.status === 'CANCELLED') {
          throw new Error(
            `La orden ${order.orderNumber} está cerrada o cancelada y no admite nuevos retiros de insumos.`
          );
        }
        linkedOrderId = order.id;
        orderNumberLabel = order.orderNumber;
      } else {
        if (!params.reason || params.reason.trim().length < 3) {
          throw new Error('Debe ingresar un motivo o justificación válida para el retiro.');
        }
      }

      const movementType =
        params.withdrawalMode === 'ORDEN_PRODUCCION'
          ? 'RETIRO_PRODUCCION'
          : params.withdrawalMode === 'MERMA_DANO'
          ? 'RETIRO_MERMA'
          : 'RETIRO_OPERATIVO';

      const prefix =
        params.withdrawalMode === 'ORDEN_PRODUCCION'
          ? 'RET-OP'
          : params.withdrawalMode === 'MERMA_DANO'
          ? 'MER'
          : 'RET';

      const folio = generateFolio(prefix);

      const computedReason =
        params.withdrawalMode === 'ORDEN_PRODUCCION'
          ? `Retiro de insumos para Orden ${orderNumberLabel}${
              params.reason ? `: ${params.reason}` : ''
            }`
          : params.reason.trim();

      const [doc] = await tx
        .insert(inventoryMovementDocuments)
        .values({
          folio,
          movementType,
          status: 'CONFIRMED',
          sourceWarehouseId: params.warehouseId,
          sourceLocationId: params.locationId,
          productionOrderId: linkedOrderId,
          recipientOrTarget:
            params.recipientOrTarget?.trim() ||
            (orderNumberLabel ? `Orden ${orderNumberLabel}` : 'Uso Operativo'),
          reason: computedReason,
          notes: params.notes || '',
          createdByUserId: params.userId,
          confirmedByUserId: params.userId,
          idempotencyKey: params.idempotencyKey,
        })
        .returning();

      const snapshots = await applyTransitionsInTx(tx, doc.id, [
        {
          productId: params.productId,
          quantity: params.quantity,
          from: {
            warehouseId: params.warehouseId,
            locationId: params.locationId,
            status: 'AVAILABLE',
            orderId: 0,
          },
          targetOrderIdForAudit: linkedOrderId ?? 0,
          lotCode: orderNumberLabel || folio,
        },
      ]);

      const snap = snapshots[0];
      const result = {
        document: doc,
        folio: doc.folio,
        serverTimestamp: doc.serverTimestamp,
        movementType,
        productionOrderId: linkedOrderId,
        orderNumber: orderNumberLabel || null,
        stockBefore: snap?.fromStockBefore ?? 0,
        quantityWithdrawn: params.quantity,
        stockAfter: snap?.fromStockAfter ?? 0,
        snapshot: snap,
      };

      await saveIdempotencyInTx(tx, params.idempotencyKey, params.userId, movementType, result);
      return result;
    });
  } catch (error: any) {
    console.error('Error in withdrawInventoryStock:', error);
    throw new Error(error.message || 'No se pudo procesar el retiro de inventario.', {
      cause: error,
    });
  }
}

/**
 * 2. Create Production Order & Deliver/Reserve Strategic Components
 * Supports `autoDispatch: true` (default) so that creating the order immediately
 * moves the strategic components (UDP / microSD) from origin AVAILABLE -> IN_TRANSIT_PRODUCTION
 * (or RESERVED_ORDER if autoDispatch is false), ready for the operator to accept delivery.
 */
export async function createProductionOrderWithReservation(params: {
  idempotencyKey: string;
  userId: number;
  sourceWarehouseId: number;
  sourceLocationId: number;
  targetWarehouseId: number;
  targetLocationId: number;
  assignedUserId: number;
  strategicProductId: number;
  authorizedQty: number;
  allowedRecipeIds?: number[];
  priority?: string;
  instructions?: string;
  autoDispatch?: boolean;
  externalTx?: DbTx;
}) {
  try {
    return await runInTx(params.externalTx, async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      if (!Number.isInteger(params.authorizedQty) || params.authorizedQty <= 0) {
        throw new Error('La cantidad autorizada debe ser un número entero positivo.');
      }

      const shouldAutoDispatch = params.autoDispatch !== false;
      const orderNumber = generateFolio('OP');
      const docFolio = generateFolio(shouldAutoDispatch ? 'DESP-OP' : 'RES');

      const [order] = await tx
        .insert(productionOrders)
        .values({
          orderNumber,
          status: shouldAutoDispatch ? 'DISPATCHED' : 'RESERVED',
          sourceWarehouseId: params.sourceWarehouseId,
          sourceLocationId: params.sourceLocationId,
          targetWarehouseId: params.targetWarehouseId,
          targetLocationId: params.targetLocationId,
          assignedUserId: params.assignedUserId,
          strategicProductId: params.strategicProductId,
          authorizedQty: params.authorizedQty,
          reservedQty: shouldAutoDispatch ? 0 : params.authorizedQty,
          dispatchedQty: shouldAutoDispatch ? params.authorizedQty : 0,
          allowedRecipeIds: params.allowedRecipeIds || [],
          priority: params.priority || 'NORMAL',
          instructions: params.instructions || '',
          createdByUserId: params.userId,
        })
        .returning();

      const [doc] = await tx
        .insert(inventoryMovementDocuments)
        .values({
          folio: docFolio,
          movementType: shouldAutoDispatch ? 'DESPACHO_OP' : 'RESERVA_OP',
          status: 'CONFIRMED',
          sourceWarehouseId: params.sourceWarehouseId,
          sourceLocationId: params.sourceLocationId,
          destWarehouseId: shouldAutoDispatch
            ? params.targetWarehouseId
            : params.sourceWarehouseId,
          destLocationId: shouldAutoDispatch
            ? params.targetLocationId
            : params.sourceLocationId,
          productionOrderId: order.id,
          reason: shouldAutoDispatch
            ? `Apertura y envío de componente estratégico a producción (${orderNumber})`
            : `Reserva lógica para Orden de Producción ${orderNumber}`,
          notes: params.instructions || '',
          createdByUserId: params.userId,
          confirmedByUserId: params.userId,
          idempotencyKey: params.idempotencyKey,
        })
        .returning();

      const snapshots = await applyTransitionsInTx(tx, doc.id, [
        {
          productId: params.strategicProductId,
          quantity: params.authorizedQty,
          from: {
            warehouseId: params.sourceWarehouseId,
            locationId: params.sourceLocationId,
            status: 'AVAILABLE',
            orderId: 0,
          },
          to: shouldAutoDispatch
            ? {
                warehouseId: params.targetWarehouseId,
                locationId: params.targetLocationId,
                status: 'IN_TRANSIT_PRODUCTION',
                orderId: order.id,
              }
            : {
                warehouseId: params.sourceWarehouseId,
                locationId: params.sourceLocationId,
                status: 'RESERVED_ORDER',
                orderId: order.id,
              },
          lotCode: orderNumber,
        },
      ]);

      let dispatchRow = null;
      if (shouldAutoDispatch) {
        const [disp] = await tx
          .insert(productionDispatches)
          .values({
            dispatchFolio: docFolio,
            productionOrderId: order.id,
            productId: params.strategicProductId,
            dispatchedQty: params.authorizedQty,
            status: 'IN_TRANSIT',
            dispatchedByUserId: params.userId,
          })
          .returning();
        dispatchRow = disp;
      }

      const result = {
        order,
        reservationDocument: doc,
        dispatch: dispatchRow,
        snapshots,
      };
      await saveIdempotencyInTx(
        tx,
        params.idempotencyKey,
        params.userId,
        shouldAutoDispatch ? 'DESPACHO_OP' : 'RESERVA_OP',
        result
      );
      return result;
    });
  } catch (error: any) {
    console.error('Error in createProductionOrderWithReservation:', error);
    throw new Error(error.message || 'No se pudo crear la orden de producción.', {
      cause: error,
    });
  }
}

/**
 * 3. Dispatch Strategic Components from Origin Warehouse to Production (Partial or Full)
 * Moves from RESERVED_ORDER (in origin) -> IN_TRANSIT_PRODUCTION (at target warehouse).
 */
export async function dispatchProductionOrderComponents(params: {
  idempotencyKey: string;
  userId: number;
  productionOrderId: number;
  dispatchQty: number;
  notes?: string;
  externalTx?: DbTx;
}) {
  try {
    return await runInTx(params.externalTx, async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      const orders = await tx
        .select()
        .from(productionOrders)
        .where(eq(productionOrders.id, params.productionOrderId))
        .for('update');
      const order = orders[0];
      if (!order) throw new Error('Orden de producción no encontrada.');

      if (!Number.isInteger(params.dispatchQty) || params.dispatchQty <= 0) {
        throw new Error('La cantidad a despachar debe ser un entero positivo.');
      }

      if (params.dispatchQty > order.reservedQty) {
        throw new Error(
          `No puede despachar ${params.dispatchQty} unidades; solo quedan ${order.reservedQty} reservadas pendientes de despacho en la orden ${order.orderNumber}.`
        );
      }

      const dispatchFolio = generateFolio('DESP-OP');

      const [doc] = await tx
        .insert(inventoryMovementDocuments)
        .values({
          folio: dispatchFolio,
          movementType: 'DESPACHO_OP',
          status: 'CONFIRMED',
          sourceWarehouseId: order.sourceWarehouseId,
          sourceLocationId: order.sourceLocationId,
          destWarehouseId: order.targetWarehouseId,
          destLocationId: order.targetLocationId,
          productionOrderId: order.id,
          reason: `Despacho de componentes clave hacia producción (${order.orderNumber})`,
          notes: params.notes || '',
          createdByUserId: params.userId,
          confirmedByUserId: params.userId,
          idempotencyKey: params.idempotencyKey,
        })
        .returning();

      await applyTransitionsInTx(tx, doc.id, [
        {
          productId: order.strategicProductId,
          quantity: params.dispatchQty,
          from: {
            warehouseId: order.sourceWarehouseId,
            locationId: order.sourceLocationId,
            status: 'RESERVED_ORDER',
            orderId: order.id,
          },
          to: {
            warehouseId: order.targetWarehouseId,
            locationId: order.targetLocationId,
            status: 'IN_TRANSIT_PRODUCTION',
            orderId: order.id,
          },
          lotCode: order.orderNumber,
        },
      ]);

      const [dispatchRow] = await tx
        .insert(productionDispatches)
        .values({
          dispatchFolio,
          productionOrderId: order.id,
          productId: order.strategicProductId,
          dispatchedQty: params.dispatchQty,
          status: 'IN_TRANSIT',
          dispatchedByUserId: params.userId,
        })
        .returning();

      const [updatedOrder] = await tx
        .update(productionOrders)
        .set({
          reservedQty: order.reservedQty - params.dispatchQty,
          dispatchedQty: order.dispatchedQty + params.dispatchQty,
          status: order.status === 'RESERVED' ? 'DISPATCHED' : order.status,
        })
        .where(eq(productionOrders.id, order.id))
        .returning();

      const result = { dispatch: dispatchRow, order: updatedOrder, document: doc };
      await saveIdempotencyInTx(tx, params.idempotencyKey, params.userId, 'DESPACHO_OP', result);
      return result;
    });
  } catch (error: any) {
    console.error('Error in dispatchProductionOrderComponents:', error);
    throw new Error(error.message || 'Error al despachar componentes a producción.', {
      cause: error,
    });
  }
}

/**
 * 4. Accept Dispatched Components in Production (Supports Physical Discrepancy e.g. 1,980 of 2,000)
 * Received units move from IN_TRANSIT_PRODUCTION -> IN_PRODUCTION_CUSTODY.
 * Any missing difference moves from IN_TRANSIT_PRODUCTION -> DISCREPANCY_HOLD.
 */
export async function acknowledgeProductionDispatch(params: {
  idempotencyKey: string;
  userId: number;
  dispatchId: number;
  receivedQty: number;
  notes?: string;
  externalTx?: DbTx;
}) {
  try {
    return await runInTx(params.externalTx, async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      const dispatches = await tx
        .select()
        .from(productionDispatches)
        .where(eq(productionDispatches.id, params.dispatchId))
        .for('update');
      const dispatchRow = dispatches[0];
      if (!dispatchRow) throw new Error('Despacho de producción no encontrado.');
      if (dispatchRow.status !== 'IN_TRANSIT') {
        throw new Error('Este despacho ya fue recibido y procesado anteriormente.');
      }

      if (
        !Number.isInteger(params.receivedQty) ||
        params.receivedQty < 0 ||
        params.receivedQty > dispatchRow.dispatchedQty
      ) {
        throw new Error(
          `La cantidad recibida (${params.receivedQty}) debe estar entre 0 y la cantidad enviada (${dispatchRow.dispatchedQty}).`
        );
      }

      const orders = await tx
        .select()
        .from(productionOrders)
        .where(eq(productionOrders.id, dispatchRow.productionOrderId))
        .for('update');
      const order = orders[0];
      if (!order) throw new Error('Orden de producción asociada no encontrada.');

      const discrepancyQty = dispatchRow.dispatchedQty - params.receivedQty;
      const ackFolio = generateFolio('ACEP-OP');

      const [doc] = await tx
        .insert(inventoryMovementDocuments)
        .values({
          folio: ackFolio,
          movementType: 'ACEPTACION_OP',
          status: 'CONFIRMED',
          sourceWarehouseId: order.targetWarehouseId,
          sourceLocationId: order.targetLocationId,
          destWarehouseId: order.targetWarehouseId,
          destLocationId: order.targetLocationId,
          productionOrderId: order.id,
          reason:
            discrepancyQty > 0
              ? `Aceptación con diferencia física de ${discrepancyQty} unidades en ${dispatchRow.dispatchFolio}`
              : `Aceptación conforme de componentes en producción (${dispatchRow.dispatchFolio})`,
          notes: params.notes || '',
          createdByUserId: params.userId,
          confirmedByUserId: params.userId,
          idempotencyKey: params.idempotencyKey,
        })
        .returning();

      const transitions: LedgerTransition[] = [];
      if (params.receivedQty > 0) {
        transitions.push({
          productId: dispatchRow.productId,
          quantity: params.receivedQty,
          from: {
            warehouseId: order.targetWarehouseId,
            locationId: order.targetLocationId,
            status: 'IN_TRANSIT_PRODUCTION',
            orderId: order.id,
          },
          to: {
            warehouseId: order.targetWarehouseId,
            locationId: order.targetLocationId,
            status: 'IN_PRODUCTION_CUSTODY',
            orderId: order.id,
          },
          lotCode: order.orderNumber,
        });
      }

      if (discrepancyQty > 0) {
        transitions.push({
          productId: dispatchRow.productId,
          quantity: discrepancyQty,
          from: {
            warehouseId: order.targetWarehouseId,
            locationId: order.targetLocationId,
            status: 'IN_TRANSIT_PRODUCTION',
            orderId: order.id,
          },
          to: {
            warehouseId: order.targetWarehouseId,
            locationId: order.targetLocationId,
            status: 'DISCREPANCY_HOLD',
            orderId: order.id,
          },
          lotCode: order.orderNumber,
        });
      }

      const snapshots = await applyTransitionsInTx(tx, doc.id, transitions);

      const [updatedDispatch] = await tx
        .update(productionDispatches)
        .set({
          receivedQty: params.receivedQty,
          discrepancyQty,
          discrepancyNotes: params.notes || '',
          discrepancyResolved: discrepancyQty === 0,
          status: discrepancyQty > 0 ? 'ACCEPTED_WITH_DISCREPANCY' : 'ACCEPTED',
          receivedByUserId: params.userId,
          receivedAt: new Date(),
        })
        .where(eq(productionDispatches.id, dispatchRow.id))
        .returning();

      const [updatedOrder] = await tx
        .update(productionOrders)
        .set({
          receivedInProductionQty: order.receivedInProductionQty + params.receivedQty,
          discrepancyQty: order.discrepancyQty + discrepancyQty,
          status: 'IN_PRODUCTION',
        })
        .where(eq(productionOrders.id, order.id))
        .returning();

      const result = {
        dispatch: updatedDispatch,
        order: updatedOrder,
        document: doc,
        snapshots,
      };
      await saveIdempotencyInTx(tx, params.idempotencyKey, params.userId, 'ACEPTACION_OP', result);
      return result;
    });
  } catch (error: any) {
    console.error('Error in acknowledgeProductionDispatch:', error);
    throw new Error(error.message || 'No se pudo confirmar la recepción en producción.', {
      cause: error,
    });
  }
}

/**
 * 5. Register Real Production Batch(es) WITHOUT Recipes (v2.0 Architecture)
 * - Supports producing 1 or multiple finished product models/brands in a single atomic transaction
 *   (e.g., 1,000 USB HP 8 GB + 1,500 USB Sony 8 GB + 1,000 USB Samsung 8 GB = 3,500 finished units).
 * - Consumes the declared `strategicQtyConsumed` (default 1:1 with `quantityProduced`) from
 *   `IN_PRODUCTION_CUSTODY` of the order's strategic product (UDP / microSD).
 * - Creates the finished goods in `FINISHED_PENDING_PICKUP` bound to the order.
 * - Links/references any secondary supplies already withdrawn for this order via `usedWithdrawalFolios`
 *   WITHOUT ever deducting secondary supplies a second time!
 */
export async function registerProductionBatches(params: {
  idempotencyKey: string;
  userId: number;
  productionOrderId: number;
  items: {
    finishedProductId: number;
    quantityProduced: number;
    strategicQtyConsumed?: number;
    usedWithdrawalFolios?: string[];
    notes?: string;
  }[];
  externalTx?: DbTx;
}) {
  try {
    return await runInTx(params.externalTx, async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      if (!params.items || params.items.length === 0) {
        throw new Error('Debe especificar al menos un producto terminado fabricado.');
      }

      const orders = await tx
        .select()
        .from(productionOrders)
        .where(eq(productionOrders.id, params.productionOrderId))
        .for('update');
      const order = orders[0];
      if (!order) throw new Error('Orden de producción no encontrada.');
      if (order.status === 'CLOSED' || order.status === 'CANCELLED') {
        throw new Error(
          `La orden ${order.orderNumber} está cerrada o anulada y no admite nuevos registros de producción.`
        );
      }

      const pendingCustodyBalance =
        order.receivedInProductionQty - order.consumedQty - order.returnedQty - order.wasteQty;

      const docFolio = generateFolio('PROD');
      const [doc] = await tx
        .insert(inventoryMovementDocuments)
        .values({
          folio: docFolio,
          movementType: 'PRODUCCION_LOTE',
          status: 'CONFIRMED',
          sourceWarehouseId: order.targetWarehouseId,
          sourceLocationId: order.targetLocationId,
          destWarehouseId: order.targetWarehouseId,
          destLocationId: order.targetLocationId,
          productionOrderId: order.id,
          reason: `Registro de producción terminada en orden ${order.orderNumber}`,
          notes: params.items
            .map((i) => i.notes || '')
            .filter(Boolean)
            .join('; '),
          createdByUserId: params.userId,
          confirmedByUserId: params.userId,
          idempotencyKey: params.idempotencyKey,
        })
        .returning();

      let totalStrategicConsumed = 0;
      let totalFinishedProduced = 0;
      const transitions: LedgerTransition[] = [];
      const createdBatches = [];

      for (const item of params.items) {
        const qtyProd = Number(item.quantityProduced);
        if (!Number.isInteger(qtyProd) || qtyProd <= 0) {
          throw new Error('La cantidad producida debe ser un número entero positivo.');
        }

        const stratConsumed =
          item.strategicQtyConsumed !== undefined
            ? Number(item.strategicQtyConsumed)
            : qtyProd;

        if (!Number.isInteger(stratConsumed) || stratConsumed <= 0) {
          throw new Error(
            'La cantidad de componente estratégico consumido debe ser un número entero positivo.'
          );
        }

        const finProdRows = await tx
          .select()
          .from(products)
          .where(eq(products.id, Number(item.finishedProductId)));
        const finProd = finProdRows[0];
        if (!finProd) {
          throw new Error(
            `El producto terminado seleccionado (ID ${item.finishedProductId}) no existe en el catálogo.`
          );
        }

        totalStrategicConsumed += stratConsumed;
        totalFinishedProduced += qtyProd;

        // 1. Deduct strategic component (UDP / microSD) from IN_PRODUCTION_CUSTODY of this order
        transitions.push({
          productId: order.strategicProductId,
          quantity: stratConsumed,
          from: {
            warehouseId: order.targetWarehouseId,
            locationId: order.targetLocationId,
            status: 'IN_PRODUCTION_CUSTODY',
            orderId: order.id,
          },
          lotCode: order.orderNumber,
        });

        // 2. Create finished product in FINISHED_PENDING_PICKUP bound to this order
        transitions.push({
          productId: finProd.id,
          quantity: qtyProd,
          to: {
            warehouseId: order.targetWarehouseId,
            locationId: order.targetLocationId,
            status: 'FINISHED_PENDING_PICKUP',
            orderId: order.id,
          },
          lotCode: docFolio,
        });

        const batchFolio = generateFolio('LOTE');
        const usedFoliosStr = Array.isArray(item.usedWithdrawalFolios)
          ? item.usedWithdrawalFolios.join(', ')
          : '';

        const [batch] = await tx
          .insert(productionBatches)
          .values({
            batchFolio,
            productionOrderId: order.id,
            recipeId: null,
            recipeVersionId: null,
            finishedProductId: finProd.id,
            warehouseId: order.targetWarehouseId,
            locationId: order.targetLocationId,
            quantityProduced: qtyProd,
            strategicQtyConsumed: stratConsumed,
            quantityPickedUp: 0,
            usedWithdrawalFolios: usedFoliosStr,
            movementDocumentId: doc.id,
            operatorUserId: params.userId,
            notes: item.notes || '',
          })
          .returning();

        createdBatches.push(batch);
      }

      if (totalStrategicConsumed > pendingCustodyBalance) {
        throw new Error(
          `Intento de sobreconsumo en orden ${order.orderNumber}: se requieren ${totalStrategicConsumed} unidades del componente estratégico en custodia, pero solo hay ${pendingCustodyBalance} unidades disponibles en esta orden.`
        );
      }

      // Execute all balance locks, deductions, and creations atomically
      const snapshots = await applyTransitionsInTx(tx, doc.id, transitions);

      const newConsumed = order.consumedQty + totalStrategicConsumed;
      const remainingAfter =
        order.receivedInProductionQty - newConsumed - order.returnedQty - order.wasteQty;

      const [updatedOrder] = await tx
        .update(productionOrders)
        .set({
          consumedQty: newConsumed,
          status:
            remainingAfter === 0 && order.reservedQty === 0
              ? 'COMPLETED_PENDING_PICKUP'
              : 'PARTIALLY_COMPLETED',
        })
        .where(eq(productionOrders.id, order.id))
        .returning();

      const result = {
        document: doc,
        folio: doc.folio,
        serverTimestamp: doc.serverTimestamp,
        batches: createdBatches,
        order: updatedOrder,
        totalStrategicConsumed,
        totalFinishedProduced,
        remainingCustodyQty: remainingAfter,
        snapshots,
      };

      await saveIdempotencyInTx(
        tx,
        params.idempotencyKey,
        params.userId,
        'PRODUCCION_LOTE',
        result
      );
      return result;
    });
  } catch (error: any) {
    console.error('Error in registerProductionBatches:', error);
    throw new Error(error.message || 'Fallo en el registro atómico de producción.', {
      cause: error,
    });
  }
}

/**
 * 6. Return Unused Strategic Components from Production to Origin Warehouse OR Report Approved Waste
 */
export async function returnOrWasteOrderComponents(params: {
  idempotencyKey: string;
  userId: number;
  productionOrderId: number;
  operationType: 'RETURN_TO_ORIGIN' | 'REPORT_WASTE';
  quantity: number;
  reason: string;
  externalTx?: DbTx;
}) {
  try {
    return await runInTx(params.externalTx, async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
        throw new Error('La cantidad debe ser un entero positivo.');
      }
      if (!params.reason || params.reason.trim().length < 3) {
        throw new Error('Debe especificar un motivo claro para la devolución o merma.');
      }

      const orders = await tx
        .select()
        .from(productionOrders)
        .where(eq(productionOrders.id, params.productionOrderId))
        .for('update');
      const order = orders[0];
      if (!order) throw new Error('Orden de producción no encontrada.');

      const pendingCustody =
        order.receivedInProductionQty - order.consumedQty - order.returnedQty - order.wasteQty;
      if (params.quantity > pendingCustody) {
        throw new Error(
          `La cantidad (${params.quantity}) excede el saldo en custodia de producción (${pendingCustody}).`
        );
      }

      const isReturn = params.operationType === 'RETURN_TO_ORIGIN';
      const folio = generateFolio(isReturn ? 'DEV-OP' : 'MER-OP');

      const [doc] = await tx
        .insert(inventoryMovementDocuments)
        .values({
          folio,
          movementType: isReturn ? 'RETORNO_INSUMO_OP' : 'MERMA_OP',
          status: 'CONFIRMED',
          sourceWarehouseId: order.targetWarehouseId,
          sourceLocationId: order.targetLocationId,
          destWarehouseId: isReturn ? order.sourceWarehouseId : order.targetWarehouseId,
          destLocationId: isReturn ? order.sourceLocationId : order.targetLocationId,
          productionOrderId: order.id,
          reason: params.reason,
          notes: `Orden ${order.orderNumber}`,
          createdByUserId: params.userId,
          confirmedByUserId: params.userId,
          idempotencyKey: params.idempotencyKey,
        })
        .returning();

      const snapshots = await applyTransitionsInTx(tx, doc.id, [
        {
          productId: order.strategicProductId,
          quantity: params.quantity,
          from: {
            warehouseId: order.targetWarehouseId,
            locationId: order.targetLocationId,
            status: 'IN_PRODUCTION_CUSTODY',
            orderId: order.id,
          },
          to: isReturn
            ? {
                warehouseId: order.sourceWarehouseId,
                locationId: order.sourceLocationId,
                status: 'AVAILABLE',
                orderId: 0,
              }
            : {
                warehouseId: order.targetWarehouseId,
                locationId: order.targetLocationId,
                status: 'DAMAGED_QUARANTINE',
                orderId: order.id,
              },
          lotCode: order.orderNumber,
        },
      ]);

      const newReturned = isReturn ? order.returnedQty + params.quantity : order.returnedQty;
      const newWaste = !isReturn ? order.wasteQty + params.quantity : order.wasteQty;
      const remainingCustody =
        order.receivedInProductionQty - order.consumedQty - newReturned - newWaste;

      const [updatedOrder] = await tx
        .update(productionOrders)
        .set({
          returnedQty: newReturned,
          wasteQty: newWaste,
          status:
            remainingCustody === 0 && order.reservedQty === 0
              ? 'COMPLETED_PENDING_PICKUP'
              : order.status,
        })
        .where(eq(productionOrders.id, order.id))
        .returning();

      const result = {
        order: updatedOrder,
        document: doc,
        folio: doc.folio,
        serverTimestamp: doc.serverTimestamp,
        snapshots,
      };
      await saveIdempotencyInTx(tx, params.idempotencyKey, params.userId, doc.movementType, result);
      return result;
    });
  } catch (error: any) {
    console.error('Error in returnOrWasteOrderComponents:', error);
    throw new Error(error.message || 'No se pudo procesar la devolución o merma.', {
      cause: error,
    });
  }
}

/**
 * 7. Dispatch & Receive Finished Goods (Partial or Total Pickup)
 * CRITICAL INVARIANT: Picking up finished goods NEVER deducts UDP, cases, adapters, or packaging again.
 * It only transfers custody of the finished SKU:
 * FINISHED_PENDING_PICKUP -> FINISHED_IN_TRANSIT -> AVAILABLE (in destination warehouse).
 * Supports `autoReceive: true` when the owner/receiver picks up and confirms reception in one step.
 */
export async function dispatchFinishedGoods(params: {
  idempotencyKey: string;
  userId: number;
  productionOrderId: number;
  finishedProductId: number;
  toWarehouseId: number;
  toLocationId: number;
  dispatchQty: number;
  autoReceive?: boolean;
  notes?: string;
  externalTx?: DbTx;
}) {
  try {
    return await runInTx(params.externalTx, async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      const orders = await tx
        .select()
        .from(productionOrders)
        .where(eq(productionOrders.id, params.productionOrderId))
        .for('update');
      const order = orders[0];
      if (!order) throw new Error('Orden de producción no encontrada.');

      const folio = generateFolio('ENT-TERM');
      const immediateReceive = Boolean(params.autoReceive);

      const [doc] = await tx
        .insert(inventoryMovementDocuments)
        .values({
          folio,
          movementType: immediateReceive ? 'RECEPCION_TERMINADO' : 'DESPACHO_TERMINADO',
          status: 'CONFIRMED',
          sourceWarehouseId: order.targetWarehouseId,
          sourceLocationId: order.targetLocationId,
          destWarehouseId: params.toWarehouseId,
          destLocationId: params.toLocationId,
          productionOrderId: order.id,
          reason: immediateReceive
            ? `Recogida y recepción confirmada de producto terminado (${order.orderNumber})`
            : `Entrega de producto terminado de orden ${order.orderNumber}`,
          notes: params.notes || '',
          createdByUserId: params.userId,
          confirmedByUserId: params.userId,
          idempotencyKey: params.idempotencyKey,
        })
        .returning();

      const snapshots = await applyTransitionsInTx(tx, doc.id, [
        {
          productId: params.finishedProductId,
          quantity: params.dispatchQty,
          from: {
            warehouseId: order.targetWarehouseId,
            locationId: order.targetLocationId,
            status: 'FINISHED_PENDING_PICKUP',
            orderId: order.id,
          },
          to: {
            warehouseId: params.toWarehouseId,
            locationId: params.toLocationId,
            status: immediateReceive ? 'AVAILABLE' : 'FINISHED_IN_TRANSIT',
            orderId: immediateReceive ? 0 : order.id,
          },
          lotCode: order.orderNumber,
        },
      ]);

      const [dispatchRow] = await tx
        .insert(finishedGoodsDispatches)
        .values({
          dispatchFolio: folio,
          productionOrderId: order.id,
          finishedProductId: params.finishedProductId,
          fromWarehouseId: order.targetWarehouseId,
          fromLocationId: order.targetLocationId,
          toWarehouseId: params.toWarehouseId,
          toLocationId: params.toLocationId,
          dispatchedQty: params.dispatchQty,
          receivedQty: immediateReceive ? params.dispatchQty : null,
          discrepancyQty: 0,
          status: immediateReceive ? 'RECEIVED' : 'IN_TRANSIT',
          dispatchedByUserId: params.userId,
          receivedByUserId: immediateReceive ? params.userId : null,
          receivedAt: immediateReceive ? new Date() : null,
          notes: params.notes || '',
        })
        .returning();

      // Update quantityPickedUp across batches of this order and product
      const batches = await tx
        .select()
        .from(productionBatches)
        .where(
          and(
            eq(productionBatches.productionOrderId, order.id),
            eq(productionBatches.finishedProductId, params.finishedProductId)
          )
        );
      let remToMark = params.dispatchQty;
      for (const b of batches) {
        if (remToMark <= 0) break;
        const canPick = b.quantityProduced - b.quantityPickedUp;
        if (canPick > 0) {
          const addPick = Math.min(canPick, remToMark);
          remToMark -= addPick;
          await tx
            .update(productionBatches)
            .set({ quantityPickedUp: b.quantityPickedUp + addPick })
            .where(eq(productionBatches.id, b.id));
        }
      }

      const result = {
        dispatch: dispatchRow,
        document: doc,
        folio: doc.folio,
        serverTimestamp: doc.serverTimestamp,
        snapshots,
      };
      await saveIdempotencyInTx(
        tx,
        params.idempotencyKey,
        params.userId,
        immediateReceive ? 'RECEPCION_TERMINADO' : 'DESPACHO_TERMINADO',
        result
      );
      return result;
    });
  } catch (error: any) {
    console.error('Error in dispatchFinishedGoods:', error);
    throw new Error(error.message || 'No se pudo despachar el producto terminado.', {
      cause: error,
    });
  }
}

export async function receiveFinishedGoods(params: {
  idempotencyKey: string;
  userId: number;
  dispatchId: number;
  receivedQty: number;
  notes?: string;
  externalTx?: DbTx;
}) {
  try {
    return await runInTx(params.externalTx, async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      const dispatches = await tx
        .select()
        .from(finishedGoodsDispatches)
        .where(eq(finishedGoodsDispatches.id, params.dispatchId))
        .for('update');
      const dispatchRow = dispatches[0];
      if (!dispatchRow) throw new Error('Despacho de producto terminado no encontrado.');
      if (dispatchRow.status !== 'IN_TRANSIT') {
        throw new Error('Esta entrega de producto terminado ya fue recibida anteriormente.');
      }

      if (
        !Number.isInteger(params.receivedQty) ||
        params.receivedQty < 0 ||
        params.receivedQty > dispatchRow.dispatchedQty
      ) {
        throw new Error(
          `Cantidad recibida (${params.receivedQty}) inválida frente a la despachada (${dispatchRow.dispatchedQty}).`
        );
      }

      const discrepancyQty = dispatchRow.dispatchedQty - params.receivedQty;
      const folio = generateFolio('REC-TERM');

      const [doc] = await tx
        .insert(inventoryMovementDocuments)
        .values({
          folio,
          movementType: 'RECEPCION_TERMINADO',
          status: 'CONFIRMED',
          sourceWarehouseId: dispatchRow.fromWarehouseId,
          sourceLocationId: dispatchRow.fromLocationId,
          destWarehouseId: dispatchRow.toWarehouseId,
          destLocationId: dispatchRow.toLocationId,
          productionOrderId: dispatchRow.productionOrderId,
          reason:
            discrepancyQty > 0
              ? `Recepción de producto terminado con diferencia de ${discrepancyQty} u.`
              : `Recepción formal de producto terminado (${dispatchRow.dispatchFolio})`,
          notes: params.notes || '',
          createdByUserId: params.userId,
          confirmedByUserId: params.userId,
          idempotencyKey: params.idempotencyKey,
        })
        .returning();

      const transitions: LedgerTransition[] = [];
      if (params.receivedQty > 0) {
        transitions.push({
          productId: dispatchRow.finishedProductId,
          quantity: params.receivedQty,
          from: {
            warehouseId: dispatchRow.toWarehouseId,
            locationId: dispatchRow.toLocationId,
            status: 'FINISHED_IN_TRANSIT',
            orderId: dispatchRow.productionOrderId,
          },
          to: {
            warehouseId: dispatchRow.toWarehouseId,
            locationId: dispatchRow.toLocationId,
            status: 'AVAILABLE',
            orderId: 0,
          },
          lotCode: dispatchRow.dispatchFolio,
        });
      }

      if (discrepancyQty > 0) {
        transitions.push({
          productId: dispatchRow.finishedProductId,
          quantity: discrepancyQty,
          from: {
            warehouseId: dispatchRow.toWarehouseId,
            locationId: dispatchRow.toLocationId,
            status: 'FINISHED_IN_TRANSIT',
            orderId: dispatchRow.productionOrderId,
          },
          to: {
            warehouseId: dispatchRow.toWarehouseId,
            locationId: dispatchRow.toLocationId,
            status: 'DISCREPANCY_HOLD',
            orderId: dispatchRow.productionOrderId,
          },
          lotCode: dispatchRow.dispatchFolio,
        });
      }

      const snapshots = await applyTransitionsInTx(tx, doc.id, transitions);

      const [updatedDispatch] = await tx
        .update(finishedGoodsDispatches)
        .set({
          receivedQty: params.receivedQty,
          discrepancyQty,
          status: discrepancyQty > 0 ? 'RECEIVED_WITH_DISCREPANCY' : 'RECEIVED',
          receivedByUserId: params.userId,
          receivedAt: new Date(),
        })
        .where(eq(finishedGoodsDispatches.id, dispatchRow.id))
        .returning();

      const result = {
        dispatch: updatedDispatch,
        document: doc,
        folio: doc.folio,
        serverTimestamp: doc.serverTimestamp,
        snapshots,
      };
      await saveIdempotencyInTx(
        tx,
        params.idempotencyKey,
        params.userId,
        'RECEPCION_TERMINADO',
        result
      );
      return result;
    });
  } catch (error: any) {
    console.error('Error in receiveFinishedGoods:', error);
    throw new Error(
      error.message || 'No se pudo confirmar la recepción de productos terminados.',
      {
        cause: error,
      }
    );
  }
}

/**
 * 8. Inter-Warehouse Transfers & Internal Location Moves
 */
export async function createOrMoveWarehouseTransfer(params: {
  idempotencyKey: string;
  userId: number;
  fromWarehouseId: number;
  fromLocationId: number;
  toWarehouseId: number;
  toLocationId: number;
  productId: number;
  quantity: number;
  notes?: string;
  externalTx?: DbTx;
}) {
  try {
    return await runInTx(params.externalTx, async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      const isInternalSameWarehouse = params.fromWarehouseId === params.toWarehouseId;
      const folio = generateFolio(isInternalSameWarehouse ? 'UBI' : 'TRA');

      const [doc] = await tx
        .insert(inventoryMovementDocuments)
        .values({
          folio,
          movementType: isInternalSameWarehouse ? 'CAMBIO_UBICACION' : 'TRANSFERENCIA_SALIDA',
          status: 'CONFIRMED',
          sourceWarehouseId: params.fromWarehouseId,
          sourceLocationId: params.fromLocationId,
          destWarehouseId: params.toWarehouseId,
          destLocationId: params.toLocationId,
          reason: isInternalSameWarehouse
            ? 'Cambio de ubicación interna dentro del mismo almacén'
            : 'Salida por transferencia entre almacenes',
          notes: params.notes || '',
          createdByUserId: params.userId,
          confirmedByUserId: params.userId,
          idempotencyKey: params.idempotencyKey,
        })
        .returning();

      const snapshots = await applyTransitionsInTx(tx, doc.id, [
        {
          productId: params.productId,
          quantity: params.quantity,
          from: {
            warehouseId: params.fromWarehouseId,
            locationId: params.fromLocationId,
            status: 'AVAILABLE',
            orderId: 0,
          },
          to: {
            warehouseId: params.toWarehouseId,
            locationId: params.toLocationId,
            status: isInternalSameWarehouse ? 'AVAILABLE' : 'IN_TRANSIT_TRANSFER',
            orderId: 0,
          },
          lotCode: folio,
        },
      ]);

      let transferRow = null;
      if (!isInternalSameWarehouse) {
        const [tr] = await tx
          .insert(warehouseTransfers)
          .values({
            transferFolio: folio,
            fromWarehouseId: params.fromWarehouseId,
            fromLocationId: params.fromLocationId,
            toWarehouseId: params.toWarehouseId,
            toLocationId: params.toLocationId,
            productId: params.productId,
            dispatchedQty: params.quantity,
            status: 'IN_TRANSIT',
            dispatchedByUserId: params.userId,
            notes: params.notes || '',
          })
          .returning();
        transferRow = tr;
      }

      const snap = snapshots[0];
      const result = {
        document: doc,
        folio: doc.folio,
        serverTimestamp: doc.serverTimestamp,
        transfer: transferRow,
        isInternalSameWarehouse,
        stockBefore: snap?.fromStockBefore ?? 0,
        quantityWithdrawn: params.quantity,
        stockAfter: snap?.fromStockAfter ?? 0,
        snapshots,
      };
      await saveIdempotencyInTx(tx, params.idempotencyKey, params.userId, doc.movementType, result);
      return result;
    });
  } catch (error: any) {
    console.error('Error in createOrMoveWarehouseTransfer:', error);
    throw new Error(error.message || 'No se pudo procesar el traslado.', { cause: error });
  }
}

export async function receiveWarehouseTransfer(params: {
  idempotencyKey: string;
  userId: number;
  transferId: number;
  receivedQty: number;
  notes?: string;
  externalTx?: DbTx;
}) {
  try {
    return await runInTx(params.externalTx, async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      const transfers = await tx
        .select()
        .from(warehouseTransfers)
        .where(eq(warehouseTransfers.id, params.transferId))
        .for('update');
      const tr = transfers[0];
      if (!tr) throw new Error('Transferencia no encontrada.');
      if (tr.status !== 'IN_TRANSIT') throw new Error('Esta transferencia ya fue recibida.');

      if (
        !Number.isInteger(params.receivedQty) ||
        params.receivedQty < 0 ||
        params.receivedQty > tr.dispatchedQty
      ) {
        throw new Error('Cantidad recibida inválida.');
      }

      const discrepancyQty = tr.dispatchedQty - params.receivedQty;
      const folio = generateFolio('REC-TRA');

      const [doc] = await tx
        .insert(inventoryMovementDocuments)
        .values({
          folio,
          movementType: 'TRANSFERENCIA_RECEPCION',
          status: 'CONFIRMED',
          sourceWarehouseId: tr.fromWarehouseId,
          sourceLocationId: tr.fromLocationId,
          destWarehouseId: tr.toWarehouseId,
          destLocationId: tr.toLocationId,
          reason: `Recepción de transferencia ${tr.transferFolio}`,
          notes: params.notes || '',
          createdByUserId: params.userId,
          confirmedByUserId: params.userId,
          idempotencyKey: params.idempotencyKey,
        })
        .returning();

      const transitions: LedgerTransition[] = [];
      if (params.receivedQty > 0) {
        transitions.push({
          productId: tr.productId,
          quantity: params.receivedQty,
          from: {
            warehouseId: tr.toWarehouseId,
            locationId: tr.toLocationId,
            status: 'IN_TRANSIT_TRANSFER',
            orderId: 0,
          },
          to: {
            warehouseId: tr.toWarehouseId,
            locationId: tr.toLocationId,
            status: 'AVAILABLE',
            orderId: 0,
          },
          lotCode: tr.transferFolio,
        });
      }
      if (discrepancyQty > 0) {
        transitions.push({
          productId: tr.productId,
          quantity: discrepancyQty,
          from: {
            warehouseId: tr.toWarehouseId,
            locationId: tr.toLocationId,
            status: 'IN_TRANSIT_TRANSFER',
            orderId: 0,
          },
          to: {
            warehouseId: tr.toWarehouseId,
            locationId: tr.toLocationId,
            status: 'DISCREPANCY_HOLD',
            orderId: 0,
          },
          lotCode: tr.transferFolio,
        });
      }

      const snapshots = await applyTransitionsInTx(tx, doc.id, transitions);

      const [updated] = await tx
        .update(warehouseTransfers)
        .set({
          receivedQty: params.receivedQty,
          discrepancyQty,
          status: discrepancyQty > 0 ? 'DISCREPANCY' : 'COMPLETED',
          receivedByUserId: params.userId,
          receivedAt: new Date(),
        })
        .where(eq(warehouseTransfers.id, tr.id))
        .returning();

      const result = { transfer: updated, document: doc, snapshots };
      await saveIdempotencyInTx(
        tx,
        params.idempotencyKey,
        params.userId,
        'TRANSFERENCIA_RECEPCION',
        result
      );
      return result;
    });
  } catch (error: any) {
    console.error('Error in receiveWarehouseTransfer:', error);
    throw new Error(error.message || 'No se pudo recibir la transferencia.', { cause: error });
  }
}

/**
 * 9. Physical Count Registration & Owner Approval Adjustment
 */
export async function submitPhysicalCount(params: {
  idempotencyKey: string;
  userId: number;
  warehouseId: number;
  locationId: number;
  productId: number;
  countedQty: number;
  isBlindCount: boolean;
  notes?: string;
}) {
  try {
    return await db.transaction(async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      if (!Number.isInteger(params.countedQty) || params.countedQty < 0) {
        throw new Error('La cantidad contada debe ser un entero mayor o igual a cero.');
      }

      const balRows = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.productId, params.productId),
            eq(inventoryBalances.warehouseId, params.warehouseId),
            eq(inventoryBalances.locationId, params.locationId),
            eq(inventoryBalances.status, 'AVAILABLE'),
            eq(inventoryBalances.productionOrderId, 0)
          )
        );
      const expectedQty = balRows[0] ? balRows[0].quantity : 0;
      const differenceQty = params.countedQty - expectedQty;
      const countFolio = generateFolio('CNT');

      const [countRow] = await tx
        .insert(physicalCounts)
        .values({
          countFolio,
          warehouseId: params.warehouseId,
          locationId: params.locationId,
          productId: params.productId,
          isBlindCount: params.isBlindCount,
          systemExpectedQty: expectedQty,
          countedQty: params.countedQty,
          differenceQty,
          status: differenceQty === 0 ? 'APPROVED_ADJUSTED' : 'PENDING_APPROVAL',
          countedByUserId: params.userId,
          notes: params.notes || '',
        })
        .returning();

      await saveIdempotencyInTx(tx, params.idempotencyKey, params.userId, 'CONTEO_FISICO', countRow);
      return countRow;
    });
  } catch (error: any) {
    console.error('Error in submitPhysicalCount:', error);
    throw new Error(error.message || 'No se pudo registrar el conteo físico.', { cause: error });
  }
}

export async function approvePhysicalCountAdjustment(params: {
  idempotencyKey: string;
  userId: number;
  countId: number;
  approve: boolean;
  reason: string;
}) {
  try {
    return await db.transaction(async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      const counts = await tx
        .select()
        .from(physicalCounts)
        .where(eq(physicalCounts.id, params.countId))
        .for('update');
      const countRow = counts[0];
      if (!countRow) throw new Error('Expediente de conteo no encontrado.');
      if (countRow.status !== 'PENDING_APPROVAL') {
        throw new Error('Este conteo ya fue revisado anteriormente.');
      }

      if (!params.approve) {
        const [rejected] = await tx
          .update(physicalCounts)
          .set({
            status: 'REJECTED',
            reviewedByUserId: params.userId,
            reviewedAt: new Date(),
            notes: `${countRow.notes} | Rechazado: ${params.reason}`,
          })
          .where(eq(physicalCounts.id, countRow.id))
          .returning();
        return { count: rejected };
      }

      const folio = generateFolio('AJU');
      const [doc] = await tx
        .insert(inventoryMovementDocuments)
        .values({
          folio,
          movementType: 'AJUSTE_CONTEO',
          status: 'CONFIRMED',
          sourceWarehouseId: countRow.warehouseId,
          sourceLocationId: countRow.locationId,
          destWarehouseId: countRow.warehouseId,
          destLocationId: countRow.locationId,
          reason: `Ajuste aprobado por conteo ${countRow.countFolio}: ${params.reason}`,
          createdByUserId: params.userId,
          confirmedByUserId: params.userId,
          idempotencyKey: params.idempotencyKey,
        })
        .returning();

      if (countRow.differenceQty > 0) {
        await applyTransitionsInTx(tx, doc.id, [
          {
            productId: countRow.productId,
            quantity: countRow.differenceQty,
            to: {
              warehouseId: countRow.warehouseId,
              locationId: countRow.locationId,
              status: 'AVAILABLE',
              orderId: 0,
            },
            lotCode: countRow.countFolio,
          },
        ]);
      } else if (countRow.differenceQty < 0) {
        await applyTransitionsInTx(tx, doc.id, [
          {
            productId: countRow.productId,
            quantity: Math.abs(countRow.differenceQty),
            from: {
              warehouseId: countRow.warehouseId,
              locationId: countRow.locationId,
              status: 'AVAILABLE',
              orderId: 0,
            },
            lotCode: countRow.countFolio,
          },
        ]);
      }

      const [approved] = await tx
        .update(physicalCounts)
        .set({
          status: 'APPROVED_ADJUSTED',
          reviewedByUserId: params.userId,
          reviewedAt: new Date(),
        })
        .where(eq(physicalCounts.id, countRow.id))
        .returning();

      const result = { count: approved, document: doc };
      await saveIdempotencyInTx(tx, params.idempotencyKey, params.userId, 'AJUSTE_CONTEO', result);
      return result;
    });
  } catch (error: any) {
    console.error('Error in approvePhysicalCountAdjustment:', error);
    throw new Error(error.message || 'No se pudo aplicar el ajuste de conteo.', { cause: error });
  }
}

/**
 * 10. Ledger vs Materialized Balance Reconciliation Auditor
 * Verifies mathematically that:
 * 1) Every row in inventory_balances matches the exact algebraic sum of inventory_movement_lines.
 * 2) No negative balances exist.
 * 3) Every Production Order satisfies the conservation of strategic components equation.
 */
export async function runAccountingInvariantAudit(externalTx?: DbTx) {
  try {
    const queryRunner = externalTx || db;
    const allBalances = await queryRunner.select().from(inventoryBalances);
    const allLines = await queryRunner.select().from(inventoryMovementLines);
    const allOrders = await queryRunner.select().from(productionOrders);

    // Reconstruct balances from immutable ledger lines
    const ledgerMap = new Map<string, number>();
    const makeKey = (pId: number, wId: number, lId: number, status: string, oId: number) =>
      `${pId}:${wId}:${lId}:${status}:${oId}`;

    for (const line of allLines) {
      if (line.fromWarehouseId && line.fromLocationId && line.fromStatus) {
        const k = makeKey(
          line.productId,
          line.fromWarehouseId,
          line.fromLocationId,
          line.fromStatus,
          line.fromOrderId
        );
        ledgerMap.set(k, (ledgerMap.get(k) || 0) - line.quantity);
      }
      if (line.toWarehouseId && line.toLocationId && line.toStatus) {
        const k = makeKey(
          line.productId,
          line.toWarehouseId,
          line.toLocationId,
          line.toStatus,
          line.toOrderId
        );
        ledgerMap.set(k, (ledgerMap.get(k) || 0) + line.quantity);
      }
    }

    const balanceDiscrepancies: {
      key: string;
      materializedQty: number;
      ledgerSumQty: number;
    }[] = [];

    for (const b of allBalances) {
      const k = makeKey(b.productId, b.warehouseId, b.locationId, b.status, b.productionOrderId);
      const ledgerQty = ledgerMap.get(k) || 0;
      if (b.quantity !== ledgerQty || b.quantity < 0) {
        balanceDiscrepancies.push({
          key: k,
          materializedQty: b.quantity,
          ledgerSumQty: ledgerQty,
        });
      }
    }

    const orderDiscrepancies: {
      orderNumber: string;
      detail: string;
    }[] = [];

    for (const o of allOrders) {
      if (o.authorizedQty !== o.reservedQty + o.dispatchedQty) {
        orderDiscrepancies.push({
          orderNumber: o.orderNumber,
          detail: `Autorizado (${o.authorizedQty}) != Reservado (${o.reservedQty}) + Despachado (${o.dispatchedQty})`,
        });
      }

      const custodyRows = allBalances.filter(
        (b) => b.productionOrderId === o.id && b.status === 'IN_PRODUCTION_CUSTODY'
      );
      const actualCustody = custodyRows.reduce((acc, r) => acc + r.quantity, 0);
      const expectedCustody =
        o.receivedInProductionQty - o.consumedQty - o.returnedQty - o.wasteQty;

      if (actualCustody !== expectedCustody) {
        orderDiscrepancies.push({
          orderNumber: o.orderNumber,
          detail: `Custodia Física (${actualCustody}) != Recibido (${o.receivedInProductionQty}) - Consumido (${o.consumedQty}) - Devuelto (${o.returnedQty}) - Merma (${o.wasteQty})`,
        });
      }
    }

    return {
      isHealthy: balanceDiscrepancies.length === 0 && orderDiscrepancies.length === 0,
      checkedBalancesCount: allBalances.length,
      checkedLedgerLinesCount: allLines.length,
      checkedOrdersCount: allOrders.length,
      balanceDiscrepancies,
      orderDiscrepancies,
      verifiedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error('Error in runAccountingInvariantAudit:', error);
    throw new Error('Error al ejecutar auditoría de invariantes contables.', { cause: error });
  }
}

class RollbackVerificationSentinel extends Error {
  report: any;
  constructor(report: any) {
    super('ROLLBACK_VERIFICATION_SENTINEL');
    this.report = report;
  }
}

/**
 * 11. Isolated Automated Verification of the v2.0 Inventory & Production Scenarios
 * Runs inside a PostgreSQL transaction that ALWAYS rolls back at the end, verifying:
 * - Ingreso de 20,000 UDP 8 GB (0 -> 20,000)
 * - Idempotency protection (duplicate request does not double-add)
 * - Negative stock protection (attempting to withdraw 25,000 when 20,000 available is rejected)
 * - Nueva Orden de Producción for 4,000 UDP 8 GB (Available: 20,000 -> 16,000, In Transit/Order: 4,000, Physical Total: 20,000)
 * - Recepción en Producción of 4,000 UDP 8 GB (In Custody: 4,000)
 * - Retiro de Insumos (3,500 Empaques/Cases) linked to OP without double deduction
 * - Registro de Producción multi-modelo SIN recetas:
 *   1,000 USB HP 8 GB + 1,500 USB Sony 8 GB + 1,000 USB Samsung 8 GB = 3,500 terminados
 *   Consuming 3,500 UDP 8 GB -> leaving 500 UDP 8 GB in custody
 * - Recogida parcial de 2,000 USB terminados -> 2,000 disponibles en almacén destino, 1,500 pendientes de recogida, 0 doble descuento
 * - Devolución de 500 UDP 8 GB sobrantes al almacén origen -> Disponible sube de 16,000 a 16,500 y custodia queda en 0.
 */
export async function runV2ScenarioVerification(userId: number) {
  try {
    await db.transaction(async (tx) => {
      const steps: { step: string; passed: boolean; details: string }[] = [];

      // Create isolated test warehouses & locations inside tx
      const [whOrigin] = await tx
        .insert(warehouses)
        .values({
          code: 'TEST-ALM-ORIG',
          name: 'Almacén Principal (Test)',
          isProductionPlant: false,
        })
        .returning();
      const [locOrigin] = await tx
        .insert(warehouseLocations)
        .values({
          warehouseId: whOrigin.id,
          code: 'TEST-LOC-ORIG',
          zoneName: 'Bodega Central',
          shelfName: 'Estante A1',
          isDefault: true,
        })
        .returning();

      const [whProd] = await tx
        .insert(warehouses)
        .values({
          code: 'TEST-ALM-PROD',
          name: 'Taller de Producción (Test)',
          isProductionPlant: true,
        })
        .returning();
      const [locProd] = await tx
        .insert(warehouseLocations)
        .values({
          warehouseId: whProd.id,
          code: 'TEST-LOC-PROD',
          zoneName: 'Área de Ensamblaje',
          shelfName: 'Mesa 1',
          isDefault: true,
        })
        .returning();

      // Create isolated test products inside tx
      const [udp8gb] = await tx
        .insert(products)
        .values({
          sku: 'TEST-UDP-8GB',
          name: 'UDP 8 GB (Componente Estratégico)',
          normalizedKey: 'test_udp_8gb',
          productType: 'STRATEGIC_COMPONENT',
          family: 'Chips UDP',
          capacity: '8 GB',
        })
        .returning();

      const [empaqueUsb] = await tx
        .insert(products)
        .values({
          sku: 'TEST-EMP-USB',
          name: 'Empaque Blíster USB',
          normalizedKey: 'test_emp_usb',
          productType: 'PACKAGING_KIT',
          family: 'Empaques',
        })
        .returning();

      const [usbHp] = await tx
        .insert(products)
        .values({
          sku: 'TEST-USB-HP-8GB',
          name: 'USB HP 8 GB Terminado',
          normalizedKey: 'test_usb_hp_8gb',
          productType: 'FINISHED_GOOD',
          family: 'Producto Terminado',
          brand: 'HP',
          capacity: '8 GB',
        })
        .returning();

      const [usbSony] = await tx
        .insert(products)
        .values({
          sku: 'TEST-USB-SONY-8GB',
          name: 'USB Sony 8 GB Terminado',
          normalizedKey: 'test_usb_sony_8gb',
          productType: 'FINISHED_GOOD',
          family: 'Producto Terminado',
          brand: 'Sony',
          capacity: '8 GB',
        })
        .returning();

      const [usbSamsung] = await tx
        .insert(products)
        .values({
          sku: 'TEST-USB-SAM-8GB',
          name: 'USB Samsung 8 GB Terminado',
          normalizedKey: 'test_usb_sam_8gb',
          productType: 'FINISHED_GOOD',
          family: 'Producto Terminado',
          brand: 'Samsung',
          capacity: '8 GB',
        })
        .returning();

      // 1. Ingresar 20,000 UDP 8 GB y 10,000 Empaques
      const ingKey = `VERIFY-ING-20000-${Date.now()}`;
      const ingRes = await registerGoodsReceipt({
        idempotencyKey: ingKey,
        userId,
        movementType: 'INGRESO_PROVEEDOR',
        warehouseId: whOrigin.id,
        locationId: locOrigin.id,
        supplierOrContainer: 'Contenedor Test',
        notes: 'Ingreso de 20,000 UDP 8 GB',
        lines: [{ productId: udp8gb.id, quantity: 20000 }],
        externalTx: tx,
      });

      await registerGoodsReceipt({
        idempotencyKey: `VERIFY-ING-EMP-${Date.now()}`,
        userId,
        movementType: 'INGRESO_PROVEEDOR',
        warehouseId: whProd.id,
        locationId: locProd.id,
        supplierOrContainer: 'Stock Taller',
        notes: 'Ingreso de 10,000 Empaques en Taller',
        lines: [{ productId: empaqueUsb.id, quantity: 10000 }],
        externalTx: tx,
      });

      steps.push({
        step: '1. Ingreso de 20,000 UDP 8 GB en Almacén Principal',
        passed: ingRes.stockBefore === 0 && ingRes.stockAfter === 20000,
        details: `Saldo anterior: ${ingRes.stockBefore} -> Ingreso: +20,000 -> Saldo resultante: ${ingRes.stockAfter} (Folio: ${ingRes.folio})`,
      });

      // 2. Idempotency test: repeat same idempotencyKey
      const replayRes = await registerGoodsReceipt({
        idempotencyKey: ingKey,
        userId,
        movementType: 'INGRESO_PROVEEDOR',
        warehouseId: whOrigin.id,
        locationId: locOrigin.id,
        supplierOrContainer: 'Contenedor Test',
        notes: 'Ingreso duplicado',
        lines: [{ productId: udp8gb.id, quantity: 20000 }],
        externalTx: tx,
      });
      steps.push({
        step: '2. Protección anti-duplicados (Idempotency-Key)',
        passed: Boolean(replayRes.idempotentReplay) && replayRes.stockAfter === 20000,
        details: `Reintento con misma clave devolvió el mismo comprobante ${replayRes.folio} sin duplicar las 20,000 unidades.`,
      });

      // 3. Negative stock rejection test using savepoint
      let rejectedOverWithdrawal = false;
      try {
        await tx.transaction(async (subTx) => {
          await withdrawInventoryStock({
            idempotencyKey: `VERIFY-OVER-${Date.now()}`,
            userId,
            warehouseId: whOrigin.id,
            locationId: locOrigin.id,
            productId: udp8gb.id,
            quantity: 25000,
            withdrawalMode: 'CONSUMO_OPERATIVO',
            reason: 'Intento de retiro mayor al disponible',
            externalTx: subTx,
          });
        });
      } catch {
        rejectedOverWithdrawal = true;
      }
      steps.push({
        step: '3. Bloqueo de retiro superior al stock disponible',
        passed: rejectedOverWithdrawal,
        details: 'Intento de retirar 25,000 UDP con 20,000 disponibles fue rechazado atómicamente.',
      });

      // 4. Crear Orden de Producción por 4,000 UDP 8 GB
      const opRes = await createProductionOrderWithReservation({
        idempotencyKey: `VERIFY-OP-4000-${Date.now()}`,
        userId,
        sourceWarehouseId: whOrigin.id,
        sourceLocationId: locOrigin.id,
        targetWarehouseId: whProd.id,
        targetLocationId: locProd.id,
        assignedUserId: userId,
        strategicProductId: udp8gb.id,
        authorizedQty: 4000,
        instructions: 'Armar lotes HP, Sony y Samsung 8 GB',
        autoDispatch: true,
        externalTx: tx,
      });

      const originBalAfterOp = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.productId, udp8gb.id),
            eq(inventoryBalances.warehouseId, whOrigin.id),
            eq(inventoryBalances.status, 'AVAILABLE')
          )
        );
      const availOriginQty = originBalAfterOp[0]?.quantity ?? 0;

      steps.push({
        step: '4. Creación de Orden de Producción por 4,000 UDP 8 GB',
        passed: availOriginQty === 16000 && opRes.order.dispatchedQty === 4000,
        details: `Disponible en Almacén Principal bajó a ${availOriginQty} u. y 4,000 u. pasaron a la orden ${opRes.order.orderNumber} (Total físico conservado: 20,000 u.).`,
      });

      // 5. Aceptar entrega de 4,000 UDP 8 GB en Producción
      const ackRes = await acknowledgeProductionDispatch({
        idempotencyKey: `VERIFY-ACK-4000-${Date.now()}`,
        userId,
        dispatchId: opRes.dispatch!.id,
        receivedQty: 4000,
        notes: 'Recibido conforme en taller',
        externalTx: tx,
      });

      steps.push({
        step: '5. Recepción de 4,000 UDP 8 GB en custodia de producción',
        passed: ackRes.order.receivedInProductionQty === 4000,
        details: `En custodia de producción para ${opRes.order.orderNumber}: ${ackRes.order.receivedInProductionQty} unidades.`,
      });

      // 6. Retirar 3,500 Empaques vinculados a la Orden de Producción (Botón Retirar)
      const withdrawRes = await withdrawInventoryStock({
        idempotencyKey: `VERIFY-RET-3500-${Date.now()}`,
        userId,
        warehouseId: whProd.id,
        locationId: locProd.id,
        productId: empaqueUsb.id,
        quantity: 3500,
        withdrawalMode: 'ORDEN_PRODUCCION',
        productionOrderId: opRes.order.id,
        recipientOrTarget: 'Lotes HP, Sony y Samsung 8 GB',
        reason: 'Retiro de blísteres para ensamblaje de orden',
        externalTx: tx,
      });

      steps.push({
        step: '6. Retiro de 3,500 Empaques mediante botón "Retirar" vinculado a la OP',
        passed: withdrawRes.stockBefore === 10000 && withdrawRes.stockAfter === 6500,
        details: `Empaques disponibles antes: ${withdrawRes.stockBefore} -> Retiro: -3,500 -> Disponibles después: ${withdrawRes.stockAfter} (Folio: ${withdrawRes.folio}).`,
      });

      // 7. Registrar Producción SIN recetas: 1,000 HP + 1,500 Sony + 1,000 Samsung = 3,500 terminados
      const batchRes = await registerProductionBatches({
        idempotencyKey: `VERIFY-PROD-3500-${Date.now()}`,
        userId,
        productionOrderId: opRes.order.id,
        items: [
          {
            finishedProductId: usbHp.id,
            quantityProduced: 1000,
            strategicQtyConsumed: 1000,
            usedWithdrawalFolios: [withdrawRes.folio],
            notes: 'Lote HP 8 GB',
          },
          {
            finishedProductId: usbSony.id,
            quantityProduced: 1500,
            strategicQtyConsumed: 1500,
            usedWithdrawalFolios: [withdrawRes.folio],
            notes: 'Lote Sony 8 GB',
          },
          {
            finishedProductId: usbSamsung.id,
            quantityProduced: 1000,
            strategicQtyConsumed: 1000,
            usedWithdrawalFolios: [withdrawRes.folio],
            notes: 'Lote Samsung 8 GB',
          },
        ],
        externalTx: tx,
      });

      // Verify empaques were NOT deducted a second time
      const empBalAfterProd = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.productId, empaqueUsb.id),
            eq(inventoryBalances.warehouseId, whProd.id),
            eq(inventoryBalances.status, 'AVAILABLE')
          )
        );
      const empAvailAfterProd = empBalAfterProd[0]?.quantity ?? 0;

      steps.push({
        step: '7. Registro de Producción multi-modelo SIN recetas (3,500 USB terminados) sin doble descuento',
        passed:
          batchRes.totalFinishedProduced === 3500 &&
          batchRes.totalStrategicConsumed === 3500 &&
          batchRes.remainingCustodyQty === 500 &&
          empAvailAfterProd === 6500,
        details: `Producidos: 3,500 USB (1,000 HP + 1,500 Sony + 1,000 Samsung). UDP consumidos: 3,500. UDP restantes en custodia: ${batchRes.remainingCustodyQty}. Empaques disponibles siguen en ${empAvailAfterProd} (0 doble descuento).`,
      });

      // 8. Recogida parcial de 2,000 USB terminados (1,000 HP + 1,000 Sony) hacia Almacén Principal
      await dispatchFinishedGoods({
        idempotencyKey: `VERIFY-PICKUP-HP-1000-${Date.now()}`,
        userId,
        productionOrderId: opRes.order.id,
        finishedProductId: usbHp.id,
        toWarehouseId: whOrigin.id,
        toLocationId: locOrigin.id,
        dispatchQty: 1000,
        autoReceive: true,
        notes: 'Recogida parcial 1,000 HP',
        externalTx: tx,
      });

      await dispatchFinishedGoods({
        idempotencyKey: `VERIFY-PICKUP-SONY-1000-${Date.now()}`,
        userId,
        productionOrderId: opRes.order.id,
        finishedProductId: usbSony.id,
        toWarehouseId: whOrigin.id,
        toLocationId: locOrigin.id,
        dispatchQty: 1000,
        autoReceive: true,
        notes: 'Recogida parcial 1,000 Sony',
        externalTx: tx,
      });

      const allFinBals = await tx.select().from(inventoryBalances);
      const finAvailableOrigin = allFinBals
        .filter(
          (b) =>
            (b.productId === usbHp.id ||
              b.productId === usbSony.id ||
              b.productId === usbSamsung.id) &&
            b.warehouseId === whOrigin.id &&
            b.status === 'AVAILABLE'
        )
        .reduce((s, b) => s + b.quantity, 0);

      const finPendingPickup = allFinBals
        .filter(
          (b) =>
            (b.productId === usbHp.id ||
              b.productId === usbSony.id ||
              b.productId === usbSamsung.id) &&
            b.status === 'FINISHED_PENDING_PICKUP' &&
            b.productionOrderId === opRes.order.id
        )
        .reduce((s, b) => s + b.quantity, 0);

      steps.push({
        step: '8. Recogida parcial de 2,000 USB terminados (1,500 pendientes de recogida)',
        passed: finAvailableOrigin === 2000 && finPendingPickup === 1500,
        details: `Recogidos y disponibles en almacén destino: ${finAvailableOrigin} u. Pendientes de recogida en taller: ${finPendingPickup} u. Sin re-consumir UDP ni empaques.`,
      });

      // 9. Devolución de los 500 UDP 8 GB sobrantes al almacén origen
      const retRes = await returnOrWasteOrderComponents({
        idempotencyKey: `VERIFY-RET-UDP-500-${Date.now()}`,
        userId,
        productionOrderId: opRes.order.id,
        operationType: 'RETURN_TO_ORIGIN',
        quantity: 500,
        reason: 'Devolución de 500 UDP 8 GB no utilizados al cerrar lote',
        externalTx: tx,
      });

      const finalOriginUdpRows = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.productId, udp8gb.id),
            eq(inventoryBalances.warehouseId, whOrigin.id),
            eq(inventoryBalances.status, 'AVAILABLE')
          )
        );
      const finalOriginUdp = finalOriginUdpRows[0]?.quantity ?? 0;

      const finalCustodyRows = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.productId, udp8gb.id),
            eq(inventoryBalances.productionOrderId, opRes.order.id),
            eq(inventoryBalances.status, 'IN_PRODUCTION_CUSTODY')
          )
        );
      const finalCustodyUdp = finalCustodyRows[0]?.quantity ?? 0;

      steps.push({
        step: '9. Devolución de 500 UDP 8 GB sobrantes al Almacén Principal',
        passed:
          finalOriginUdp === 16500 &&
          finalCustodyUdp === 0 &&
          retRes.order.returnedQty === 500,
        details: `UDP 8 GB Disponible en Almacén Principal subió de 16,000 a ${finalOriginUdp} u. Saldo en custodia de la orden: ${finalCustodyUdp} u.`,
      });

      // 10. Auditoría matemática global del Ledger dentro de la transacción
      const audit = await runAccountingInvariantAudit(tx);
      steps.push({
        step: '10. Conciliación algebraica de Kardex vs Saldos Materializados',
        passed: audit.isHealthy,
        details: `Saldos auditados: ${audit.checkedBalancesCount}, Líneas de Kardex: ${audit.checkedLedgerLinesCount}, Discrepancias: ${audit.balanceDiscrepancies.length + audit.orderDiscrepancies.length}.`,
      });

      const report = {
        allPassed: steps.every((s) => s.passed),
        steps,
        rolledBackCleanly: true,
        executedAt: new Date().toISOString(),
      };

      throw new RollbackVerificationSentinel(report);
    });
  } catch (err: any) {
    if (err instanceof RollbackVerificationSentinel) {
      return err.report;
    }
    throw err;
  }
}
