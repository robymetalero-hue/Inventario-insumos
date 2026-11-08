import { db, pool } from './index.ts';
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
import { eq, and, sql } from 'drizzle-orm';

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
 */
async function applyTransitionsInTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  documentId: number,
  transitions: LedgerTransition[]
) {
  for (const t of transitions) {
    if (!Number.isInteger(t.quantity) || t.quantity <= 0) {
      throw new Error(`Cantidad inválida (${t.quantity}). Solo se permiten enteros positivos mayores a cero.`);
    }

    const prodRows = await tx
      .select()
      .from(products)
      .where(eq(products.id, t.productId));
    const prod = prodRows[0];
    if (!prod) {
      throw new Error(`Producto ID ${t.productId} no existe en el catálogo maestro.`);
    }

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
          `Stock insuficiente para ${prod.sku} (${prod.name}) en estado ${t.from.status}. Disponible: ${availableQty}, Requerido: ${t.quantity}.`
        );
      }

      const newQty = availableQty - t.quantity;
      await tx
        .update(inventoryBalances)
        .set({
          quantity: newQty,
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
        await tx
          .update(inventoryBalances)
          .set({
            quantity: existingTo[0].quantity + t.quantity,
            updatedAt: new Date(),
          })
          .where(eq(inventoryBalances.id, existingTo[0].id));
      } else {
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

    // 3. Append immutable ledger line
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
      toWarehouseId: t.to?.warehouseId ?? null,
      toLocationId: t.to?.locationId ?? null,
      toStatus: t.to?.status ?? null,
      toOrderId: t.to?.orderId ?? 0,
      lotCode: t.lotCode ?? '',
    });
  }
}

/**
 * Checks idempotency key inside transaction. If already processed, returns cached response.
 */
async function checkIdempotencyInTx(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  idempotencyKey: string
): Promise<any | null> {
  if (!idempotencyKey || idempotencyKey.trim() === '') {
    throw new Error('Se requiere clave única de solicitud (Idempotency-Key) para confirmar la operación.');
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
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
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
 * 1. Supplier or Container Goods Receipt (Ingreso de Mercancía / Apertura Inicial)
 * Optionally records private owner landed costs in the same atomic transaction.
 */
export async function registerGoodsReceipt(params: {
  idempotencyKey: string;
  userId: number;
  movementType: 'INGRESO_PROVEEDOR' | 'APERTURA_INICIAL';
  warehouseId: number;
  locationId: number;
  supplierOrContainer: string;
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
}) {
  try {
    return await db.transaction(async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      if (!params.lines || params.lines.length === 0) {
        throw new Error('El ingreso debe incluir al menos una línea de producto.');
      }

      const folio = generateFolio(params.movementType === 'APERTURA_INICIAL' ? 'APE' : 'ING');

      const [doc] = await tx
        .insert(inventoryMovementDocuments)
        .values({
          folio,
          movementType: params.movementType,
          status: 'CONFIRMED',
          destWarehouseId: params.warehouseId,
          destLocationId: params.locationId,
          supplierOrContainer: params.supplierOrContainer || 'Proveedor General',
          reason: params.movementType === 'APERTURA_INICIAL' ? 'Apertura inicial auditada' : 'Recepción de proveedor/contenedor',
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

      await applyTransitionsInTx(tx, doc.id, transitions);

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

      const result = {
        document: doc,
        folio: doc.folio,
        serverTimestamp: doc.serverTimestamp,
        linesProcessed: params.lines.length,
      };

      await saveIdempotencyInTx(tx, params.idempotencyKey, params.userId, params.movementType, result);
      return result;
    });
  } catch (error: any) {
    console.error('Error in registerGoodsReceipt:', error);
    throw new Error(error.message || 'No se pudo procesar el documento de ingreso.', { cause: error });
  }
}

/**
 * 2. Create Production Order & Reserve Strategic Components
 * CRITICAL TIMING RULE: Reserving moves stock from AVAILABLE -> RESERVED_ORDER in origin warehouse.
 * It does NOT consume or duplicate units.
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
  allowedRecipeIds: number[];
  priority: string;
  instructions: string;
}) {
  try {
    return await db.transaction(async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      if (!Number.isInteger(params.authorizedQty) || params.authorizedQty <= 0) {
        throw new Error('La cantidad autorizada debe ser un entero positivo.');
      }

      const orderNumber = generateFolio('OP');
      const docFolio = generateFolio('RES');

      const [order] = await tx
        .insert(productionOrders)
        .values({
          orderNumber,
          status: 'RESERVED',
          sourceWarehouseId: params.sourceWarehouseId,
          sourceLocationId: params.sourceLocationId,
          targetWarehouseId: params.targetWarehouseId,
          targetLocationId: params.targetLocationId,
          assignedUserId: params.assignedUserId,
          strategicProductId: params.strategicProductId,
          authorizedQty: params.authorizedQty,
          reservedQty: params.authorizedQty,
          allowedRecipeIds: params.allowedRecipeIds,
          priority: params.priority || 'NORMAL',
          instructions: params.instructions || '',
          createdByUserId: params.userId,
        })
        .returning();

      const [doc] = await tx
        .insert(inventoryMovementDocuments)
        .values({
          folio: docFolio,
          movementType: 'RESERVA_OP',
          status: 'CONFIRMED',
          sourceWarehouseId: params.sourceWarehouseId,
          sourceLocationId: params.sourceLocationId,
          destWarehouseId: params.sourceWarehouseId,
          destLocationId: params.sourceLocationId,
          productionOrderId: order.id,
          reason: `Reserva lógica para Orden de Producción ${orderNumber}`,
          notes: params.instructions || '',
          createdByUserId: params.userId,
          confirmedByUserId: params.userId,
          idempotencyKey: params.idempotencyKey,
        })
        .returning();

      await applyTransitionsInTx(tx, doc.id, [
        {
          productId: params.strategicProductId,
          quantity: params.authorizedQty,
          from: {
            warehouseId: params.sourceWarehouseId,
            locationId: params.sourceLocationId,
            status: 'AVAILABLE',
            orderId: 0,
          },
          to: {
            warehouseId: params.sourceWarehouseId,
            locationId: params.sourceLocationId,
            status: 'RESERVED_ORDER',
            orderId: order.id,
          },
          lotCode: orderNumber,
        },
      ]);

      const result = { order, reservationDocument: doc };
      await saveIdempotencyInTx(tx, params.idempotencyKey, params.userId, 'RESERVA_OP', result);
      return result;
    });
  } catch (error: any) {
    console.error('Error in createProductionOrderWithReservation:', error);
    throw new Error(error.message || 'No se pudo crear la orden de producción.', { cause: error });
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
}) {
  try {
    return await db.transaction(async (tx) => {
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
    throw new Error(error.message || 'Error al despachar componentes a producción.', { cause: error });
  }
}

/**
 * 4. Accept Dispatched Components in Production (Supports Physical Discrepancy e.g. 1,980 of 2,000)
 * Received units move from IN_TRANSIT_PRODUCTION -> IN_PRODUCTION_CUSTODY.
 * Any missing difference moves from IN_TRANSIT_PRODUCTION -> DISCREPANCY_HOLD and blocks normal order closure.
 */
export async function acknowledgeProductionDispatch(params: {
  idempotencyKey: string;
  userId: number;
  dispatchId: number;
  receivedQty: number;
  notes?: string;
}) {
  try {
    return await db.transaction(async (tx) => {
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

      if (!Number.isInteger(params.receivedQty) || params.receivedQty < 0 || params.receivedQty > dispatchRow.dispatchedQty) {
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

      await applyTransitionsInTx(tx, doc.id, transitions);

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

      const result = { dispatch: updatedDispatch, order: updatedOrder, document: doc };
      await saveIdempotencyInTx(tx, params.idempotencyKey, params.userId, 'ACEPTACION_OP', result);
      return result;
    });
  } catch (error: any) {
    console.error('Error in acknowledgeProductionDispatch:', error);
    throw new Error(error.message || 'No se pudo confirmar la recepción en producción.', { cause: error });
  }
}

/**
 * 5. Register Real Production Batch(es) & Atomic BOM Deduction
 * Supports producing 1 or multiple authorized models in a single atomic transaction.
 * - Strategic component (UDP / microSD) is consumed from IN_PRODUCTION_CUSTODY for that order.
 * - Secondary components (cases, universal SD adapters, packaging kits) are consumed from AVAILABLE in the target workshop location.
 * - Finished goods are created in FINISHED_PENDING_PICKUP bound to the order.
 * If ANY component is missing by even 1 unit, the entire transaction rolls back.
 */
export async function registerProductionBatches(params: {
  idempotencyKey: string;
  userId: number;
  productionOrderId: number;
  items: {
    recipeId: number;
    quantityToProduce: number;
    notes?: string;
  }[];
}) {
  try {
    return await db.transaction(async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      if (!params.items || params.items.length === 0) {
        throw new Error('Debe especificar al menos un lote/modelo de producción.');
      }

      const orders = await tx
        .select()
        .from(productionOrders)
        .where(eq(productionOrders.id, params.productionOrderId))
        .for('update');
      const order = orders[0];
      if (!order) throw new Error('Orden de producción no encontrada.');
      if (order.status === 'CLOSED' || order.status === 'CANCELLED') {
        throw new Error(`La orden ${order.orderNumber} está cerrada o anulada y no admite nuevos lotes.`);
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
          reason: `Transformación y consumo por receta en orden ${order.orderNumber}`,
          notes: params.items.map((i) => i.notes || '').filter(Boolean).join('; '),
          createdByUserId: params.userId,
          confirmedByUserId: params.userId,
          idempotencyKey: params.idempotencyKey,
        })
        .returning();

      let totalStrategicConsumed = 0;
      const transitions: LedgerTransition[] = [];
      const createdBatches = [];

      for (const item of params.items) {
        if (!Number.isInteger(item.quantityToProduce) || item.quantityToProduce <= 0) {
          throw new Error('La cantidad a producir debe ser un número entero positivo.');
        }

        // Verify recipe is allowed for this order (if order specifies allowedRecipeIds)
        if (
          order.allowedRecipeIds &&
          order.allowedRecipeIds.length > 0 &&
          !order.allowedRecipeIds.includes(item.recipeId)
        ) {
          throw new Error(
            `La receta ID ${item.recipeId} no está autorizada dentro de la orden ${order.orderNumber}. Solicite autorización del propietario.`
          );
        }

        const recipeRows = await tx
          .select()
          .from(recipes)
          .where(eq(recipes.id, item.recipeId));
        const recipe = recipeRows[0];
        if (!recipe || !recipe.isActive) {
          throw new Error(`La receta ID ${item.recipeId} no existe o está inactiva.`);
        }

        const versionRows = await tx
          .select()
          .from(recipeVersions)
          .where(
            and(
              eq(recipeVersions.recipeId, recipe.id),
              eq(recipeVersions.isCurrent, true)
            )
          );
        const version = versionRows[0];
        if (!version) {
          throw new Error(`No se encontró una versión activa para la receta ${recipe.code}.`);
        }

        const bomLines = await tx
          .select()
          .from(recipeComponents)
          .where(eq(recipeComponents.recipeVersionId, version.id));

        if (bomLines.length === 0) {
          throw new Error(`La receta ${recipe.code} no tiene componentes configurados.`);
        }

        // Verify strategic component matches order's strategic product
        const hasStrategicMatch = bomLines.some(
          (b) => b.componentProductId === order.strategicProductId
        );
        if (!hasStrategicMatch) {
          throw new Error(
            `La receta ${recipe.code} no utiliza el componente estratégico asignado a la orden ${order.orderNumber}.`
          );
        }

        for (const bom of bomLines) {
          const requiredQty = bom.quantityPerUnit * item.quantityToProduce;
          const isStrategic =
            bom.isStrategicOrderBound || bom.componentProductId === order.strategicProductId;

          if (isStrategic) {
            totalStrategicConsumed += requiredQty;
            transitions.push({
              productId: bom.componentProductId,
              quantity: requiredQty,
              from: {
                warehouseId: order.targetWarehouseId,
                locationId: order.targetLocationId,
                status: 'IN_PRODUCTION_CUSTODY',
                orderId: order.id,
              },
              lotCode: order.orderNumber,
            });
          } else {
            // Secondary component (case, universal SD adapter, packaging kit) consumed from local AVAILABLE stock
            transitions.push({
              productId: bom.componentProductId,
              quantity: requiredQty,
              from: {
                warehouseId: order.targetWarehouseId,
                locationId: order.targetLocationId,
                status: 'AVAILABLE',
                orderId: 0,
              },
              lotCode: order.orderNumber,
            });
          }
        }

        // Output finished product in FINISHED_PENDING_PICKUP bound to order
        transitions.push({
          productId: recipe.finishedProductId,
          quantity: item.quantityToProduce,
          to: {
            warehouseId: order.targetWarehouseId,
            locationId: order.targetLocationId,
            status: 'FINISHED_PENDING_PICKUP',
            orderId: order.id,
          },
          lotCode: docFolio,
        });

        const batchFolio = generateFolio('LOTE');
        const [batch] = await tx
          .insert(productionBatches)
          .values({
            batchFolio,
            productionOrderId: order.id,
            recipeId: recipe.id,
            recipeVersionId: version.id,
            finishedProductId: recipe.finishedProductId,
            warehouseId: order.targetWarehouseId,
            locationId: order.targetLocationId,
            quantityProduced: item.quantityToProduce,
            quantityPickedUp: 0,
            movementDocumentId: doc.id,
            operatorUserId: params.userId,
            notes: item.notes || '',
          })
          .returning();

        createdBatches.push(batch);
      }

      if (totalStrategicConsumed > pendingCustodyBalance) {
        throw new Error(
          `Intento de sobreconsumo en orden ${order.orderNumber}: se requieren ${totalStrategicConsumed} unidades del componente estratégico, pero solo hay ${pendingCustodyBalance} unidades bajo custodia de producción.`
        );
      }

      // Execute all balance locks, deductions, and creations atomically
      await applyTransitionsInTx(tx, doc.id, transitions);

      const newConsumed = order.consumedQty + totalStrategicConsumed;
      const remainingAfter =
        order.receivedInProductionQty - newConsumed - order.returnedQty - order.wasteQty;

      const [updatedOrder] = await tx
        .update(productionOrders)
        .set({
          consumedQty: newConsumed,
          status: remainingAfter === 0 && order.reservedQty === 0 ? 'COMPLETED_PENDING_PICKUP' : 'PARTIALLY_COMPLETED',
        })
        .where(eq(productionOrders.id, order.id))
        .returning();

      const result = {
        document: doc,
        batches: createdBatches,
        order: updatedOrder,
        totalStrategicConsumed,
        remainingCustodyQty: remainingAfter,
      };

      await saveIdempotencyInTx(tx, params.idempotencyKey, params.userId, 'PRODUCCION_LOTE', result);
      return result;
    });
  } catch (error: any) {
    console.error('Error in registerProductionBatches:', error);
    throw new Error(error.message || 'Fallo en el registro atómico de producción.', { cause: error });
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
}) {
  try {
    return await db.transaction(async (tx) => {
      const cached = await checkIdempotencyInTx(tx, params.idempotencyKey);
      if (cached) return { ...cached, idempotentReplay: true };

      if (!Number.isInteger(params.quantity) || params.quantity <= 0) {
        throw new Error('La cantidad debe ser un entero positivo.');
      }
      if (!params.reason || params.reason.trim().length < 4) {
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
          `Cantidad (${params.quantity}) excede el saldo bajo custodia en producción (${pendingCustody}).`
        );
      }

      const isReturn = params.operationType === 'RETURN_TO_ORIGIN';
      const folio = generateFolio(isReturn ? 'RET-OP' : 'MER-OP');

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

      await applyTransitionsInTx(tx, doc.id, [
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

      const [updatedOrder] = await tx
        .update(productionOrders)
        .set({
          returnedQty: isReturn ? order.returnedQty + params.quantity : order.returnedQty,
          wasteQty: !isReturn ? order.wasteQty + params.quantity : order.wasteQty,
        })
        .where(eq(productionOrders.id, order.id))
        .returning();

      const result = { order: updatedOrder, document: doc };
      await saveIdempotencyInTx(tx, params.idempotencyKey, params.userId, doc.movementType, result);
      return result;
    });
  } catch (error: any) {
    console.error('Error in returnOrWasteOrderComponents:', error);
    throw new Error(error.message || 'No se pudo procesar la devolución o merma.', { cause: error });
  }
}

/**
 * 7. Dispatch & Receive Finished Goods (Partial or Total Pickup)
 * CRITICAL INVARIANT: Picking up finished goods NEVER deducts UDP, cases, adapters, or packaging again.
 * It only transfers custody of the finished SKU:
 * FINISHED_PENDING_PICKUP -> FINISHED_IN_TRANSIT -> AVAILABLE (in destination warehouse).
 */
export async function dispatchFinishedGoods(params: {
  idempotencyKey: string;
  userId: number;
  productionOrderId: number;
  finishedProductId: number;
  toWarehouseId: number;
  toLocationId: number;
  dispatchQty: number;
  notes?: string;
}) {
  try {
    return await db.transaction(async (tx) => {
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

      const [doc] = await tx
        .insert(inventoryMovementDocuments)
        .values({
          folio,
          movementType: 'DESPACHO_TERMINADO',
          status: 'CONFIRMED',
          sourceWarehouseId: order.targetWarehouseId,
          sourceLocationId: order.targetLocationId,
          destWarehouseId: params.toWarehouseId,
          destLocationId: params.toLocationId,
          productionOrderId: order.id,
          reason: `Entrega de producto terminado de orden ${order.orderNumber}`,
          notes: params.notes || '',
          createdByUserId: params.userId,
          confirmedByUserId: params.userId,
          idempotencyKey: params.idempotencyKey,
        })
        .returning();

      await applyTransitionsInTx(tx, doc.id, [
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
            status: 'FINISHED_IN_TRANSIT',
            orderId: order.id,
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
          status: 'IN_TRANSIT',
          dispatchedByUserId: params.userId,
          notes: params.notes || '',
        })
        .returning();

      const result = { dispatch: dispatchRow, document: doc };
      await saveIdempotencyInTx(tx, params.idempotencyKey, params.userId, 'DESPACHO_TERMINADO', result);
      return result;
    });
  } catch (error: any) {
    console.error('Error in dispatchFinishedGoods:', error);
    throw new Error(error.message || 'No se pudo despachar el producto terminado.', { cause: error });
  }
}

export async function receiveFinishedGoods(params: {
  idempotencyKey: string;
  userId: number;
  dispatchId: number;
  receivedQty: number;
  notes?: string;
}) {
  try {
    return await db.transaction(async (tx) => {
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

      await applyTransitionsInTx(tx, doc.id, transitions);

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

      const result = { dispatch: updatedDispatch, document: doc };
      await saveIdempotencyInTx(tx, params.idempotencyKey, params.userId, 'RECEPCION_TERMINADO', result);
      return result;
    });
  } catch (error: any) {
    console.error('Error in receiveFinishedGoods:', error);
    throw new Error(error.message || 'No se pudo confirmar la recepción de productos terminados.', {
      cause: error,
    });
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
}) {
  try {
    return await db.transaction(async (tx) => {
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

      await applyTransitionsInTx(tx, doc.id, [
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

      const result = { document: doc, transfer: transferRow, isInternalSameWarehouse };
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
}) {
  try {
    return await db.transaction(async (tx) => {
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

      if (!Number.isInteger(params.receivedQty) || params.receivedQty < 0 || params.receivedQty > tr.dispatchedQty) {
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

      await applyTransitionsInTx(tx, doc.id, transitions);

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

      const result = { transfer: updated, document: doc };
      await saveIdempotencyInTx(tx, params.idempotencyKey, params.userId, 'TRANSFERENCIA_RECEPCION', result);
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
export async function runAccountingInvariantAudit() {
  try {
    const allBalances = await db.select().from(inventoryBalances);
    const allLines = await db.select().from(inventoryMovementLines);
    const allOrders = await db.select().from(productionOrders);

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
      // Conservation equation:
      // authorizedQty == reservedQty + dispatchedQty
      if (o.authorizedQty !== o.reservedQty + o.dispatchedQty) {
        orderDiscrepancies.push({
          orderNumber: o.orderNumber,
          detail: `Autorizado (${o.authorizedQty}) != Reservado (${o.reservedQty}) + Despachado (${o.dispatchedQty})`,
        });
      }

      // Check custody balance in inventory_balances for this order
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
