import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import * as dotenv from 'dotenv';
import { db } from './src/db/index.ts';
import {
  users,
  warehouses,
  warehouseLocations,
  userWarehousePermissions,
  products,
  recipes,
  recipeVersions,
  recipeComponents,
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
  securityAuditEvents,
  idempotencyKeys,
} from './src/db/schema.ts';
import {
  requireAuth,
  requireOwnerPrivateAccess,
  assertWarehouseAccess,
  hashPassword,
  createLocalSessionToken,
  loadUserWithPermissions,
  logSecurityEvent,
  AuthRequest,
} from './src/middleware/auth.ts';
import {
  normalizeProductKey,
  registerGoodsReceipt,
  createProductionOrderWithReservation,
  dispatchProductionOrderComponents,
  acknowledgeProductionDispatch,
  registerProductionBatches,
  returnOrWasteOrderComponents,
  dispatchFinishedGoods,
  receiveFinishedGoods,
  createOrMoveWarehouseTransfer,
  receiveWarehouseTransfer,
  submitPhysicalCount,
  approvePhysicalCountAdjustment,
  runAccountingInvariantAudit,
} from './src/db/inventory-engine.ts';
import {
  ensureBaseCatalogAndUsers,
  runAutomatedVerificationSuite,
} from './src/db/seed.ts';
import { eq, desc, inArray, and } from 'drizzle-orm';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // =========================================================================
  // 1. HEALTH & IDEMPOTENCY STATUS CHECK
  // =========================================================================
  app.get('/api/health', async (_req, res) => {
    try {
      await ensureBaseCatalogAndUsers();
      res.json({
        status: 'ONLINE',
        serverTimeUtc: new Date().toISOString(),
        timezone: 'America/La_Paz',
      });
    } catch (error: any) {
      console.error('Health check error:', error);
      res.status(503).json({ status: 'OFFLINE', error: 'Error de conexión con la base de datos.' });
    }
  });

  app.get('/api/idempotency/:key', requireAuth, async (req: AuthRequest, res) => {
    try {
      const found = await db
        .select()
        .from(idempotencyKeys)
        .where(eq(idempotencyKeys.key, req.params.key));
      if (!found[0]) {
        return res.json({ processed: false });
      }
      return res.json({
        processed: true,
        operationType: found[0].operationType,
        responsePayload: found[0].responsePayload,
        createdAt: found[0].createdAt,
      });
    } catch (error: any) {
      res.status(500).json({ error: 'No se pudo verificar el estado de la clave de operación.' });
    }
  });

  // =========================================================================
  // 2. AUTHENTICATION & DEMO ROLE SWITCHER (For Test/Validation Environment)
  // =========================================================================
  app.post('/api/auth/login', async (req, res) => {
    try {
      await ensureBaseCatalogAndUsers();
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Ingrese usuario y contraseña.' });
      }

      const cleanUser = String(username).trim().toLowerCase();
      const found = await db
        .select()
        .from(users)
        .where(eq(users.username, cleanUser));
      const userRow = found[0];

      const hashed = hashPassword(String(password));
      if (!userRow || !userRow.isActive || userRow.passwordHash !== hashed) {
        await logSecurityEvent(
          userRow?.id ?? null,
          cleanUser,
          'LOGIN_FAILURE',
          '/api/auth/login',
          'Credenciales incorrectas o usuario inactivo'
        );
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
      }

      const token = createLocalSessionToken(userRow.id, userRow.uid);
      const profile = await loadUserWithPermissions(userRow);

      await logSecurityEvent(
        userRow.id,
        userRow.username,
        'LOGIN_SUCCESS',
        '/api/auth/login',
        `Inicio de sesión exitoso (${userRow.role})`
      );

      return res.json({ token, user: profile });
    } catch (error: any) {
      console.error('Login error:', error);
      return res.status(500).json({ error: 'Error interno al procesar el inicio de sesión.' });
    }
  });

  app.get('/api/auth/me', requireAuth, async (req: AuthRequest, res) => {
    try {
      await ensureBaseCatalogAndUsers();
      const allUsersList = await db
        .select({
          id: users.id,
          username: users.username,
          fullName: users.fullName,
          role: users.role,
          isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.isActive, true));

      res.json({
        user: req.authUser,
        availableTestProfiles: allUsersList,
      });
    } catch (error: any) {
      res.status(500).json({ error: 'No se pudo cargar el perfil de sesión.' });
    }
  });

  // =========================================================================
  // 3. INITIAL STATE & FILTERED WORKSPACE DATA BY WAREHOUSE PERMISSIONS
  // =========================================================================
  app.get('/api/workspace', requireAuth, async (req: AuthRequest, res) => {
    try {
      await ensureBaseCatalogAndUsers();
      const user = req.authUser!;
      const isGlobalAdmin = user.role === 'OWNER' || user.role === 'ADMIN';
      const allowedWarehouseIds = isGlobalAdmin
        ? null
        : user.warehousePermissions.filter((p) => p.canView).map((p) => p.warehouseId);

      // Optional warehouse filter parameter to test IDOR protection explicitly
      const requestedWarehouseId = req.query.warehouseId
        ? Number(req.query.warehouseId)
        : null;

      if (
        requestedWarehouseId &&
        !assertWarehouseAccess(user, requestedWarehouseId, 'VIEW')
      ) {
        await logSecurityEvent(
          user.id,
          user.username,
          'IDOR_ATTEMPT',
          req.originalUrl,
          `Usuario intentó consultar almacén ID ${requestedWarehouseId} sin autorización.`
        );
        return res.status(403).json({
          error: `Acceso denegado (403): No tiene autorización para consultar existencias ni movimientos del almacén solicitado.`,
        });
      }

      const allWarehouses = await db.select().from(warehouses);
      const visibleWarehouses = isGlobalAdmin
        ? allWarehouses
        : allWarehouses.filter((w) => allowedWarehouseIds!.includes(w.id));

      const visibleWarehouseIdSet = new Set(visibleWarehouses.map((w) => w.id));

      const allLocations = await db.select().from(warehouseLocations);
      const visibleLocations = allLocations.filter((l) =>
        visibleWarehouseIdSet.has(l.warehouseId)
      );

      const allProducts = await db.select().from(products);

      // Recipes with BOM lines
      const allRecipes = await db.select().from(recipes);
      const allVersions = await db
        .select()
        .from(recipeVersions)
        .where(eq(recipeVersions.isCurrent, true));
      const allBomComponents = await db.select().from(recipeComponents);

      const enrichedRecipes = allRecipes.map((r) => {
        const curVer = allVersions.find((v) => v.recipeId === r.id);
        const comps = curVer
          ? allBomComponents.filter((c) => c.recipeVersionId === curVer.id)
          : [];
        return {
          ...r,
          versionId: curVer?.id ?? null,
          versionNumber: curVer?.versionNumber ?? r.currentVersion,
          components: comps,
        };
      });

      // Balances strictly filtered by authorized warehouses
      const rawBalances = await db.select().from(inventoryBalances);
      const visibleBalances = rawBalances.filter(
        (b) => b.quantity > 0 && visibleWarehouseIdSet.has(b.warehouseId)
      );

      // Production orders filtered by source or target warehouse authorization
      const rawOrders = await db
        .select()
        .from(productionOrders)
        .orderBy(desc(productionOrders.createdAt));
      const visibleOrders = rawOrders.filter(
        (o) =>
          visibleWarehouseIdSet.has(o.sourceWarehouseId) ||
          visibleWarehouseIdSet.has(o.targetWarehouseId)
      );

      const rawProdDispatches = await db
        .select()
        .from(productionDispatches)
        .orderBy(desc(productionDispatches.dispatchedAt));
      const visibleOrderIdSet = new Set(visibleOrders.map((o) => o.id));
      const visibleProdDispatches = rawProdDispatches.filter((d) =>
        visibleOrderIdSet.has(d.productionOrderId)
      );

      const rawBatches = await db
        .select()
        .from(productionBatches)
        .orderBy(desc(productionBatches.createdAt));
      const visibleBatches = rawBatches.filter((b) =>
        visibleWarehouseIdSet.has(b.warehouseId)
      );

      const rawFgDispatches = await db
        .select()
        .from(finishedGoodsDispatches)
        .orderBy(desc(finishedGoodsDispatches.dispatchedAt));
      const visibleFgDispatches = rawFgDispatches.filter(
        (d) =>
          visibleWarehouseIdSet.has(d.fromWarehouseId) ||
          visibleWarehouseIdSet.has(d.toWarehouseId)
      );

      const rawTransfers = await db
        .select()
        .from(warehouseTransfers)
        .orderBy(desc(warehouseTransfers.dispatchedAt));
      const visibleTransfers = rawTransfers.filter(
        (t) =>
          visibleWarehouseIdSet.has(t.fromWarehouseId) ||
          visibleWarehouseIdSet.has(t.toWarehouseId)
      );

      const rawCounts = await db
        .select()
        .from(physicalCounts)
        .orderBy(desc(physicalCounts.createdAt));
      const visibleCounts = rawCounts
        .filter((c) => visibleWarehouseIdSet.has(c.warehouseId))
        .map((c) => {
          // If user is not OWNER/ADMIN and count is blind & pending, hide systemExpectedQty
          if (!isGlobalAdmin && c.isBlindCount && c.status === 'PENDING_APPROVAL') {
            return {
              ...c,
              systemExpectedQty: -1,
              differenceQty: 0,
            };
          }
          return c;
        });

      // Movement documents & ledger lines filtered by authorized warehouses
      const rawDocs = await db
        .select()
        .from(inventoryMovementDocuments)
        .orderBy(desc(inventoryMovementDocuments.serverTimestamp));
      const visibleDocs = rawDocs.filter(
        (d) =>
          isGlobalAdmin ||
          (d.sourceWarehouseId && visibleWarehouseIdSet.has(d.sourceWarehouseId)) ||
          (d.destWarehouseId && visibleWarehouseIdSet.has(d.destWarehouseId))
      );
      const visibleDocIds = new Set(visibleDocs.map((d) => d.id));
      const rawLines = await db
        .select()
        .from(inventoryMovementLines)
        .orderBy(desc(inventoryMovementLines.createdAt));
      const visibleLines = rawLines.filter((l) => visibleDocIds.has(l.documentId));

      const allUsersPublic = await db
        .select({
          id: users.id,
          username: users.username,
          fullName: users.fullName,
          role: users.role,
          email: users.email,
          isActive: users.isActive,
          canViewPrivateCosts: users.canViewPrivateCosts,
        })
        .from(users);

      const allWarehousePerms = isGlobalAdmin
        ? await db.select().from(userWarehousePermissions)
        : [];

      // Notice: NO private purchase batches or costs are ever included in /api/workspace
      res.json({
        user,
        warehouses: visibleWarehouses,
        allWarehousesSummary: allWarehouses.map((w) => ({
          id: w.id,
          code: w.code,
          name: w.name,
          isProductionPlant: w.isProductionPlant,
        })),
        locations: visibleLocations,
        allLocationsSummary: allLocations.map((l) => ({
          id: l.id,
          warehouseId: l.warehouseId,
          code: l.code,
          zoneName: l.zoneName,
          shelfName: l.shelfName,
        })),
        products: allProducts,
        recipes: enrichedRecipes,
        balances: visibleBalances,
        productionOrders: visibleOrders,
        productionDispatches: visibleProdDispatches,
        productionBatches: visibleBatches,
        finishedGoodsDispatches: visibleFgDispatches,
        warehouseTransfers: visibleTransfers,
        physicalCounts: visibleCounts,
        movementDocuments: visibleDocs.slice(0, 200),
        movementLines: visibleLines.slice(0, 500),
        usersPublic: allUsersPublic,
        userWarehousePermissions: allWarehousePerms,
        serverTimestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Workspace fetch error:', error);
      res.status(500).json({ error: error.message || 'Error al cargar datos operativos.' });
    }
  });

  // =========================================================================
  // 4. MASTER CATALOG, RECIPES & WAREHOUSE CONFIGURATION (Owner / Admin)
  // =========================================================================
  app.post('/api/products', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        await logSecurityEvent(
          user.id,
          user.username,
          'ACCESS_DENIED',
          '/api/products',
          'Intento de crear producto maestro sin permisos de Administrador/Propietario'
        );
        return res.status(403).json({
          error: 'Solo el Propietario o Administrador puede dar de alta productos en el catálogo maestro.',
        });
      }

      const {
        sku,
        name,
        description,
        productType,
        family,
        brand,
        model,
        capacity,
        color,
        material,
        unitName,
        unitsPerBox,
        imageUrl,
        barcode,
        minStockAlert,
        forceCreateDespiteDuplicateWarning,
      } = req.body;

      if (!sku || !name || !productType || !family) {
        return res.status(400).json({ error: 'SKU, nombre, tipo y familia son obligatorios.' });
      }

      const cleanSku = String(sku).trim().toUpperCase();
      const normKey = normalizeProductKey(brand, model, capacity, color, material);

      const existingAll = await db.select().from(products);
      if (existingAll.some((p) => p.sku.toUpperCase() === cleanSku)) {
        return res.status(400).json({ error: `Ya existe un producto con el SKU ${cleanSku}.` });
      }

      const duplicateAttrMatch = existingAll.find((p) => p.normalizedKey === normKey);
      if (duplicateAttrMatch && !forceCreateDespiteDuplicateWarning) {
        return res.status(409).json({
          warningDuplicate: true,
          existingProduct: duplicateAttrMatch,
          error: `Posible duplicado detectado: Ya existe "${duplicateAttrMatch.name}" (${duplicateAttrMatch.sku}) con los mismos atributos de marca/modelo/capacidad/color. Confirme si desea crearlo de todos modos.`,
        });
      }

      const [created] = await db
        .insert(products)
        .values({
          sku: cleanSku,
          name: String(name).trim(),
          normalizedKey: normKey,
          description: description || '',
          productType,
          family,
          brand: brand || 'Genérico',
          model: model || 'Estándar',
          capacity: capacity || 'N/A',
          color: color || 'N/A',
          material: material || 'N/A',
          unitName: unitName || 'piezas',
          unitsPerBox: Number(unitsPerBox) || 1000,
          imageUrl: imageUrl || '',
          barcode: barcode || '',
          minStockAlert: Number(minStockAlert) || 500,
          isActive: true,
        })
        .returning();

      return res.json({ product: created });
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'No se pudo guardar el producto.' });
    }
  });

  app.post('/api/recipes', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        await logSecurityEvent(
          user.id,
          user.username,
          'ACCESS_DENIED',
          '/api/recipes',
          'Intento no autorizado de crear/modificar receta BOM'
        );
        return res.status(403).json({
          error: 'Acceso denegado: Solo el Propietario o personal autorizado puede administrar recetas (BOM).',
        });
      }

      const { recipeId, code, name, finishedProductId, changeReason, components } = req.body;
      if (!components || !Array.isArray(components) || components.length === 0) {
        return res.status(400).json({ error: 'La receta debe incluir al menos un componente.' });
      }

      // If recipeId is provided -> create a new version without rewriting historical batches!
      if (recipeId) {
        const existingRecs = await db
          .select()
          .from(recipes)
          .where(eq(recipes.id, Number(recipeId)));
        const rec = existingRecs[0];
        if (!rec) return res.status(404).json({ error: 'Receta no encontrada.' });

        const nextVerNum = rec.currentVersion + 1;
        await db
          .update(recipeVersions)
          .set({ isCurrent: false })
          .where(eq(recipeVersions.recipeId, rec.id));

        const [newVer] = await db
          .insert(recipeVersions)
          .values({
            recipeId: rec.id,
            versionNumber: nextVerNum,
            finishedProductId: rec.finishedProductId,
            isCurrent: true,
            changeReason: changeReason || `Actualización a versión v${nextVerNum}`,
            createdByUserId: user.id,
          })
          .returning();

        for (const comp of components) {
          await db.insert(recipeComponents).values({
            recipeVersionId: newVer.id,
            componentProductId: Number(comp.componentProductId),
            quantityPerUnit: Number(comp.quantityPerUnit),
            isStrategicOrderBound: Boolean(comp.isStrategicOrderBound),
          });
        }

        await db
          .update(recipes)
          .set({ currentVersion: nextVerNum, name: name || rec.name })
          .where(eq(recipes.id, rec.id));

        return res.json({ recipeId: rec.id, newVersion: newVer });
      } else {
        const [newRec] = await db
          .insert(recipes)
          .values({
            code: String(code).trim().toUpperCase(),
            name: String(name).trim(),
            finishedProductId: Number(finishedProductId),
            currentVersion: 1,
            isActive: true,
            notes: changeReason || 'Versión inicial',
            createdByUserId: user.id,
          })
          .returning();

        const [ver] = await db
          .insert(recipeVersions)
          .values({
            recipeId: newRec.id,
            versionNumber: 1,
            finishedProductId: Number(finishedProductId),
            isCurrent: true,
            changeReason: 'Versión inicial v1',
            createdByUserId: user.id,
          })
          .returning();

        for (const comp of components) {
          await db.insert(recipeComponents).values({
            recipeVersionId: ver.id,
            componentProductId: Number(comp.componentProductId),
            quantityPerUnit: Number(comp.quantityPerUnit),
            isStrategicOrderBound: Boolean(comp.isStrategicOrderBound),
          });
        }

        return res.json({ recipe: newRec, version: ver });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Error al guardar la receta.' });
    }
  });

  app.post('/api/warehouses', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Solo el Propietario puede crear almacenes o ubicaciones.' });
      }

      const { type, code, name, description, address, isProductionPlant, warehouseId, zoneName, shelfName } =
        req.body;

      if (type === 'LOCATION') {
        const [loc] = await db
          .insert(warehouseLocations)
          .values({
            warehouseId: Number(warehouseId),
            code: String(code).trim().toUpperCase(),
            zoneName: String(zoneName).trim(),
            shelfName: String(shelfName).trim(),
            description: description || '',
            isDefault: false,
            isActive: true,
          })
          .returning();
        return res.json({ location: loc });
      } else {
        const [wh] = await db
          .insert(warehouses)
          .values({
            code: String(code).trim().toUpperCase(),
            name: String(name).trim(),
            description: description || '',
            address: address || '',
            isProductionPlant: Boolean(isProductionPlant),
            isActive: true,
          })
          .returning();

        await db.insert(warehouseLocations).values({
          warehouseId: wh.id,
          code: `${wh.code}-GEN-1`,
          zoneName: 'Zona Principal',
          shelfName: 'Estante 1',
          description: 'Ubicación predeterminada',
          isDefault: true,
          isActive: true,
        });

        return res.json({ warehouse: wh });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Error al configurar almacén/ubicación.' });
    }
  });

  // =========================================================================
  // 5. GOODS RECEIPT (INGRESO DE PROVEEDOR O CONTENEDOR)
  // =========================================================================
  app.post('/api/inventory/receipts', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      const {
        idempotencyKey,
        movementType,
        warehouseId,
        locationId,
        supplierOrContainer,
        notes,
        lines,
      } = req.body;

      if (!assertWarehouseAccess(user, Number(warehouseId), 'RECEIVE')) {
        await logSecurityEvent(
          user.id,
          user.username,
          'ACCESS_DENIED',
          '/api/inventory/receipts',
          `Intento de registrar ingreso en almacén ID ${warehouseId} sin permiso.`
        );
        return res.status(403).json({
          error: 'No tiene permiso para registrar ingresos en el almacén seleccionado.',
        });
      }

      // Strip privateCost if user is not Owner
      const sanitizedLines = (lines || []).map((l: any) => ({
        productId: Number(l.productId),
        quantity: Number(l.quantity),
        lotCode: l.lotCode,
        privateCost:
          user.role === 'OWNER' || user.canViewPrivateCosts ? l.privateCost : undefined,
      }));

      const result = await registerGoodsReceipt({
        idempotencyKey,
        userId: user.id,
        movementType: movementType === 'APERTURA_INICIAL' ? 'APERTURA_INICIAL' : 'INGRESO_PROVEEDOR',
        warehouseId: Number(warehouseId),
        locationId: Number(locationId),
        supplierOrContainer: supplierOrContainer || '',
        notes: notes || '',
        lines: sanitizedLines,
      });

      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  // =========================================================================
  // 6. PRODUCTION ORDERS, DISPATCHES, ACKNOWLEDGEMENTS & BATCHES
  // =========================================================================
  app.post('/api/production/orders', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        return res.status(403).json({
          error: 'Solo el Propietario o Administrador puede emitir Órdenes de Producción.',
        });
      }

      const result = await createProductionOrderWithReservation({
        idempotencyKey: req.body.idempotencyKey,
        userId: user.id,
        sourceWarehouseId: Number(req.body.sourceWarehouseId),
        sourceLocationId: Number(req.body.sourceLocationId),
        targetWarehouseId: Number(req.body.targetWarehouseId),
        targetLocationId: Number(req.body.targetLocationId),
        assignedUserId: Number(req.body.assignedUserId),
        strategicProductId: Number(req.body.strategicProductId),
        authorizedQty: Number(req.body.authorizedQty),
        allowedRecipeIds: Array.isArray(req.body.allowedRecipeIds)
          ? req.body.allowedRecipeIds.map(Number)
          : [],
        priority: req.body.priority || 'NORMAL',
        instructions: req.body.instructions || '',
      });

      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/production/dispatches', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      const result = await dispatchProductionOrderComponents({
        idempotencyKey: req.body.idempotencyKey,
        userId: user.id,
        productionOrderId: Number(req.body.productionOrderId),
        dispatchQty: Number(req.body.dispatchQty),
        notes: req.body.notes,
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/production/acknowledge', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      const result = await acknowledgeProductionDispatch({
        idempotencyKey: req.body.idempotencyKey,
        userId: user.id,
        dispatchId: Number(req.body.dispatchId),
        receivedQty: Number(req.body.receivedQty),
        notes: req.body.notes,
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/production/batches', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      const result = await registerProductionBatches({
        idempotencyKey: req.body.idempotencyKey,
        userId: user.id,
        productionOrderId: Number(req.body.productionOrderId),
        items: (req.body.items || []).map((i: any) => ({
          recipeId: Number(i.recipeId),
          quantityToProduce: Number(i.quantityToProduce),
          notes: i.notes || '',
        })),
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/production/return-or-waste', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      const result = await returnOrWasteOrderComponents({
        idempotencyKey: req.body.idempotencyKey,
        userId: user.id,
        productionOrderId: Number(req.body.productionOrderId),
        operationType: req.body.operationType,
        quantity: Number(req.body.quantity),
        reason: req.body.reason || '',
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  // =========================================================================
  // 7. FINISHED GOODS PICKUP & FORMAL RECEIPT
  // =========================================================================
  app.post('/api/finished-goods/dispatch', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      const result = await dispatchFinishedGoods({
        idempotencyKey: req.body.idempotencyKey,
        userId: user.id,
        productionOrderId: Number(req.body.productionOrderId),
        finishedProductId: Number(req.body.finishedProductId),
        toWarehouseId: Number(req.body.toWarehouseId),
        toLocationId: Number(req.body.toLocationId),
        dispatchQty: Number(req.body.dispatchQty),
        notes: req.body.notes,
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/finished-goods/receive', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      const result = await receiveFinishedGoods({
        idempotencyKey: req.body.idempotencyKey,
        userId: user.id,
        dispatchId: Number(req.body.dispatchId),
        receivedQty: Number(req.body.receivedQty),
        notes: req.body.notes,
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  // =========================================================================
  // 8. TRANSFERS & PHYSICAL COUNTS
  // =========================================================================
  app.post('/api/transfers/dispatch', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      const fromWarehouseId = Number(req.body.fromWarehouseId);
      if (!assertWarehouseAccess(user, fromWarehouseId, 'DISPATCH')) {
        await logSecurityEvent(
          user.id,
          user.username,
          'ACCESS_DENIED',
          '/api/transfers/dispatch',
          `Intento de despachar desde almacén ${fromWarehouseId} sin permiso.`
        );
        return res.status(403).json({
          error: 'No tiene permiso para despachar mercadería desde el almacén de origen.',
        });
      }

      const result = await createOrMoveWarehouseTransfer({
        idempotencyKey: req.body.idempotencyKey,
        userId: user.id,
        fromWarehouseId,
        fromLocationId: Number(req.body.fromLocationId),
        toWarehouseId: Number(req.body.toWarehouseId),
        toLocationId: Number(req.body.toLocationId),
        productId: Number(req.body.productId),
        quantity: Number(req.body.quantity),
        notes: req.body.notes,
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/transfers/receive', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      const result = await receiveWarehouseTransfer({
        idempotencyKey: req.body.idempotencyKey,
        userId: user.id,
        transferId: Number(req.body.transferId),
        receivedQty: Number(req.body.receivedQty),
        notes: req.body.notes,
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/counts/submit', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      const warehouseId = Number(req.body.warehouseId);
      if (!assertWarehouseAccess(user, warehouseId, 'COUNT')) {
        return res.status(403).json({
          error: 'No tiene permiso para registrar conteos físicos en este almacén.',
        });
      }

      const result = await submitPhysicalCount({
        idempotencyKey: req.body.idempotencyKey,
        userId: user.id,
        warehouseId,
        locationId: Number(req.body.locationId),
        productId: Number(req.body.productId),
        countedQty: Number(req.body.countedQty),
        isBlindCount: Boolean(req.body.isBlindCount),
        notes: req.body.notes,
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/counts/review', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        return res.status(403).json({
          error: 'Solo el Propietario o Administrador puede aprobar ajustes por diferencia de conteo físico.',
        });
      }

      const result = await approvePhysicalCountAdjustment({
        idempotencyKey: req.body.idempotencyKey,
        userId: user.id,
        countId: Number(req.body.countId),
        approve: Boolean(req.body.approve),
        reason: req.body.reason || 'Revisión de conteo físico',
      });
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  // =========================================================================
  // 9. OWNER PRIVATE ZONE (PURCHASES, LANDED COSTS & STRATEGIC CUSTODY)
  // Strictly protected by requireOwnerPrivateAccess
  // =========================================================================
  app.get('/api/private/overview', requireAuth, requireOwnerPrivateAccess, async (_req, res) => {
    try {
      const costBatches = await db
        .select()
        .from(privatePurchaseBatches)
        .orderBy(desc(privatePurchaseBatches.purchasedAt));

      const auditEvents = await db
        .select()
        .from(securityAuditEvents)
        .orderBy(desc(securityAuditEvents.createdAt));

      const invariantAudit = await runAccountingInvariantAudit();

      return res.json({
        privateCostBatches: costBatches,
        securityAuditEvents: auditEvents.slice(0, 100),
        invariantAudit,
      });
    } catch (error: any) {
      return res.status(500).json({ error: 'Error al consultar la Zona Privada del Propietario.' });
    }
  });

  app.post('/api/private/costs', requireAuth, requireOwnerPrivateAccess, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      const {
        batchCode,
        productId,
        supplierName,
        containerOrPolicyRef,
        quantityPurchased,
        currency,
        fobTotalCost,
        freightCost,
        customsPolicyCost,
        otherImportExpenses,
        privateNotes,
      } = req.body;

      const qty = Number(quantityPurchased);
      if (!qty || qty <= 0) {
        return res.status(400).json({ error: 'La cantidad comprada debe ser mayor a cero.' });
      }

      const fob = Number(fobTotalCost || 0);
      const freight = Number(freightCost || 0);
      const customs = Number(customsPolicyCost || 0);
      const other = Number(otherImportExpenses || 0);
      const totalLanded = fob + freight + customs + other;
      const unitLanded = totalLanded / qty;

      const [created] = await db
        .insert(privatePurchaseBatches)
        .values({
          batchCode: batchCode || `LOTE-PRIV-${Date.now().toString().slice(-6)}`,
          productId: Number(productId),
          supplierName: supplierName || 'Proveedor Internacional',
          containerOrPolicyRef: containerOrPolicyRef || '',
          quantityPurchased: qty,
          currency: currency || 'USD',
          fobTotalCost: fob.toFixed(4),
          freightCost: freight.toFixed(4),
          customsPolicyCost: customs.toFixed(4),
          otherImportExpenses: other.toFixed(4),
          totalLandedCost: totalLanded.toFixed(4),
          unitLandedCost: unitLanded.toFixed(6),
          privateNotes: privateNotes || '',
          createdByUserId: user.id,
        })
        .returning();

      return res.json({ batch: created });
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'No se pudo registrar el lote de costo privado.' });
    }
  });

  // =========================================================================
  // 10. USER & PERMISSION MANAGEMENT + AUTOMATED TEST SUITE RUNNER
  // =========================================================================
  app.post('/api/users/permissions', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER') {
        return res.status(403).json({
          error: 'Solo el Propietario puede modificar permisos de almacén o roles de usuarios.',
        });
      }

      const { targetUserId, warehouseId, canView, canReceive, canDispatch, canProduce, canCount } =
        req.body;

      const existing = await db
        .select()
        .from(userWarehousePermissions)
        .where(
          and(
            eq(userWarehousePermissions.userId, Number(targetUserId)),
            eq(userWarehousePermissions.warehouseId, Number(warehouseId))
          )
        );

      if (existing[0]) {
        const [updated] = await db
          .update(userWarehousePermissions)
          .set({
            canView: Boolean(canView),
            canReceive: Boolean(canReceive),
            canDispatch: Boolean(canDispatch),
            canProduce: Boolean(canProduce),
            canCount: Boolean(canCount),
          })
          .where(eq(userWarehousePermissions.id, existing[0].id))
          .returning();
        return res.json({ permission: updated });
      } else {
        const [inserted] = await db
          .insert(userWarehousePermissions)
          .values({
            userId: Number(targetUserId),
            warehouseId: Number(warehouseId),
            canView: Boolean(canView),
            canReceive: Boolean(canReceive),
            canDispatch: Boolean(canDispatch),
            canProduce: Boolean(canProduce),
            canCount: Boolean(canCount),
          })
          .returning();
        return res.json({ permission: inserted });
      }
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/Verification/run-suite', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        return res.status(403).json({
          error: 'Solo el Propietario o Administrador puede ejecutar la batería de pruebas de validación.',
        });
      }
      const suiteReport = await runAutomatedVerificationSuite();
      return res.json(suiteReport);
    } catch (error: any) {
      console.error('Error running verification suite:', error);
      return res.status(500).json({ error: error.message || 'Fallo al ejecutar la suite de pruebas.' });
    }
  });

  app.get('/api/verification/audit', requireAuth, async (_req, res) => {
    try {
      const auditReport = await runAccountingInvariantAudit();
      return res.json(auditReport);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  });

  // =========================================================================
  // VITE MIDDLEWARE FOR DEV / STATIC ASSETS FOR PROD
  // =========================================================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ControlStock Pro server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
