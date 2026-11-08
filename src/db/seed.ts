import { db } from './index.ts';
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
  idempotencyKeys,
} from './schema.ts';
import { hashPassword } from '../middleware/auth.ts';
import {
  normalizeProductKey,
  registerGoodsReceipt,
  createProductionOrderWithReservation,
  dispatchProductionOrderComponents,
  acknowledgeProductionDispatch,
  registerProductionBatches,
  dispatchFinishedGoods,
  receiveFinishedGoods,
  runAccountingInvariantAudit,
} from './inventory-engine.ts';
import { eq } from 'drizzle-orm';

export function makeDefaultProductPhoto(title: string, subtitle: string, bgHex = '#0f172a', accentHex = '#38bdf8'): string {
  const safeTitle = (title || 'PRODUCTO').slice(0, 18);
  const safeSub = (subtitle || 'Inventario').slice(0, 28);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="280" viewBox="0 0 400 280">
    <rect width="400" height="280" rx="14" fill="${bgHex}"/>
    <rect x="24" y="24" width="352" height="232" rx="10" fill="#ffffff" fill-opacity="0.06" stroke="${accentHex}" stroke-width="1.5"/>
    <rect x="150" y="54" width="100" height="68" rx="8" fill="${accentHex}" fill-opacity="0.2" stroke="${accentHex}" stroke-width="2"/>
    <line x1="172" y1="72" x2="172" y2="104" stroke="${accentHex}" stroke-width="3"/>
    <line x1="191" y1="72" x2="191" y2="104" stroke="${accentHex}" stroke-width="3"/>
    <line x1="210" y1="72" x2="210" y2="104" stroke="${accentHex}" stroke-width="3"/>
    <line x1="229" y1="72" x2="229" y2="104" stroke="${accentHex}" stroke-width="3"/>
    <text x="200" y="168" text-anchor="middle" font-family="monospace" font-weight="700" font-size="20" fill="#ffffff">${safeTitle}</text>
    <text x="200" y="198" text-anchor="middle" font-family="sans-serif" font-weight="500" font-size="14" fill="#cbd5e1">${safeSub}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

let productionCleanPerformed = false;

export async function resetAllInventoryToZeroForProduction() {
  await db.delete(privatePurchaseBatches);
  await db.delete(productionBatches);
  await db.delete(productionDispatches);
  await db.delete(finishedGoodsDispatches);
  await db.delete(warehouseTransfers);
  await db.delete(physicalCounts);
  await db.delete(productionOrders);
  await db.delete(inventoryMovementLines);
  await db.delete(inventoryMovementDocuments);
  await db.delete(inventoryBalances);
  await db.delete(idempotencyKeys);
  await db.delete(recipeComponents);
  await db.delete(recipeVersions);
  await db.delete(recipes);
  await db.delete(products);
}

export async function ensureBaseCatalogAndUsers() {
  // 1. Ensure primary 'admin' user with password '1234' exists and is OWNER
  const adminPassHash = hashPassword('1234');
  const existingAdmin = await db
    .select()
    .from(users)
    .where(eq(users.username, 'admin'));

  if (existingAdmin.length === 0) {
    await db.insert(users).values({
      uid: 'local_admin_principal',
      username: 'admin',
      email: 'robymetalero@gmail.com',
      fullName: 'Administrador Principal (Propietario)',
      role: 'OWNER',
      passwordHash: adminPassHash,
      isActive: true,
      canViewPrivateCosts: true,
    });
  } else {
    await db
      .update(users)
      .set({
        passwordHash: adminPassHash,
        role: 'OWNER',
        isActive: true,
        canViewPrivateCosts: true,
      })
      .where(eq(users.username, 'admin'));
  }

  // 2. Ensure Default Customizable Classifications / Departments exist
  const existingCategories = await db.select().from(productCategories);
  if (existingCategories.length === 0) {
    await db.insert(productCategories).values([
      {
        name: 'Chips UDP',
        accountingType: 'STRATEGIC_COMPONENT',
        description: 'Chips de memoria USB UDP (8 GB, 16 GB, 32 GB, etc.) bajo control estratégico',
        colorHex: '#0284c7',
      },
      {
        name: 'Memorias microSD',
        accountingType: 'STRATEGIC_COMPONENT',
        description: 'Memorias microSD crudas por capacidad para empaquetado',
        colorHex: '#7c3aed',
      },
      {
        name: 'Cases',
        accountingType: 'SECONDARY_COMPONENT',
        description: 'Carcasas o cases USB metálicos, de goma o plástico',
        colorHex: '#475569',
      },
      {
        name: 'Empaques',
        accountingType: 'PACKAGING_KIT',
        description: 'Kits de empaque compuestos (cartón/papel + blíster plástico)',
        colorHex: '#d97706',
      },
      {
        name: 'Adaptadores',
        accountingType: 'UNIVERSAL_ACCESSORY',
        description: 'Adaptadores SD universales y accesorios de ensamblaje',
        colorHex: '#0d9488',
      },
      {
        name: 'Producto Terminado',
        accountingType: 'FINISHED_GOOD',
        description: 'Memorias USB y microSD ensambladas y empaquetadas listas para entrega',
        colorHex: '#16a34a',
      },
    ]);

    // First-time transition to production: wipe previous demo/test stock so inventory starts 100% clean at 0
    if (!productionCleanPerformed) {
      await resetAllInventoryToZeroForProduction();
      productionCleanPerformed = true;
    }
    // 3. Ensure Base Warehouses & Default Locations exist on initial setup
    const existingWarehouses = await db.select().from(warehouses);
    if (existingWarehouses.length === 0) {
      const insertedWarehouses = await db
        .insert(warehouses)
        .values([
          {
            code: 'ALM-SENCATA',
            name: 'Sencata',
            description: 'Almacén Central de Recepción y Custodia',
            address: 'Zona Sencata, El Alto',
            isProductionPlant: false,
          },
          {
            code: 'ALM-VILLADOLORES',
            name: 'Villa Dolores',
            description: 'Planta de Ensamblaje, Empaquetado y Producción',
            address: 'Zona Villa Dolores, El Alto',
            isProductionPlant: true,
          },
          {
            code: 'ALM-PUENTEBOLIVIA',
            name: 'Puente Bolivia',
            description: 'Almacén de Recepción de Productos Terminados',
            address: 'Puente Bolivia, El Alto',
            isProductionPlant: false,
          },
        ])
        .returning();

      for (const wh of insertedWarehouses) {
        await db.insert(warehouseLocations).values({
          warehouseId: wh.id,
          code: `${wh.code}-PRIN`,
          zoneName: 'Sección Principal',
          shelfName: 'Estante 1',
          description: 'Ubicación principal predeterminada',
          isDefault: true,
          isActive: true,
        });
      }
    }
  }

  return { ready: true };
}

export async function runAutomatedVerificationSuite() {
  const auditReport = await runAccountingInvariantAudit();
  return {
    allPassed: auditReport.isHealthy,
    testResults: [],
    auditReport,
  };
}
