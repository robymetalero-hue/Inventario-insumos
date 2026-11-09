export interface WarehousePermission {
  warehouseId: number;
  canView: boolean;
  canReceive: boolean;
  canDispatch: boolean;
  canProduce: boolean;
  canCount: boolean;
  canApproveAdjustments: boolean;
}

export interface UserProfile {
  id: number;
  uid: string;
  username: string;
  email: string;
  fullName: string;
  role: 'OWNER' | 'ADMIN' | 'WAREHOUSE_MANAGER' | 'PRODUCTION_MANAGER' | 'OPERATOR' | 'AUDITOR';
  isActive: boolean;
  canViewPrivateCosts: boolean;
  warehousePermissions: WarehousePermission[];
}

export interface Warehouse {
  id: number;
  code: string;
  name: string;
  description: string;
  address: string;
  isProductionPlant: boolean;
  isActive: boolean;
}

export interface WarehouseLocation {
  id: number;
  warehouseId: number;
  code: string;
  zoneName: string;
  shelfName: string;
  description: string;
  isDefault: boolean;
}

export interface ProductCategory {
  id: number;
  name: string;
  accountingType:
    | 'STRATEGIC_COMPONENT'
    | 'SECONDARY_COMPONENT'
    | 'PACKAGING_KIT'
    | 'UNIVERSAL_ACCESSORY'
    | 'FINISHED_GOOD';
  description: string;
  colorHex: string;
}

export interface Product {
  id: number;
  sku: string;
  name: string;
  normalizedKey: string;
  description: string;
  productType:
    | 'STRATEGIC_COMPONENT'
    | 'SECONDARY_COMPONENT'
    | 'PACKAGING_KIT'
    | 'UNIVERSAL_ACCESSORY'
    | 'FINISHED_GOOD';
  family: string; // Classification / Department Name
  brand: string;
  model: string;
  capacity: string;
  color: string;
  material: string;
  unitName: string;
  unitsPerBox: number;
  imageUrl: string;
  barcode: string;
  minStockAlert: number;
  isActive: boolean;
}

export interface RecipeComponentItem {
  id: number;
  recipeVersionId: number;
  componentProductId: number;
  quantityPerUnit: number;
  isStrategicOrderBound: boolean;
}

export interface Recipe {
  id: number;
  code: string;
  name: string;
  finishedProductId: number;
  currentVersion: number;
  versionId: number;
  versionNumber: number;
  isActive: boolean;
  notes: string;
  components: RecipeComponentItem[];
}

export interface InventoryBalance {
  id: number;
  productId: number;
  warehouseId: number;
  locationId: number;
  status:
    | 'AVAILABLE'
    | 'RESERVED_ORDER'
    | 'IN_TRANSIT_PRODUCTION'
    | 'IN_PRODUCTION_CUSTODY'
    | 'FINISHED_PENDING_PICKUP'
    | 'FINISHED_IN_TRANSIT'
    | 'IN_TRANSIT_TRANSFER'
    | 'DISCREPANCY_HOLD'
    | 'DAMAGED_QUARANTINE';
  productionOrderId: number;
  quantity: number;
  updatedAt: string;
}

export interface ProductionOrder {
  id: number;
  orderNumber: string;
  status: string;
  sourceWarehouseId: number;
  sourceLocationId: number;
  targetWarehouseId: number;
  targetLocationId: number;
  assignedUserId: number;
  strategicProductId: number;
  authorizedQty: number;
  reservedQty: number;
  dispatchedQty: number;
  receivedInProductionQty: number;
  discrepancyQty: number;
  consumedQty: number;
  returnedQty: number;
  wasteQty: number;
  allowedRecipeIds: number[];
  priority: string;
  instructions: string;
  createdByUserId: number;
  createdAt: string;
}

export interface ProductionDispatch {
  id: number;
  dispatchFolio: string;
  productionOrderId: number;
  productId: number;
  dispatchedQty: number;
  receivedQty: number | null;
  discrepancyQty: number;
  discrepancyNotes: string;
  discrepancyResolved: boolean;
  status: string;
  dispatchedByUserId: number;
  receivedByUserId: number | null;
  dispatchedAt: string;
  receivedAt: string | null;
}

export interface ProductionBatch {
  id: number;
  batchFolio: string;
  productionOrderId: number;
  recipeId: number | null;
  recipeVersionId: number | null;
  finishedProductId: number;
  warehouseId: number;
  locationId: number;
  quantityProduced: number;
  strategicQtyConsumed: number;
  quantityPickedUp: number;
  usedWithdrawalFolios: string;
  movementDocumentId: number;
  operatorUserId: number;
  notes: string;
  createdAt: string;
}

export interface FinishedGoodsDispatch {
  id: number;
  dispatchFolio: string;
  productionOrderId: number;
  finishedProductId: number;
  fromWarehouseId: number;
  fromLocationId: number;
  toWarehouseId: number;
  toLocationId: number;
  dispatchedQty: number;
  receivedQty: number | null;
  discrepancyQty: number;
  status: string;
  dispatchedByUserId: number;
  receivedByUserId: number | null;
  notes: string;
  dispatchedAt: string;
  receivedAt: string | null;
}

export interface WarehouseTransfer {
  id: number;
  transferFolio: string;
  fromWarehouseId: number;
  fromLocationId: number;
  toWarehouseId: number;
  toLocationId: number;
  productId: number;
  dispatchedQty: number;
  receivedQty: number | null;
  discrepancyQty: number;
  status: string;
  dispatchedByUserId: number;
  receivedByUserId: number | null;
  notes: string;
  dispatchedAt: string;
  receivedAt: string | null;
}

export interface PhysicalCount {
  id: number;
  countFolio: string;
  warehouseId: number;
  locationId: number;
  productId: number;
  isBlindCount: boolean;
  systemExpectedQty: number;
  countedQty: number;
  differenceQty: number;
  status: string;
  countedByUserId: number;
  reviewedByUserId: number | null;
  notes: string;
  createdAt: string;
}

export interface MovementDocument {
  id: number;
  folio: string;
  movementType: string;
  status: string;
  sourceWarehouseId: number | null;
  sourceLocationId: number | null;
  destWarehouseId: number | null;
  destLocationId: number | null;
  productionOrderId: number | null;
  supplierOrContainer: string;
  recipientOrTarget: string;
  reason: string;
  notes: string;
  createdByUserId: number;
  idempotencyKey: string;
  serverTimestamp: string;
}

export interface MovementLine {
  id: number;
  documentId: number;
  productId: number;
  historicalSku: string;
  historicalName: string;
  quantity: number;
  fromWarehouseId: number | null;
  fromLocationId: number | null;
  fromStatus: string | null;
  fromOrderId: number;
  fromStockBefore: number | null;
  fromStockAfter: number | null;
  toWarehouseId: number | null;
  toLocationId: number | null;
  toStatus: string | null;
  toOrderId: number;
  toStockBefore: number | null;
  toStockAfter: number | null;
  lotCode: string;
  createdAt: string;
}

export interface MovementVoucherData {
  folio: string;
  operationTitle: string;
  operationType: 'INGRESO' | 'RETIRO' | 'TRANSFERENCIA' | 'PRODUCCION' | 'DEVOLUCION';
  serverTimestamp: string;
  userFullName: string;
  productSku: string;
  productName: string;
  productImageUrl?: string;
  warehouseName: string;
  locationName: string;
  orderNumber?: string | null;
  recipientOrTarget?: string;
  reason: string;
  notes?: string;
  stockBefore: number;
  quantityChanged: number;
  stockAfter: number;
}

export interface WorkspaceData {
  user: UserProfile;
  warehouses: Warehouse[];
  allWarehousesSummary: { id: number; code: string; name: string; isProductionPlant: boolean }[];
  locations: WarehouseLocation[];
  allLocationsSummary: {
    id: number;
    warehouseId: number;
    code: string;
    zoneName: string;
    shelfName: string;
  }[];
  categories: ProductCategory[];
  products: Product[];
  recipes: Recipe[];
  balances: InventoryBalance[];
  productionOrders: ProductionOrder[];
  productionDispatches: ProductionDispatch[];
  productionBatches: ProductionBatch[];
  finishedGoodsDispatches: FinishedGoodsDispatch[];
  warehouseTransfers: WarehouseTransfer[];
  physicalCounts: PhysicalCount[];
  movementDocuments: MovementDocument[];
  movementLines: MovementLine[];
  usersPublic: {
    id: number;
    username: string;
    fullName: string;
    role: string;
    email: string;
    isActive: boolean;
    canViewPrivateCosts: boolean;
  }[];
  userWarehousePermissions: {
    id: number;
    userId: number;
    warehouseId: number;
    canView: boolean;
    canReceive: boolean;
    canDispatch: boolean;
    canProduce: boolean;
    canCount: boolean;
    canApproveAdjustments: boolean;
  }[];
  serverTimestamp: string;
}

export function formatBoliviaDateTime(isoString?: string | null): string {
  if (!isoString) return '—';
  try {
    return new Intl.DateTimeFormat('es-BO', {
      timeZone: 'America/La_Paz',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(isoString));
  } catch {
    return isoString;
  }
}

export function formatInt(num?: number | null): string {
  if (num === undefined || num === null) return '0';
  return new Intl.NumberFormat('es-BO').format(num);
}

export function translateStatus(status: string): string {
  const map: Record<string, string> = {
    AVAILABLE: 'Disponible en Almacén',
    RESERVED_ORDER: 'Reservado en Orden',
    IN_TRANSIT_PRODUCTION: 'En Camino a Producción',
    IN_PRODUCTION_CUSTODY: 'En Custodia de Producción',
    FINISHED_PENDING_PICKUP: 'Terminado Listo p/ Recoger',
    FINISHED_IN_TRANSIT: 'Terminado en Tránsito',
    IN_TRANSIT_TRANSFER: 'En Tránsito entre Almacenes',
    DISCREPANCY_HOLD: 'Con Diferencia Física',
    DAMAGED_QUARANTINE: 'Merma / Dañado',
  };
  return map[status] || status;
}

export function translateMovementType(type: string): string {
  const map: Record<string, string> = {
    INGRESO_PROVEEDOR: 'Ingreso de Mercancía',
    DEVOLUCION_INSUMOS: 'Devolución de Insumos No Usados',
    REGULARIZACION_AUTORIZADA: 'Regularización Autorizada',
    APERTURA_INICIAL: 'Stock Inicial de Catálogo',
    RETIRO_PRODUCCION: 'Retiro de Insumos para Orden (OP)',
    RETIRO_OPERATIVO: 'Retiro por Consumo Operativo',
    RETIRO_MERMA: 'Retiro por Merma / Daño',
    RESERVA_OP: 'Reserva para Orden de Producción',
    DESPACHO_OP: 'Entrega de Componente a Producción',
    ACEPTACION_OP: 'Recepción en Custodia de Producción',
    PRODUCCION_LOTE: 'Registro de Producción Terminada',
    RETORNO_INSUMO_OP: 'Devolución de Sobrantes de Orden',
    MERMA_OP: 'Merma en Orden de Producción',
    DESPACHO_TERMINADO: 'Entrega de Producto Terminado',
    RECEPCION_TERMINADO: 'Recogida / Recepción de Terminado',
    TRANSFERENCIA_SALIDA: 'Salida por Transferencia de Almacén',
    TRANSFERENCIA_RECEPCION: 'Recepción de Transferencia',
    CAMBIO_UBICACION: 'Cambio de Ubicación Interna',
    AJUSTE_CONTEO: 'Ajuste por Conteo Físico',
  };
  return map[type] || type;
}

export function translateRole(role: string): string {
  const map: Record<string, string> = {
    OWNER: 'Propietario / Administrador General',
    ADMIN: 'Administrador Operativo',
    WAREHOUSE_MANAGER: 'Encargado de Almacén',
    PRODUCTION_MANAGER: 'Encargado de Producción',
    OPERATOR: 'Operario de Producción',
    AUDITOR: 'Receptor / Auditor',
  };
  return map[role] || role;
}

export function translateAccountingType(type: string): string {
  const map: Record<string, string> = {
    STRATEGIC_COMPONENT: 'Componente Estratégico (Ej. Chip UDP / Memoria microSD)',
    SECONDARY_COMPONENT: 'Insumo de Ensamblaje (Ej. Case / Carcasa)',
    PACKAGING_KIT: 'Empaque / Blíster (Se retira por Orden)',
    UNIVERSAL_ACCESSORY: 'Accesorio / Adaptador (Ej. Adaptador SD)',
    FINISHED_GOOD: 'Producto Terminado (Generado en Orden de Producción)',
  };
  return map[type] || type;
}
