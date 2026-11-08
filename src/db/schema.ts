import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  jsonb,
} from 'drizzle-orm/pg-core';

// 1. Users & Authentication
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase UID or local_<username>
  username: text('username').notNull().unique(),
  email: text('email').notNull(),
  fullName: text('full_name').notNull(),
  role: text('role').notNull(), // OWNER | ADMIN | WAREHOUSE_MANAGER | PRODUCTION_MANAGER | OPERATOR | AUDITOR
  passwordHash: text('password_hash'),
  isActive: boolean('is_active').notNull().default(true),
  canViewPrivateCosts: boolean('can_view_private_costs').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 2. Warehouses & Locations
export const warehouses = pgTable('warehouses', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(), // e.g., Sencata, Villa Dolores, Puente Bolivia
  description: text('description').notNull().default(''),
  address: text('address').notNull().default(''),
  isProductionPlant: boolean('is_production_plant').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const warehouseLocations = pgTable('warehouse_locations', {
  id: serial('id').primaryKey(),
  warehouseId: integer('warehouse_id').notNull().references(() => warehouses.id),
  code: text('code').notNull(), // e.g., SEC-K-EST-2
  zoneName: text('zone_name').notNull(), // e.g., Sección K / Cuarto de Empaques
  shelfName: text('shelf_name').notNull(), // e.g., Estante 2
  description: text('description').notNull().default(''),
  isDefault: boolean('is_default').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
});

// 3. Granular Permissions per Warehouse
export const userWarehousePermissions = pgTable('user_warehouse_permissions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id),
  warehouseId: integer('warehouse_id').notNull().references(() => warehouses.id),
  canView: boolean('can_view').notNull().default(true),
  canReceive: boolean('can_receive').notNull().default(false),
  canDispatch: boolean('can_dispatch').notNull().default(false),
  canProduce: boolean('can_produce').notNull().default(false),
  canCount: boolean('can_count').notNull().default(false),
  canApproveAdjustments: boolean('can_approve_adjustments').notNull().default(false),
});

// 3b. Dynamic Product Classifications / Departments (Empaques, Cases, Chips UDP, etc.)
export const productCategories = pgTable('product_categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(), // e.g., Empaques, Cases, Chips UDP, Memorias microSD, Adaptadores, Producto Terminado
  accountingType: text('accounting_type').notNull().default('SECONDARY_COMPONENT'),
  // STRATEGIC_COMPONENT | SECONDARY_COMPONENT | PACKAGING_KIT | UNIVERSAL_ACCESSORY | FINISHED_GOOD
  description: text('description').notNull().default(''),
  colorHex: text('color_hex').notNull().default('#0284c7'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 4. Master Catalog of Products, Components & Photos
export const products = pgTable('products', {
  id: serial('id').primaryKey(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  normalizedKey: text('normalized_key').notNull(),
  description: text('description').notNull().default(''),
  productType: text('product_type').notNull(), // STRATEGIC_COMPONENT | SECONDARY_COMPONENT | PACKAGING_KIT | UNIVERSAL_ACCESSORY | FINISHED_GOOD
  family: text('family').notNull(), // Classification / Department Name (e.g. Empaques, Cases, Chips UDP)
  brand: text('brand').notNull().default('Genérico'),
  model: text('model').notNull().default('Estándar'),
  capacity: text('capacity').notNull().default('N/A'),
  color: text('color').notNull().default('N/A'),
  material: text('material').notNull().default('N/A'),
  unitName: text('unit_name').notNull().default('piezas'),
  unitsPerBox: integer('units_per_box').notNull().default(1000),
  imageUrl: text('image_url').notNull().default(''),
  barcode: text('barcode').notNull().default(''),
  minStockAlert: integer('min_stock_alert').notNull().default(500),
  defaultWarehouseId: integer('default_warehouse_id'),
  defaultLocationId: integer('default_location_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 5. Versioned Assembly Recipes (BOM)
export const recipes = pgTable('recipes', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  finishedProductId: integer('finished_product_id').notNull().references(() => products.id),
  currentVersion: integer('current_version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
  notes: text('notes').notNull().default(''),
  createdByUserId: integer('created_by_user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recipeVersions = pgTable('recipe_versions', {
  id: serial('id').primaryKey(),
  recipeId: integer('recipe_id').notNull().references(() => recipes.id),
  versionNumber: integer('version_number').notNull(),
  finishedProductId: integer('finished_product_id').notNull().references(() => products.id),
  isCurrent: boolean('is_current').notNull().default(true),
  changeReason: text('change_reason').notNull().default('Versión inicial'),
  createdByUserId: integer('created_by_user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const recipeComponents = pgTable('recipe_components', {
  id: serial('id').primaryKey(),
  recipeVersionId: integer('recipe_version_id').notNull().references(() => recipeVersions.id),
  componentProductId: integer('component_product_id').notNull().references(() => products.id),
  quantityPerUnit: integer('quantity_per_unit').notNull().default(1),
  isStrategicOrderBound: boolean('is_strategic_order_bound').notNull().default(false),
});

// 6. Materialized Stock Balances (Locked via SELECT ... FOR UPDATE inside transactions)
export const inventoryBalances = pgTable('inventory_balances', {
  id: serial('id').primaryKey(),
  productId: integer('product_id').notNull().references(() => products.id),
  warehouseId: integer('warehouse_id').notNull().references(() => warehouses.id),
  locationId: integer('location_id').notNull().references(() => warehouseLocations.id),
  status: text('status').notNull(),
  productionOrderId: integer('production_order_id').notNull().default(0),
  quantity: integer('quantity').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 7. Immutable Movement Documents & Ledger Lines (Append-Only)
export const inventoryMovementDocuments = pgTable('inventory_movement_documents', {
  id: serial('id').primaryKey(),
  folio: text('folio').notNull().unique(),
  movementType: text('movement_type').notNull(),
  status: text('status').notNull().default('CONFIRMED'),
  sourceWarehouseId: integer('source_warehouse_id'),
  sourceLocationId: integer('source_location_id'),
  destWarehouseId: integer('dest_warehouse_id'),
  destLocationId: integer('dest_location_id'),
  productionOrderId: integer('production_order_id'),
  referenceDocId: integer('reference_doc_id'),
  supplierOrContainer: text('supplier_or_container').notNull().default(''),
  reason: text('reason').notNull().default(''),
  notes: text('notes').notNull().default(''),
  createdByUserId: integer('created_by_user_id').notNull().references(() => users.id),
  confirmedByUserId: integer('confirmed_by_user_id'),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  serverTimestamp: timestamp('server_timestamp', { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryMovementLines = pgTable('inventory_movement_lines', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id').notNull().references(() => inventoryMovementDocuments.id),
  productId: integer('product_id').notNull().references(() => products.id),
  historicalSku: text('historical_sku').notNull(),
  historicalName: text('historical_name').notNull(),
  quantity: integer('quantity').notNull(),
  fromWarehouseId: integer('from_warehouse_id'),
  fromLocationId: integer('from_location_id'),
  fromStatus: text('from_status'),
  fromOrderId: integer('from_order_id').notNull().default(0),
  toWarehouseId: integer('to_warehouse_id'),
  toLocationId: integer('to_location_id'),
  toStatus: text('to_status'),
  toOrderId: integer('to_order_id').notNull().default(0),
  lotCode: text('lot_code').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 8. Production Orders, Dispatches & Batches
export const productionOrders = pgTable('production_orders', {
  id: serial('id').primaryKey(),
  orderNumber: text('order_number').notNull().unique(),
  status: text('status').notNull().default('RESERVED'),
  sourceWarehouseId: integer('source_warehouse_id').notNull().references(() => warehouses.id),
  sourceLocationId: integer('source_location_id').notNull().references(() => warehouseLocations.id),
  targetWarehouseId: integer('target_warehouse_id').notNull().references(() => warehouses.id),
  targetLocationId: integer('target_location_id').notNull().references(() => warehouseLocations.id),
  assignedUserId: integer('assigned_user_id').notNull().references(() => users.id),
  strategicProductId: integer('strategic_product_id').notNull().references(() => products.id),
  authorizedQty: integer('authorized_qty').notNull(),
  reservedQty: integer('reserved_qty').notNull().default(0),
  dispatchedQty: integer('dispatched_qty').notNull().default(0),
  receivedInProductionQty: integer('received_in_production_qty').notNull().default(0),
  discrepancyQty: integer('discrepancy_qty').notNull().default(0),
  consumedQty: integer('consumed_qty').notNull().default(0),
  returnedQty: integer('returned_qty').notNull().default(0),
  wasteQty: integer('waste_qty').notNull().default(0),
  allowedRecipeIds: jsonb('allowed_recipe_ids').$type<number[]>().notNull().default([]),
  priority: text('priority').notNull().default('NORMAL'),
  instructions: text('instructions').notNull().default(''),
  createdByUserId: integer('created_by_user_id').notNull().references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

export const productionDispatches = pgTable('production_dispatches', {
  id: serial('id').primaryKey(),
  dispatchFolio: text('dispatch_folio').notNull().unique(),
  productionOrderId: integer('production_order_id').notNull().references(() => productionOrders.id),
  productId: integer('product_id').notNull().references(() => products.id),
  dispatchedQty: integer('dispatched_qty').notNull(),
  receivedQty: integer('received_qty'),
  discrepancyQty: integer('discrepancy_qty').notNull().default(0),
  discrepancyNotes: text('discrepancy_notes').notNull().default(''),
  discrepancyResolved: boolean('discrepancy_resolved').notNull().default(false),
  status: text('status').notNull().default('IN_TRANSIT'),
  dispatchedByUserId: integer('dispatched_by_user_id').notNull().references(() => users.id),
  receivedByUserId: integer('received_by_user_id'),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }).notNull().defaultNow(),
  receivedAt: timestamp('received_at', { withTimezone: true }),
});

export const productionBatches = pgTable('production_batches', {
  id: serial('id').primaryKey(),
  batchFolio: text('batch_folio').notNull().unique(),
  productionOrderId: integer('production_order_id').notNull().references(() => productionOrders.id),
  recipeId: integer('recipe_id').notNull().references(() => recipes.id),
  recipeVersionId: integer('recipe_version_id').notNull().references(() => recipeVersions.id),
  finishedProductId: integer('finished_product_id').notNull().references(() => products.id),
  warehouseId: integer('warehouse_id').notNull().references(() => warehouses.id),
  locationId: integer('location_id').notNull().references(() => warehouseLocations.id),
  quantityProduced: integer('quantity_produced').notNull(),
  quantityPickedUp: integer('quantity_picked_up').notNull().default(0),
  movementDocumentId: integer('movement_document_id').notNull().references(() => inventoryMovementDocuments.id),
  operatorUserId: integer('operator_user_id').notNull().references(() => users.id),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// 9. Finished Goods Dispatches & Formal Pickup Receipts
export const finishedGoodsDispatches = pgTable('finished_goods_dispatches', {
  id: serial('id').primaryKey(),
  dispatchFolio: text('dispatch_folio').notNull().unique(),
  productionOrderId: integer('production_order_id').notNull().references(() => productionOrders.id),
  finishedProductId: integer('finished_product_id').notNull().references(() => products.id),
  fromWarehouseId: integer('from_warehouse_id').notNull().references(() => warehouses.id),
  fromLocationId: integer('from_location_id').notNull().references(() => warehouseLocations.id),
  toWarehouseId: integer('to_warehouse_id').notNull().references(() => warehouses.id),
  toLocationId: integer('to_location_id').notNull().references(() => warehouseLocations.id),
  dispatchedQty: integer('dispatched_qty').notNull(),
  receivedQty: integer('received_qty'),
  discrepancyQty: integer('discrepancy_qty').notNull().default(0),
  status: text('status').notNull().default('IN_TRANSIT'),
  dispatchedByUserId: integer('dispatched_by_user_id').notNull().references(() => users.id),
  receivedByUserId: integer('received_by_user_id'),
  notes: text('notes').notNull().default(''),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }).notNull().defaultNow(),
  receivedAt: timestamp('received_at', { withTimezone: true }),
});

// 10. Inter-Warehouse Transfers
export const warehouseTransfers = pgTable('warehouse_transfers', {
  id: serial('id').primaryKey(),
  transferFolio: text('transfer_folio').notNull().unique(),
  fromWarehouseId: integer('from_warehouse_id').notNull().references(() => warehouses.id),
  fromLocationId: integer('from_location_id').notNull().references(() => warehouseLocations.id),
  toWarehouseId: integer('to_warehouse_id').notNull().references(() => warehouses.id),
  toLocationId: integer('to_location_id').notNull().references(() => warehouseLocations.id),
  productId: integer('product_id').notNull().references(() => products.id),
  dispatchedQty: integer('dispatched_qty').notNull(),
  receivedQty: integer('received_qty'),
  discrepancyQty: integer('discrepancy_qty').notNull().default(0),
  status: text('status').notNull().default('IN_TRANSIT'),
  dispatchedByUserId: integer('dispatched_by_user_id').notNull().references(() => users.id),
  receivedByUserId: integer('received_by_user_id'),
  notes: text('notes').notNull().default(''),
  dispatchedAt: timestamp('dispatched_at', { withTimezone: true }).notNull().defaultNow(),
  receivedAt: timestamp('received_at', { withTimezone: true }),
});

// 11. Physical Counts & Blind Count Audits
export const physicalCounts = pgTable('physical_counts', {
  id: serial('id').primaryKey(),
  countFolio: text('count_folio').notNull().unique(),
  warehouseId: integer('warehouse_id').notNull().references(() => warehouses.id),
  locationId: integer('location_id').notNull().references(() => warehouseLocations.id),
  productId: integer('product_id').notNull().references(() => products.id),
  isBlindCount: boolean('is_blind_count').notNull().default(true),
  systemExpectedQty: integer('system_expected_qty').notNull(),
  countedQty: integer('counted_qty').notNull(),
  differenceQty: integer('difference_qty').notNull(),
  status: text('status').notNull().default('PENDING_APPROVAL'),
  countedByUserId: integer('counted_by_user_id').notNull().references(() => users.id),
  reviewedByUserId: integer('reviewed_by_user_id'),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
});

// 12. Owner Private Purchases & Costs (Strictly Isolated from Staff APIs)
export const privatePurchaseBatches = pgTable('private_purchase_batches', {
  id: serial('id').primaryKey(),
  batchCode: text('batch_code').notNull().unique(),
  movementDocumentId: integer('movement_document_id').references(() => inventoryMovementDocuments.id),
  productId: integer('product_id').notNull().references(() => products.id),
  supplierName: text('supplier_name').notNull(),
  containerOrPolicyRef: text('container_or_policy_ref').notNull().default(''),
  quantityPurchased: integer('quantity_purchased').notNull(),
  currency: text('currency').notNull().default('USD'),
  fobTotalCost: numeric('fob_total_cost', { precision: 14, scale: 4 }).notNull().default('0'),
  freightCost: numeric('freight_cost', { precision: 14, scale: 4 }).notNull().default('0'),
  customsPolicyCost: numeric('customs_policy_cost', { precision: 14, scale: 4 }).notNull().default('0'),
  otherImportExpenses: numeric('other_import_expenses', { precision: 14, scale: 4 }).notNull().default('0'),
  totalLandedCost: numeric('total_landed_cost', { precision: 14, scale: 4 }).notNull().default('0'),
  unitLandedCost: numeric('unit_landed_cost', { precision: 14, scale: 6 }).notNull().default('0'),
  privateNotes: text('private_notes').notNull().default(''),
  createdByUserId: integer('created_by_user_id').notNull().references(() => users.id),
  purchasedAt: timestamp('purchased_at', { withTimezone: true }).notNull().defaultNow(),
});

// 13. Idempotency Keys & Security Audit Trail
export const idempotencyKeys = pgTable('idempotency_keys', {
  key: text('key').primaryKey(),
  userId: integer('user_id').notNull(),
  operationType: text('operation_type').notNull(),
  responsePayload: jsonb('response_payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const securityAuditEvents = pgTable('security_audit_events', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  username: text('username').notNull().default('anonymous'),
  eventType: text('event_type').notNull(),
  endpoint: text('endpoint').notNull(),
  details: text('details').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
