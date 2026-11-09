import { db } from './index.ts';
import {
  users,
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
import { runAccountingInvariantAudit } from './inventory-engine.ts';
import { eq } from 'drizzle-orm';

export function makeDefaultProductPhoto(
  title: string,
  subtitle: string,
  bgHex = '#0f172a',
  accentHex = '#38bdf8'
): string {
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
  await db.delete(productCategories);
}

export async function ensureBaseCatalogAndUsers() {
  // Ensure primary 'admin' user with password '1234' exists and is OWNER.
  // Never auto-recreate deleted categories, products, or warehouses!
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
