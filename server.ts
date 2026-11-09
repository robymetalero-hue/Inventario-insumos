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
  productCategories,
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
  type AuthRequest,
} from './src/middleware/auth.ts';
import {
  normalizeProductKey,
  registerGoodsReceipt,
  withdrawInventoryStock,
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
  runV2ScenarioVerification,
} from './src/db/inventory-engine.ts';
import {
  ensureBaseCatalogAndUsers,
  makeDefaultProductPhoto,
  resetAllInventoryToZeroForProduction,
} from './src/db/seed.ts';
import { eq, desc, and, inArray } from 'drizzle-orm';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '12mb' }));

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

  // =========================================================================
  // 2. AUTHENTICATION (admin / 1234 + Staff Accounts + Google Sign-In)
  // =========================================================================
  app.post('/api/auth/login', async (req, res) => {
    try {
      await ensureBaseCatalogAndUsers();
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ error: 'Ingrese su usuario y contraseña.' });
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
      res.json({ user: req.authUser });
    } catch (error: any) {
      res.status(500).json({ error: 'No se pudo cargar el perfil de sesión.' });
    }
  });

  // =========================================================================
  // 3. WORKSPACE DATA FILTERED BY WAREHOUSE PERMISSIONS
  // =========================================================================
  app.get('/api/workspace', requireAuth, async (req: AuthRequest, res) => {
    try {
      await ensureBaseCatalogAndUsers();
      const user = req.authUser!;
      const isGlobalAdmin = user.role === 'OWNER' || user.role === 'ADMIN';
      const allowedWarehouseIds = isGlobalAdmin
        ? null
        : user.warehousePermissions.filter((p) => p.canView).map((p) => p.warehouseId);

      const allWarehouses = await db.select().from(warehouses);
      const visibleWarehouses = isGlobalAdmin
        ? allWarehouses
        : allWarehouses.filter((w) => allowedWarehouseIds!.includes(w.id));

      const visibleWarehouseIdSet = new Set(visibleWarehouses.map((w) => w.id));

      const allLocations = await db.select().from(warehouseLocations);
      const visibleLocations = allLocations.filter((l) =>
        visibleWarehouseIdSet.has(l.warehouseId)
      );

      const categories = await db
        .select()
        .from(productCategories)
        .orderBy(productCategories.id);

      const allProducts = await db
        .select()
        .from(products)
        .orderBy(desc(products.createdAt));

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

      const rawBalances = await db.select().from(inventoryBalances);
      const visibleBalances = rawBalances.filter(
        (b) => b.quantity > 0 && visibleWarehouseIdSet.has(b.warehouseId)
      );

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
      const visibleCounts = rawCounts.filter((c) =>
        visibleWarehouseIdSet.has(c.warehouseId)
      );

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
        categories,
        products: allProducts,
        recipes: enrichedRecipes,
        balances: visibleBalances,
        productionOrders: visibleOrders,
        productionDispatches: visibleProdDispatches,
        productionBatches: visibleBatches,
        finishedGoodsDispatches: visibleFgDispatches,
        warehouseTransfers: visibleTransfers,
        physicalCounts: visibleCounts,
        movementDocuments: visibleDocs.slice(0, 500),
        movementLines: visibleLines.slice(0, 1500),
        usersPublic: allUsersPublic,
        userWarehousePermissions: allWarehousePerms,
        serverTimestamp: new Date().toISOString(),
      });
    } catch (error: any) {
      console.error('Workspace fetch error:', error);
      res.status(500).json({ error: error.message || 'Error al cargar datos del sistema.' });
    }
  });

  // =========================================================================
  // 4. CLASSIFICATIONS / DEPARTMENTS CRUD (Crear, Editar, Eliminar)
  // =========================================================================
  app.post('/api/categories', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Solo el Administrador puede crear clasificaciones.' });
      }
      const { name, accountingType, description, colorHex } = req.body;
      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'El nombre de la clasificación es obligatorio.' });
      }

      const [created] = await db
        .insert(productCategories)
        .values({
          name: String(name).trim(),
          accountingType: accountingType || 'SECONDARY_COMPONENT',
          description: description || '',
          colorHex: colorHex || '#0284c7',
        })
        .returning();

      return res.json({ category: created });
    } catch (error: any) {
      return res.status(400).json({ error: 'Ya existe una clasificación con ese nombre o datos inválidos.' });
    }
  });

  app.put('/api/categories/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Solo el Administrador puede editar clasificaciones.' });
      }
      const catId = Number(req.params.id);
      const { name, accountingType, description, colorHex } = req.body;

      const existing = await db
        .select()
        .from(productCategories)
        .where(eq(productCategories.id, catId));
      if (!existing[0]) {
        return res.status(404).json({ error: 'Clasificación no encontrada.' });
      }

      const oldName = existing[0].name;
      const newName = String(name || oldName).trim();
      const newAccType = accountingType || existing[0].accountingType;

      const [updated] = await db
        .update(productCategories)
        .set({
          name: newName,
          accountingType: newAccType,
          description: description !== undefined ? description : existing[0].description,
          colorHex: colorHex || existing[0].colorHex,
        })
        .where(eq(productCategories.id, catId))
        .returning();

      // Also sync products using this classification name
      if (oldName !== newName || newAccType !== existing[0].accountingType) {
        await db
          .update(products)
          .set({
            family: newName,
            productType: newAccType,
          })
          .where(eq(products.family, oldName));
      }

      return res.json({ category: updated });
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'No se pudo actualizar la clasificación.' });
    }
  });

  app.delete('/api/categories/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Solo el Administrador puede eliminar clasificaciones.' });
      }
      const catId = Number(req.params.id);
      await db.delete(productCategories).where(eq(productCategories.id, catId));
      return res.json({ deleted: true });
    } catch (error: any) {
      return res.status(400).json({ error: 'No se pudo eliminar la clasificación.' });
    }
  });

  // =========================================================================
  // 5. SIMPLIFIED PRODUCTS CRUD (Crear con Cantidad Inicial, Editar, Eliminar)
  // =========================================================================
  app.post('/api/products', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        return res.status(403).json({
          error: 'Solo el Administrador puede crear productos en el catálogo.',
        });
      }

      const {
        sku,
        name,
        family,
        productType,
        brand,
        model,
        capacity,
        color,
        unitName,
        imageUrl,
        minStockAlert,
        initialQuantity,
        initialWarehouseId,
        initialLocationId,
      } = req.body;

      if (!sku || !name || !family) {
        return res.status(400).json({
          error: 'Complete el SKU, la descripción del producto y su clasificación.',
        });
      }

      const cleanSku = String(sku).trim().toUpperCase();
      const cleanName = String(name).trim();
      const existingAll = await db.select().from(products);
      if (existingAll.some((p) => p.sku.toUpperCase() === cleanSku)) {
        return res.status(400).json({ error: `Ya existe un producto con el SKU ${cleanSku}.` });
      }

      // Look up category accounting type if not explicitly provided
      let resolvedType = productType;
      if (!resolvedType) {
        const cats = await db
          .select()
          .from(productCategories)
          .where(eq(productCategories.name, String(family)));
        resolvedType = cats[0]?.accountingType || 'SECONDARY_COMPONENT';
      }

      const finalPhoto =
        imageUrl && String(imageUrl).trim() !== ''
          ? String(imageUrl)
          : makeDefaultProductPhoto(cleanSku, cleanName);

      const cleanBrand = brand ? String(brand).trim() : String(family).trim();
      const cleanModel = model ? String(model).trim() : 'Estándar';
      const cleanCapacity = capacity ? String(capacity).trim() : 'N/A';
      const cleanColor = color ? String(color).trim() : 'N/A';

      const [created] = await db
        .insert(products)
        .values({
          sku: cleanSku,
          name: cleanName,
          normalizedKey: normalizeProductKey(cleanBrand, cleanName, cleanCapacity, cleanColor, ''),
          description: cleanName,
          productType: resolvedType,
          family: String(family).trim(),
          brand: cleanBrand,
          model: cleanModel,
          capacity: cleanCapacity,
          color: cleanColor,
          material: 'N/A',
          unitName: unitName ? String(unitName).trim() : 'unidades',
          unitsPerBox: 1000,
          imageUrl: finalPhoto,
          barcode: '',
          minStockAlert: Number(minStockAlert) || 100,
          isActive: true,
        })
        .returning();

      // If the user specified an initial quantity > 0, register the opening stock immediately!
      const initQty = Number(initialQuantity || 0);
      if (initQty > 0) {
        const allWhs = await db.select().from(warehouses);
        const targetWhId = Number(initialWarehouseId) || allWhs[0]?.id;
        const allLocs = await db.select().from(warehouseLocations);
        const targetLocId =
          Number(initialLocationId) ||
          allLocs.find((l) => l.warehouseId === targetWhId)?.id ||
          allLocs[0]?.id;

        if (targetWhId && targetLocId) {
          await registerGoodsReceipt({
            idempotencyKey: `INIT-STOCK-${created.id}-${Date.now()}`,
            userId: user.id,
            movementType: 'APERTURA_INICIAL',
            warehouseId: targetWhId,
            locationId: targetLocId,
            supplierOrContainer: 'Inventario Inicial al Crear Producto',
            notes: `Stock inicial de ${cleanName}`,
            lines: [{ productId: created.id, quantity: initQty }],
          });
        }
      }

      return res.json({ product: created });
    } catch (error: any) {
      return res.status(500).json({ error: error.message || 'No se pudo crear el producto.' });
    }
  });

  app.put('/api/products/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Solo el Administrador puede editar productos.' });
      }

      const prodId = Number(req.params.id);
      const {
        sku,
        name,
        family,
        productType,
        brand,
        model,
        capacity,
        color,
        unitName,
        imageUrl,
        minStockAlert,
      } = req.body;

      const existing = await db.select().from(products).where(eq(products.id, prodId));
      if (!existing[0]) {
        return res.status(404).json({ error: 'Producto no encontrado.' });
      }

      let resolvedType = productType || existing[0].productType;
      if (family && !productType) {
        const cats = await db
          .select()
          .from(productCategories)
          .where(eq(productCategories.name, String(family)));
        if (cats[0]) resolvedType = cats[0].accountingType;
      }

      const cleanSku = sku ? String(sku).trim().toUpperCase() : existing[0].sku;
      const cleanName = name ? String(name).trim() : existing[0].name;
      const cleanFamily = family ? String(family).trim() : existing[0].family;
      const cleanBrand = brand !== undefined ? String(brand).trim() : existing[0].brand;
      const cleanModel = model !== undefined ? String(model).trim() : existing[0].model;
      const cleanCapacity = capacity !== undefined ? String(capacity).trim() : existing[0].capacity;
      const cleanColor = color !== undefined ? String(color).trim() : existing[0].color;

      const [updated] = await db
        .update(products)
        .set({
          sku: cleanSku,
          name: cleanName,
          description: cleanName,
          family: cleanFamily,
          brand: cleanBrand || cleanFamily,
          model: cleanModel || 'Estándar',
          capacity: cleanCapacity || 'N/A',
          color: cleanColor || 'N/A',
          unitName: unitName ? String(unitName).trim() : existing[0].unitName,
          productType: resolvedType,
          minStockAlert:
            minStockAlert !== undefined ? Number(minStockAlert) : existing[0].minStockAlert,
          imageUrl:
            imageUrl && String(imageUrl).trim() !== '' ? String(imageUrl) : existing[0].imageUrl,
        })
        .where(eq(products.id, prodId))
        .returning();

      return res.json({ product: updated });
    } catch (error: any) {
      return res.status(400).json({ error: error.message || 'No se pudo actualizar el producto.' });
    }
  });

  app.delete('/api/products/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Solo el Administrador puede eliminar productos.' });
      }

      const prodId = Number(req.params.id);

      // Clean up all direct and transitive dependent records in a transaction
      await db.transaction(async (tx) => {
        await tx.delete(privatePurchaseBatches).where(eq(privatePurchaseBatches.productId, prodId));
        await tx.delete(physicalCounts).where(eq(physicalCounts.productId, prodId));
        await tx.delete(warehouseTransfers).where(eq(warehouseTransfers.productId, prodId));

        // 1. Orders where this product is the strategic component
        const ordersForProd = await tx
          .select()
          .from(productionOrders)
          .where(eq(productionOrders.strategicProductId, prodId));
        const orderIds = ordersForProd.map((o) => o.id);

        if (orderIds.length > 0) {
          await tx
            .delete(finishedGoodsDispatches)
            .where(inArray(finishedGoodsDispatches.productionOrderId, orderIds));
          await tx
            .delete(productionDispatches)
            .where(inArray(productionDispatches.productionOrderId, orderIds));
          await tx
            .delete(productionBatches)
            .where(inArray(productionBatches.productionOrderId, orderIds));
          await tx
            .delete(productionOrders)
            .where(inArray(productionOrders.id, orderIds));
        }

        // 2. Direct dispatches & batches for this product
        await tx
          .delete(finishedGoodsDispatches)
          .where(eq(finishedGoodsDispatches.finishedProductId, prodId));
        await tx.delete(productionDispatches).where(eq(productionDispatches.productId, prodId));
        await tx
          .delete(productionBatches)
          .where(eq(productionBatches.finishedProductId, prodId));

        // 3. Recipe components where this product is used
        await tx
          .delete(recipeComponents)
          .where(eq(recipeComponents.componentProductId, prodId));

        // 4. Recipes & RecipeVersions that produce this product
        const prodRecipes = await tx
          .select()
          .from(recipes)
          .where(eq(recipes.finishedProductId, prodId));
        const prodVerRows = await tx
          .select()
          .from(recipeVersions)
          .where(eq(recipeVersions.finishedProductId, prodId));

        const recipeIdsSet = new Set<number>([
          ...prodRecipes.map((r) => r.id),
          ...prodVerRows.map((v) => v.recipeId),
        ]);
        const recipeIds = Array.from(recipeIdsSet);

        if (recipeIds.length > 0) {
          const allVers = await tx
            .select()
            .from(recipeVersions)
            .where(inArray(recipeVersions.recipeId, recipeIds));
          const verIds = allVers.map((v) => v.id);
          if (verIds.length > 0) {
            await tx
              .delete(recipeComponents)
              .where(inArray(recipeComponents.recipeVersionId, verIds));
            await tx
              .delete(productionBatches)
              .where(inArray(productionBatches.recipeVersionId, verIds));
          }
          await tx
            .delete(productionBatches)
            .where(inArray(productionBatches.recipeId, recipeIds));
          await tx
            .delete(recipeVersions)
            .where(inArray(recipeVersions.recipeId, recipeIds));
          await tx.delete(recipes).where(inArray(recipes.id, recipeIds));
        }

        // 5. Ledger lines, balances & the product itself
        await tx.delete(inventoryMovementLines).where(eq(inventoryMovementLines.productId, prodId));
        await tx.delete(inventoryBalances).where(eq(inventoryBalances.productId, prodId));
        await tx.delete(products).where(eq(products.id, prodId));
      });

      return res.json({ deleted: true, productId: prodId });
    } catch (error: any) {
      console.error('Error deleting product:', error);
      return res.status(400).json({ error: error.message || 'No se pudo eliminar el producto.' });
    }
  });

  // =========================================================================
  // 6. RECIPES (BOM) & WAREHOUSES CRUD (Crear, Editar, Eliminar)
  // =========================================================================
  app.post('/api/recipes', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        return res.status(403).json({
          error: 'Solo el Administrador puede crear o editar recetas de ensamblaje.',
        });
      }

      const { recipeId, code, name, finishedProductId, changeReason, components } = req.body;
      if (!components || !Array.isArray(components) || components.length === 0) {
        return res.status(400).json({ error: 'La receta debe incluir al menos un insumo.' });
      }

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
            finishedProductId: Number(finishedProductId || rec.finishedProductId),
            isCurrent: true,
            changeReason: changeReason || `Actualización v${nextVerNum}`,
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
          .set({
            currentVersion: nextVerNum,
            name: name || rec.name,
            finishedProductId: Number(finishedProductId || rec.finishedProductId),
          })
          .where(eq(recipes.id, rec.id));

        return res.json({ recipeId: rec.id, newVersion: newVer });
      } else {
        const [newRec] = await db
          .insert(recipes)
          .values({
            code: String(code || `REC-${Date.now().toString().slice(-4)}`)
              .trim()
              .toUpperCase(),
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

  app.delete('/api/recipes/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Solo el Administrador puede eliminar recetas.' });
      }
      const recId = Number(req.params.id);
      await db.transaction(async (tx) => {
        const vers = await tx
          .select()
          .from(recipeVersions)
          .where(eq(recipeVersions.recipeId, recId));
        for (const v of vers) {
          await tx
            .delete(recipeComponents)
            .where(eq(recipeComponents.recipeVersionId, v.id));
        }
        await tx.delete(productionBatches).where(eq(productionBatches.recipeId, recId));
        await tx.delete(recipeVersions).where(eq(recipeVersions.recipeId, recId));
        await tx.delete(recipes).where(eq(recipes.id, recId));
      });
      return res.json({ deleted: true });
    } catch (error: any) {
      return res.status(400).json({ error: 'No se pudo eliminar la receta.' });
    }
  });

  app.post('/api/warehouses', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Solo el Administrador puede configurar almacenes.' });
      }

      const {
        type,
        code,
        name,
        description,
        address,
        isProductionPlant,
        warehouseId,
        zoneName,
        shelfName,
      } = req.body;

      if (type === 'LOCATION') {
        const [loc] = await db
          .insert(warehouseLocations)
          .values({
            warehouseId: Number(warehouseId),
            code: String(code || `UBI-${Date.now().toString().slice(-4)}`)
              .trim()
              .toUpperCase(),
            zoneName: String(zoneName).trim(),
            shelfName: String(shelfName).trim(),
            description: description || '',
            isDefault: false,
            isActive: true,
          })
          .returning();
        return res.json({ location: loc });
      } else {
        const cleanCode = String(code || `ALM-${Date.now().toString().slice(-4)}`)
          .trim()
          .toUpperCase();
        const [wh] = await db
          .insert(warehouses)
          .values({
            code: cleanCode,
            name: String(name).trim(),
            description: description || '',
            address: address || '',
            isProductionPlant: Boolean(isProductionPlant),
            isActive: true,
          })
          .returning();

        await db.insert(warehouseLocations).values({
          warehouseId: wh.id,
          code: `${wh.code}-PRIN`,
          zoneName: 'Sección Principal',
          shelfName: 'Estante 1',
          description: 'Ubicación principal predeterminada',
          isDefault: true,
          isActive: true,
        });

        return res.json({ warehouse: wh });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Error al configurar almacén/ubicación.' });
    }
  });

  app.delete('/api/warehouses/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Solo el Administrador puede eliminar almacenes.' });
      }
      const whId = Number(req.params.id);
      await db.transaction(async (tx) => {
        // Clean up orders associated with this warehouse
        const ordersInWh = await tx
          .select()
          .from(productionOrders);
        const orderIds = ordersInWh
          .filter((o) => o.sourceWarehouseId === whId || o.targetWarehouseId === whId)
          .map((o) => o.id);

        if (orderIds.length > 0) {
          await tx
            .delete(productionBatches)
            .where(inArray(productionBatches.productionOrderId, orderIds));
          await tx
            .delete(productionDispatches)
            .where(inArray(productionDispatches.productionOrderId, orderIds));
          await tx
            .delete(finishedGoodsDispatches)
            .where(inArray(finishedGoodsDispatches.productionOrderId, orderIds));
          await tx
            .delete(productionOrders)
            .where(inArray(productionOrders.id, orderIds));
        }

        await tx
          .delete(productionBatches)
          .where(eq(productionBatches.warehouseId, whId));
        await tx
          .delete(finishedGoodsDispatches)
          .where(eq(finishedGoodsDispatches.fromWarehouseId, whId));
        await tx
          .delete(finishedGoodsDispatches)
          .where(eq(finishedGoodsDispatches.toWarehouseId, whId));
        await tx
          .delete(warehouseTransfers)
          .where(eq(warehouseTransfers.fromWarehouseId, whId));
        await tx
          .delete(warehouseTransfers)
          .where(eq(warehouseTransfers.toWarehouseId, whId));
        await tx
          .delete(physicalCounts)
          .where(eq(physicalCounts.warehouseId, whId));
        const docsInWh = await tx.select().from(inventoryMovementDocuments);
        const docIds = docsInWh
          .filter((d) => d.sourceWarehouseId === whId || d.destWarehouseId === whId)
          .map((d) => d.id);

        if (docIds.length > 0) {
          await tx
            .delete(privatePurchaseBatches)
            .where(inArray(privatePurchaseBatches.movementDocumentId, docIds));
          await tx
            .delete(inventoryMovementLines)
            .where(inArray(inventoryMovementLines.documentId, docIds));
        }

        await tx
          .delete(inventoryMovementLines)
          .where(eq(inventoryMovementLines.fromWarehouseId, whId));
        await tx
          .delete(inventoryMovementLines)
          .where(eq(inventoryMovementLines.toWarehouseId, whId));
        await tx
          .delete(inventoryMovementDocuments)
          .where(eq(inventoryMovementDocuments.sourceWarehouseId, whId));
        await tx
          .delete(inventoryMovementDocuments)
          .where(eq(inventoryMovementDocuments.destWarehouseId, whId));
        await tx
          .delete(userWarehousePermissions)
          .where(eq(userWarehousePermissions.warehouseId, whId));
        await tx
          .delete(inventoryBalances)
          .where(eq(inventoryBalances.warehouseId, whId));
        await tx
          .delete(warehouseLocations)
          .where(eq(warehouseLocations.warehouseId, whId));
        await tx
          .delete(warehouses)
          .where(eq(warehouses.id, whId));
      });
      return res.json({ deleted: true });
    } catch (error: any) {
      return res.status(400).json({
        error: error.message || 'No se pudo eliminar el almacén.',
      });
    }
  });

  app.delete('/api/warehouses/locations/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Solo el Administrador puede eliminar ubicaciones.' });
      }
      const locId = Number(req.params.id);
      await db.transaction(async (tx) => {
        await tx
          .delete(inventoryBalances)
          .where(eq(inventoryBalances.locationId, locId));
        await tx
          .delete(warehouseLocations)
          .where(eq(warehouseLocations.id, locId));
      });
      return res.json({ deleted: true });
    } catch (error: any) {
      return res.status(400).json({
        error: 'No se puede eliminar un estante con historial de operaciones.',
      });
    }
  });

  // =========================================================================
  // 7. GOODS RECEIPT (INGRESAR) & WITHDRAWAL (RETIRAR) OPERATIONS
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
        reason,
        notes,
        lines,
      } = req.body;

      if (!assertWarehouseAccess(user, Number(warehouseId), 'RECEIVE')) {
        return res.status(403).json({
          error: 'No tiene permiso para registrar ingresos en el almacén seleccionado.',
        });
      }

      const validTypes = [
        'INGRESO_PROVEEDOR',
        'DEVOLUCION_INSUMOS',
        'REGULARIZACION_AUTORIZADA',
        'APERTURA_INICIAL',
      ];
      const resolvedMovementType = validTypes.includes(movementType)
        ? movementType
        : 'INGRESO_PROVEEDOR';

      if (
        resolvedMovementType === 'REGULARIZACION_AUTORIZADA' &&
        user.role !== 'OWNER' &&
        user.role !== 'ADMIN'
      ) {
        return res.status(403).json({
          error: 'Solo el Propietario o Administrador puede autorizar ingresos por regularización.',
        });
      }

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
        movementType: resolvedMovementType,
        warehouseId: Number(warehouseId),
        locationId: Number(locationId),
        supplierOrContainer: supplierOrContainer || '',
        reason: reason || '',
        notes: notes || '',
        lines: sanitizedLines,
      });

      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/inventory/withdrawals', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      const {
        idempotencyKey,
        warehouseId,
        locationId,
        productId,
        quantity,
        withdrawalMode,
        productionOrderId,
        toWarehouseId,
        toLocationId,
        recipientOrTarget,
        reason,
        notes,
      } = req.body;

      const whIdNum = Number(warehouseId);
      const canOperateWh =
        assertWarehouseAccess(user, whIdNum, 'DISPATCH') ||
        assertWarehouseAccess(user, whIdNum, 'PRODUCE');

      if (!canOperateWh) {
        return res.status(403).json({
          error: 'No tiene permiso para retirar productos o insumos de este almacén.',
        });
      }

      // If withdrawalMode is TRANSFERENCIA_ALMACEN, route to audited transfer engine
      if (withdrawalMode === 'TRANSFERENCIA_ALMACEN') {
        if (!toWarehouseId || !toLocationId) {
          return res.status(400).json({
            error: 'Seleccione el almacén y ubicación destino para la transferencia.',
          });
        }
        const trResult = await createOrMoveWarehouseTransfer({
          idempotencyKey,
          userId: user.id,
          fromWarehouseId: whIdNum,
          fromLocationId: Number(locationId),
          toWarehouseId: Number(toWarehouseId),
          toLocationId: Number(toLocationId),
          productId: Number(productId),
          quantity: Number(quantity),
          notes: reason || notes || 'Transferencia desde botón Retirar',
        });
        return res.json(trResult);
      }

      if (
        (withdrawalMode === 'CONSUMO_OPERATIVO' || withdrawalMode === 'MERMA_DANO') &&
        user.role !== 'OWNER' &&
        user.role !== 'ADMIN' &&
        user.role !== 'WAREHOUSE_MANAGER'
      ) {
        return res.status(403).json({
          error:
            'Los retiros por consumo operativo o merma requieren autorización de Administrador o Encargado de Almacén.',
        });
      }

      const result = await withdrawInventoryStock({
        idempotencyKey,
        userId: user.id,
        warehouseId: whIdNum,
        locationId: Number(locationId),
        productId: Number(productId),
        quantity: Number(quantity),
        withdrawalMode:
          withdrawalMode === 'CONSUMO_OPERATIVO'
            ? 'CONSUMO_OPERATIVO'
            : withdrawalMode === 'MERMA_DANO'
            ? 'MERMA_DANO'
            : 'ORDEN_PRODUCCION',
        productionOrderId: productionOrderId ? Number(productionOrderId) : undefined,
        recipientOrTarget: recipientOrTarget || '',
        reason: reason || '',
        notes: notes || '',
      });

      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  });

  // =========================================================================
  // 8. PRODUCTION ORDERS, DISPATCHES, ACKNOWLEDGEMENTS & BATCHES (RECIPE-FREE)
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
        assignedUserId: Number(req.body.assignedUserId || user.id),
        strategicProductId: Number(req.body.strategicProductId),
        authorizedQty: Number(req.body.authorizedQty),
        allowedRecipeIds: [],
        priority: req.body.priority || 'NORMAL',
        instructions: req.body.instructions || '',
        autoDispatch: req.body.autoDispatch !== false,
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
          finishedProductId: Number(i.finishedProductId),
          quantityProduced: Number(i.quantityProduced ?? i.quantityToProduce),
          strategicQtyConsumed:
            i.strategicQtyConsumed !== undefined
              ? Number(i.strategicQtyConsumed)
              : Number(i.quantityProduced ?? i.quantityToProduce),
          usedWithdrawalFolios: Array.isArray(i.usedWithdrawalFolios)
            ? i.usedWithdrawalFolios
            : [],
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
  // 9. FINISHED GOODS PICKUP & TRANSFERS & COUNTS
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
        autoReceive: Boolean(req.body.autoReceive),
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

  app.post('/api/transfers/dispatch', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      const fromWarehouseId = Number(req.body.fromWarehouseId);
      if (!assertWarehouseAccess(user, fromWarehouseId, 'DISPATCH')) {
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
          error: 'Solo el Propietario o Administrador puede aprobar ajustes por conteo.',
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
  // 10. OWNER PRIVATE ZONE & USER MANAGEMENT
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

  app.post('/api/users', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER' && user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Solo el Administrador puede crear usuarios.' });
      }
      const { username, password, fullName, role, warehouseId } = req.body;
      if (!username || !password || !fullName) {
        return res.status(400).json({ error: 'Complete usuario, contraseña y nombre completo.' });
      }
      const cleanU = String(username).trim().toLowerCase();
      const [newUser] = await db
        .insert(users)
        .values({
          uid: `local_${cleanU}_${Date.now()}`,
          username: cleanU,
          email: `${cleanU}@controlstock.bo`,
          fullName: String(fullName).trim(),
          role: role || 'WAREHOUSE_MANAGER',
          passwordHash: hashPassword(String(password)),
          isActive: true,
          canViewPrivateCosts: role === 'OWNER',
        })
        .returning();

      if (warehouseId) {
        await db.insert(userWarehousePermissions).values({
          userId: newUser.id,
          warehouseId: Number(warehouseId),
          canView: true,
          canReceive: true,
          canDispatch: true,
          canProduce: true,
          canCount: true,
          canApproveAdjustments: role === 'OWNER',
        });
      }

      return res.json({ user: newUser });
    } catch (error: any) {
      return res.status(400).json({ error: 'El nombre de usuario ya existe o los datos son inválidos.' });
    }
  });

  app.delete('/api/users/:id', requireAuth, async (req: AuthRequest, res) => {
    try {
      const user = req.authUser!;
      if (user.role !== 'OWNER') {
        return res.status(403).json({ error: 'Solo el Propietario puede eliminar usuarios.' });
      }
      const targetId = Number(req.params.id);
      if (targetId === user.id) {
        return res.status(400).json({ error: 'No puede eliminar su propio usuario administrador.' });
      }
      await db
        .delete(userWarehousePermissions)
        .where(eq(userWarehousePermissions.userId, targetId));
      await db.delete(users).where(eq(users.id, targetId));
      return res.json({ deleted: true });
    } catch (error: any) {
      return res.status(400).json({ error: 'No se puede eliminar un usuario con historial de movimientos.' });
    }
  });

  app.post('/api/admin/reset-inventory', requireAuth, requireOwnerPrivateAccess, async (_req, res) => {
    try {
      await resetAllInventoryToZeroForProduction();
      return res.json({ reset: true });
    } catch (error: any) {
      return res.status(500).json({ error: 'No se pudo reiniciar el inventario.' });
    }
  });

  app.post('/api/admin/verify-v2-scenarios', requireAuth, requireOwnerPrivateAccess, async (req: AuthRequest, res) => {
    try {
      const report = await runV2ScenarioVerification(req.authUser!.id);
      return res.json(report);
    } catch (error: any) {
      console.error('Verification error:', error);
      return res.status(500).json({ error: error.message || 'Error en la verificación aislada.' });
    }
  });

  // =========================================================================
  // VITE MIDDLEWARE FOR DEV / STATIC ASSETS FOR PROD
  // =========================================================================
  const distPath = path.join(process.cwd(), 'dist');
  const fs = await import('fs');
  if (process.env.NODE_ENV === 'production' && fs.existsSync(path.join(distPath, 'index.html'))) {
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, watch: null },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ControlStock Pro server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
