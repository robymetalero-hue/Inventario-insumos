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

export interface Product {
  id: number;
  sku: string;
  name: string;
  normalizedKey: string;
  description: string;
  productType: 'STRATEGIC_COMPONENT' | 'SECONDARY_COMPONENT' | 'PACKAGING_KIT' | 'UNIVERSAL_ACCESSORY' | 'FINISHED_GOOD';
  family: string;
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
  recipeId: number;
  recipeVersionId: number;
  finishedProductId: number;
  warehouseId: number;
  locationId: number;
  quantityProduced: number;
  quantityPickedUp: number;
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
  toWarehouseId: number | null;
  toLocationId: number | null;
  toStatus: string | null;
  toOrderId: number;
  lotCode: string;
  createdAt: string;
}

export interface WorkspaceData {
  user: UserProfile;
  warehouses: Warehouse[];
  allWarehousesSummary: { id: number; code: string; name: string; isProductionPlant: boolean }[];
  locations: WarehouseLocation[];
  allLocationsSummary: { id: number; warehouseId: number; code: string; zoneName: string; shelfName: string }[];
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
      second: '2-digit',
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
    AVAILABLE: 'Disponible',
    RESERVED_ORDER: 'Reservado en Orden',
    IN_TRANSIT_PRODUCTION: 'En Tránsito a Taller',
    IN_PRODUCTION_CUSTODY: 'Bajo Custodia Producción',
    FINISHED_PENDING_PICKUP: 'Terminado Listo p/ Recoger',
    FINISHED_IN_TRANSIT: 'Terminado en Tránsito',
    IN_TRANSIT_TRANSFER: 'En Tránsito entre Almacenes',
    DISCREPANCY_HOLD: 'Retenido por Discrepancia',
    DAMAGED_QUARANTINE: 'Merma / Cuarentena',
  };
  return map[status] || status;
}

export function translateRole(role: string): string {
  const map: Record<string, string> = {
    OWNER: 'Propietario / Superadmin',
    ADMIN: 'Administrador Operativo',
    WAREHOUSE_MANAGER: 'Encargado de Almacén',
    PRODUCTION_MANAGER: 'Encargado de Producción',
    OPERATOR: 'Operario de Ensamblaje',
    AUDITOR: 'Receptor / Auditor',
  };
  return map[role] || role;
}
