# Sistema Web de Inventario de Insumos, Almacenes, Transformación y Producción

Plataforma transaccional centralizada (100% online) para el control exacto de insumos tecnológicos (chips UDP, memorias microSD, adaptadores SD, cases USB y kits de empaque), órdenes de producción con recetas versionadas (BOM), transformación atómica en productos terminados, custodia multi-almacén (Sencata, Villa Dolores, Puente Bolivia y futuros) y módulo privado de compras/costos para el propietario.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> **Decisiones confirmadas por el propietario en la Fase 1 y reglas no negociables adoptadas:**

- **Gestión de Insumos en Órdenes de Producción (Confirmado)**: Las Órdenes de Producción reservan y entregan formalmente los **componentes estratégicos clave** (`UDP 8/16/32 GB` y `microSD por marca/capacidad`). Los **insumos secundarios** (`cases USB`, `adaptadores SD universales` y `kits de empaque papel+blíster`) se descuentan atómicamente del stock disponible en la ubicación/taller de producción autorizado al momento de registrar cada lote fabricado.
- **Autenticación Híbrida + Selector Rápido de Rol en Pruebas (Confirmado)**: Integración de **Google Sign-In (Firebase Auth)** para el Propietario/Administradores y **login propio con usuario/contraseña** (hash criptográfico seguro en servidor) para encargados de almacén, encargados de producción, operarios y auditores. En el entorno de desarrollo/pruebas se habilitará un conmutador rápido de sesión/rol para verificar los permisos de cada perfil sin fricción.
- **Zona Privada con Costos por Lote desde Fase 1 (Confirmado)**: Se incluye desde la primera entrega el registro privado de lotes de compra/importación (costo FOB, flete, póliza/aranceles, otros gastos y cálculo determinista de costo unitario de insumo y costo de materiales por producto terminado). Estos datos residen en tablas aisladas (`private_purchase_batches`, `private_cost_details`) y **jamás** se serializan ni devuelven en endpoints o reportes del personal operativo.
- **Base de Datos Relacional Cloud SQL PostgreSQL (Confirmado)**: El sistema se conectará a una instancia dedicada de **Cloud SQL (PostgreSQL)** con Drizzle ORM, transacciones ACID reales (`SELECT ... FOR UPDATE`), claves de idempotencia y libro mayor inmutable (*append-only ledger*). Al aprobar este plan, el primer paso será el aprovisionamiento interactivo de Cloud SQL.
- **Operación 100% En Línea (No Negociable)**: Cero almacenamiento offline (sin IndexedDB, localForage ni colas de sincronización diferida). Si se pierde conexión, la interfaz bloquea cualquier confirmación con un banner explícito y, al reconectar, verifica el estado de cualquier petición en vuelo mediante su `Idempotency-Key` para impedir dobles descuentos.

---

## 1. Overview & Core Concept

- **Propósito del Sistema**: Garantizar que cada unidad física de insumo (UDP, microSD, adaptador, case, empaque) y cada producto terminado tenga una ubicación, un estado de custodia y un responsable verificables en tiempo real, evitando dobles descuentos, saldos negativos, consumos fantasma o fugas de stock entre almacenes.
- **Modelo de "Una Sola Fuente de Verdad" (Single Source of Truth)**:
  - No existen dos inventarios separados ("privado" vs. "empleados") que intenten sincronizarse. Existe **un único libro mayor contable (`inventory_movement_lines`)** y **una única tabla de saldos por ubicación y estado (`inventory_balances`)**.
  - Cuando el propietario compra 20.000 UDP de 8 GB y asigna 4.000 a una orden de producción, las unidades siguen siendo las mismas 20.000: 16.000 permanecen `DISPONIBLE` en la ubicación de origen/custodia privada y 4.000 pasan por `RESERVADO_ORDEN` $\rightarrow$ `EN_TRANSITO_PRODUCCION` $\rightarrow$ `BAJO_CUSTODIA_PRODUCCION`.
- **Perfiles de Usuario y Segregación por Almacén**:
  1. **Propietario / Superadmin**: Visión global de todos los almacenes (`Sencata`, `Villa Dolores`, `Puente Bolivia`, etc.), acceso exclusivo a la Zona Privada de Compras y Costos, gestión de catálogo maestro, recetas (BOM), aprobación de órdenes, recepciones y ajustes.
  2. **Administrador Operativo**: Gestión de almacenes, ingresos, traslados y órdenes asignadas, sin acceso a costos privados.
  3. **Encargado de Almacén**: Operación estrictamente acotada a su(s) almacén(es) asignado(s) (ej. un encargado de Sencata recibe error `403 Forbidden` en el backend si intenta consultar o descontar stock de Villa Dolores).
  4. **Encargado de Producción / Operario**: Acepta entregas de UDP/microSD asignadas a su taller, registra lotes producidos mediante asistente de 3 pasos (consumo atómico por receta), reporta mermas/sobrantes y prepara despachos de producto terminado.
  5. **Receptor / Auditor**: Confirma recepciones físicas de transferencias o productos terminados y ejecuta conteos físicos (incluyendo conteo a ciegas).

---

## 2. User Experience & Visual Design

### Flujos de Usuario Clave (End-to-End)

1. **Flujo Completo del Ciclo de Inventario y Producción**:
   ```
   [Ingreso Proveedor/Contenedor]
         │ (Crea Lote + Saldo DISPONIBLE en Almacén/Ubicación + Costo Privado opcional)
         ▼
   [Orden de Producción (OP)] ──► Paso 1: Reserva Lógica (DISPONIBLE -> RESERVADO_ORDEN en origen; no consume)
         │
         ▼
   [Despacho de Componentes Clave] ──► Paso 2: Salida a Producción (RESERVADO_ORDEN -> EN_TRANSITO_PRODUCCION)
         │
         ▼
   [Aceptación por Encargado] ──► Paso 3: Conteo Físico al Recibir:
         ├── Si coincide (ej. 2.000 de 2.000) ──► Pasa a BAJO_CUSTODIA_PRODUCCION
         └── Si hay diferencia (ej. 1.980 de 2.000) ──► 1.980 a BAJO_CUSTODIA_PRODUCCION + 20 en DISCREPANCIA_TRANSITO (bloquea cierre de OP)
         │
         ▼
   [Registro de Producción (Asistente 3 Pasos)] ──► Paso 4: Transformación Atómica por Receta (BOM):
         ├── Consume X UDP/microSD desde BAJO_CUSTODIA_PRODUCCION (vinculado a la OP)
         ├── Consume X Cases + X Empaques (+ X Adaptadores si es microSD) desde DISPONIBLE del taller local
         └── Crea X unidades del SKU Producto Terminado en estado TERMINADO_PENDIENTE_RECOGIDA
         │
         ▼
   [Despacho y Recogida Formal de Terminados] ──► Paso 5: Entrega Parcial o Total:
         ├── Taller emite entrega (TERMINADO_PENDIENTE_RECOGIDA -> TERMINADO_EN_TRANSITO)
         └── Propietario/Almacén Destino cuenta y confirma recepción (TERMINADO_EN_TRANSITO -> DISPONIBLE en Almacén Destino)
             *Nota crítica: Recoger terminados NUNCA vuelve a descontar UDP, cases, adaptadores ni empaques.*
         │
         ▼
   [Conciliación y Cierre de OP] ──► Ecuación verificada:
         Recibido en Producción = Consumido en Lotes + Devuelto a Almacén + Merma Aprobada + Saldo en Producción (0 al cerrar) + Discrepancia (0 al conciliar)
   ```

2. **Pantallas y Navegación por Rol**:
   - **Barra Superior (Top Bar Contract)**: Diseño limpio de una sola fila con 3 zonas: Marca/Sistema a la izquierda (`ControlStock Pro`), navegación contextual de 4–5 vistas según el rol en el centro, y selector de usuario/estado de conexión en línea a la derecha.
   - **Inicio / Tablero Contextual**:
     - *Propietario*: Tarjetas de balance global sin duplicar estados (Stock Crudo Disponible, Reservado/En Tránsito, En Custodia de Producción, Terminados Listos para Recoger, Alertas de Stock Mínimo y Discrepancias Activas).
     - *Encargado de Producción / Operario*: Botones táctiles amplios ($\ge 44\text{px}$) para `Aceptar Componentes`, `Registrar Producción (3 Pasos)`, `Preparar Entrega de Terminados`, `Devolver Sobrantes / Reportar Merma` y `Consultar Stock Local`.
   - **Catálogo Maestro con Fotografías**: Búsqueda instantánea por SKU, nombre, marca, capacidad (`8GB`, `16GB`, `32GB`, `64GB`, `128GB`), color o material (`Metal`, `Goma`, `Plástico`). Prevención de duplicados normalizando tildes/espacios. Compresión automática de foto en cliente/servidor con miniatura legible en cada tarjeta y selector.
   - **Asistente de Producción en 3 Pasos**:
     - *Paso 1*: Seleccionar Orden de Producción activa (muestra saldo de UDP/microSD bajo custodia pendiente de transformar).
     - *Paso 2*: Elegir uno o varios modelos de producto terminado autorizados (ej. 1.000 USB HP 8GB + 1.000 USB Sony 8GB + 1.000 USB Samsung 8GB + 500 USB Kingston 8GB). El sistema calcula automáticamente desde la receta versionada los cases, adaptadores y kits de empaque requeridos y verifica en vivo si el taller local tiene stock suficiente de cada uno.
     - *Paso 3*: Vista previa de confirmación ("Antes vs. Después") con sello de idempotencia. Un solo clic ejecuta la transacción completa o hace rollback total si falta 1 sola unidad de cualquier insumo.

### Identidad Visual y Tema (SaaS Operativo Industrial)

- **Dirección Estética**: Utilitaria de alta precisión, sobria y legible tanto en monitores de escritorio (1440px) como en teléfonos Android verticales en planta/almacén.
- **Paleta de Colores (60-30-10)**:
  - *60% Lienzo Neutro*: Fondo principal `#F8FAFC` (`slate-50`) con contenedores blancos `#FFFFFF` y bordes sutiles de `1px` (`#E2E8F0` / `slate-200`).
  - *30% Superficies Estructurales y Texto*: Tipografía principal en `#0F172A` (`slate-900`), metadatos limpios sin cápsulas decorativas en `#475569` (`slate-600`).
  - *10% Acento Operativo y Estados Semánticos*: Azul industrial `#0284C7` (`sky-600`) para acciones primarias; Verde `#16A34A` para stock disponible/confirmado; Ámbar `#D97706` para tránsito/reservas/alertas de reposición; Rojo `#DC2626` para discrepancias, mermas o bloqueos por falta de conexión.
- **Tipografía y Disciplina Tabular**:
  - Encabezados y navegación: `Plus Jakarta Sans` (SemiBold/Bold).
  - Cuerpo y formularios: `Public Sans` o `DM Sans` para máxima legibilidad en pantallas móviles.
  - Cantidades, SKUs, folios, costos y saldos: `JetBrains Mono` con `font-variant-numeric: tabular-nums` obligatorio en todas las tablas y resúmenes para alineación vertical perfecta.

---

## 3. Key Product Decisions & Trade-Offs

- **Decisión 1: Separación de Insumos Estratégicos (por Orden) e Insumos Secundarios (Stock Local del Taller)**
  - *Enfoque elegido*: La Orden de Producción asigna y traslada la custodia del componente principal (`UDP` o `microSD cruda`). Los `cases`, `adaptadores SD` y `empaques compuestos (papel+blíster)` residen en el almacén/ubicación del taller y se descuentan automáticamente según la receta al confirmar cada lote producido.
  - *Por qué*: En la operación real, un lote de 4.000 UDP 8 GB puede redistribuirse dinámicamente entre varias marcas (HP, Sony, Samsung) según la demanda o disponibilidad de empaques en el taller, sin obligar al dueño a emitir una orden modificada por cada cambio de color o marca compatible.
- **Decisión 2: Libro Mayor Inmutable (Append-Only Ledger) + Tabla de Saldos Materializada en la Misma Transacción**
  - *Enfoque elegido*: Cada documento confirmado inserta líneas inmutables en `inventory_movement_lines` y actualiza `inventory_balances` dentro de la misma transacción PostgreSQL usando bloqueo pesimista (`SELECT ... FOR UPDATE` ordenado por ID de balance para evitar deadlocks).
  - *Por qué*: Garantiza consultas instantáneas de inventario en miles de SKUs sin sacrificar la capacidad de auditar y reconciliar matemáticamente que `SUM(ledger) == saldo_actual` en cualquier momento.
- **Decisión 3: Aislamiento Físico y Lógico de Costos Privados**
  - *Enfoque elegido*: Las tablas `private_purchase_batches` y `private_cost_details` solo son consultadas por el router `/api/private/*`, protegido por un middleware exclusivo que verifica `role === 'OWNER'` (o permiso explícito `VIEW_PRIVATE_COSTS`).
  - *Por qué*: Impide por diseño que un endpoint general de inventario o kardex filtre accidentalmente precios de compra, pólizas o márgenes en el JSON enviado al navegador de un trabajador.
- **Decisión 4: Control de Idempotencia y Rechazo de Operaciones Offline**
  - *Enfoque elegido*: Todo formulario transaccional genera un UUID `idempotency_key` al abrir la vista previa de confirmación. El servidor almacena la clave y la respuesta en `idempotency_keys`.
  - *Por qué*: Si la red móvil del operario sufre un microcorte justo al confirmar y el usuario vuelve a pulsar "Confirmar", el servidor devuelve el comprobante original sin duplicar el ingreso, salida o lote de producción.

---

## 4. Technical Architecture & Data Strategy

### Diagrama de Arquitectura y Componentes

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                   CLIENTE WEB RESPONSIVO (PC Windows & Android)                   │
│  ┌─────────────────────┐  ┌──────────────────────────┐  ┌──────────────────────┐  │
│  │ Monitor de Red      │  │ Vistas Operativas        │  │ Zona Privada Dueño   │  │
│  │ (Online-Only Guard  │  │ • Catálogo y Ubicaciones │  │ • Compras y Costos   │  │
│  │  + Idempotency UUID)│  │ • Ingresos y Traslados   │  │ • Custodia UDP/SD    │  │
│  └──────────┬──────────┘  │ • Asistente Producción   │  │ • Recetas (BOM)      │  │
│             │             │ • Recogida y Conteos     │  │ • Auditoría y Ajustes│  │
│             └─────────────┴────────────┬─────────────┴───────────┬──────────────┘  │
└────────────────────────────────────────┼─────────────────────────┼─────────────────┘
                                         │ HTTPS + JSON            │
                                         ▼                         ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│                        SERVIDOR BACKEND (Node.js / Express)                       │
│  ┌─────────────────────────────────────────────────────────────────────────────┐  │
│  │ Capa de Seguridad: Firebase Auth / Sesión Local + RBAC por Almacén y Acción │  │
│  └─────────────────────────────────────┬───────────────────────────────────────┘  │
│                                        ▼                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────┐  │
│  │         MOTOR TRANSACCIONAL DE INVENTARIO (Capa Única de Cálculo)           │  │
│  │  1. Verificación de Idempotency-Key (previene doble clic / reconexión)      │  │
│  │  2. Bloqueo de filas (SELECT ... FOR UPDATE) en inventory_balances          │  │
│  │  3. Validación de invariantes (Stock >= 0, Cupo de Orden, Receta activa)    │  │
│  │  4. Inserción en Ledger Inmutable + Actualización de Saldos + Auditoría     │  │
│  └──────────────────────────┬───────────────────────────────────┬──────────────┘  │
└─────────────────────────────┼───────────────────────────────────┼─────────────────┘
                              │ Transacción ACID                  │ Solo Rol OWNER
                              ▼                                   ▼
┌───────────────────────────────────────────────────┐ ┌─────────────────────────────┐
│        CLOUD SQL (PostgreSQL Administrado)        │ │ ESQUEMA PRIVADO FINANCIERO  │
│ • users, roles, user_warehouse_permissions        │ │ • private_purchase_batches  │
│ • warehouses, warehouse_locations                 │ │ • private_cost_details      │
│ • products (SKU único, atributos, fotos base64/URL│ │ (FOB, flete, póliza, costo  │
│ • recipes, recipe_versions, recipe_components     │ │  unitario y costo BOM)      │
│ • inventory_balances (SKU + ubicación + estado +OP│ └─────────────────────────────┘
│ • inventory_movement_documents & _lines (Ledger)  │
│ • production_orders, dispatches, batches          │
│ • finished_goods_dispatches & _receipts           │
│ • transfers, physical_counts, idempotency_keys    │
└───────────────────────────────────────────────────┘
```

### Modelo de Datos Relacional y Estados Contables

1. **Estados de Existencia (`stock_status`)**:
   - `AVAILABLE`: Stock libre y utilizable en un almacén y ubicación específicos.
   - `RESERVED_ORDER`: Apartado lógicamente en el almacén de origen para una Orden de Producción aprobada (aún físicamente en origen).
   - `IN_TRANSIT_PRODUCTION`: Despachado hacia el taller de producción, pendiente de conteo y aceptación por el encargado.
   - `IN_PRODUCTION_CUSTODY`: Aceptado físicamente por el encargado de producción; disponible únicamente para ser consumido en lotes de esa orden o devuelto al almacén.
   - `FINISHED_PENDING_PICKUP`: Producto terminado fabricado en el taller, bajo custodia de producción esperando retiro.
   - `FINISHED_IN_TRANSIT`: Producto terminado despachado por el taller hacia el almacén del propietario, pendiente de recepción formal.
   - `IN_TRANSIT_TRANSFER`: Mercancía en tránsito entre dos almacenes (ej. Sencata $\rightarrow$ Villa Dolores).
   - `DISCREPANCY_HOLD`: Unidades faltantes o en disputa detectadas al recibir un despacho o transferencia (bloquea el cierre hasta conciliación autorizada).
   - `DAMAGED_QUARANTINE`: Unidades separadas por merma/daño pendientes de baja o dictamen.

2. **Entidades Principales en `src/db/schema.ts` (Drizzle ORM + PostgreSQL)**:
   - **Usuarios y Permisos**: `users` (soporta `firebase_uid` y `password_hash`), `warehouses`, `warehouse_locations`, `user_warehouse_permissions` (permisos granulares por almacén: `can_view`, `can_receive`, `can_dispatch`, `can_produce`, `can_count`, `can_approve_adjustments`).
   - **Catálogo y Recetas (BOM)**: `products` (SKU inmutable, nombre, tipo: `STRATEGIC_COMPONENT` | `SECONDARY_COMPONENT` | `PACKAGING_KIT` | `UNIVERSAL_ACCESSORY` | `FINISHED_GOOD`, familia, marca, modelo, capacidad, color, material, unidad, factor de caja, foto miniatura, alerta de stock mínimo), `recipes`, `recipe_versions` (inmutables una vez usadas en producción), `recipe_components` (SKU componente, cantidad entera requerida por 1 unidad final, indicador de si se consume del saldo de la OP o del stock local del taller).
   - **Saldos y Libro Mayor**:
     - `inventory_balances`: clave compuesta lógica `(product_id, warehouse_id, location_id, status, production_order_id)` con restricción `CHECK (quantity >= 0)`.
     - `inventory_movement_documents`: cabecera con `folio` único (`ING-0001`, `OP-0001`, `PRO-0001`, `ENT-0001`, `TRA-0001`, `AJU-0001`), tipo de operación, usuario autor, timestamp UTC del servidor, almacén origen/destino, motivo y referencia a documento revertido.
     - `inventory_movement_lines`: líneas append-only con `product_id`, descripción histórica congelada, cantidad entera positiva, ubicación/estado origen y ubicación/estado destino.
   - **Producción, Entregas y Recepciones**:
     - `production_orders`: código `OP-XXXXXX`, almacén origen, taller destino, encargado asignado, SKU estratégico asignado (`UDP` o `microSD`), modelos de productos terminados permitidos, estado y contadores de conciliación (`authorized_qty`, `dispatched_qty`, `received_qty`, `discrepancy_qty`, `consumed_qty`, `returned_qty`, `waste_qty`).
     - `production_dispatches`: entregas parciales o totales del componente estratégico y su confirmación de recepción por el encargado.
     - `production_batches`: lotes de fabricación confirmados vinculados a la versión exacta de la receta (`recipe_version_id`).
     - `finished_goods_dispatches`: entregas parciales o totales de productos terminados desde el taller y su recepción formal por el propietario.
   - **Transferencias, Conteos y Zona Privada**:
     - `warehouse_transfers` y `warehouse_transfer_lines`: flujo completo de traslado entre almacenes y cambio rápido de ubicación interna.
     - `physical_counts` y `physical_count_lines`: soporte para conteo normal y **conteo a ciegas** (`is_blind = true`, ocultando el stock teórico al operario).
     - `private_purchase_batches`: registro exclusivo del propietario con proveedor, contenedor/póliza, costo FOB, flete, impuestos y costo unitario calculado por lote de ingreso.

### Mejoras Operativas Incorporadas y Prevención de Errores

1. **Verificador Automático de Reconciliación Contable (Auditoría Interna)**: Endpoint y panel de verificación que comprueba en tiempo real que la suma algebraica del libro mayor (`inventory_movement_lines`) coincide exactamente con cada fila de `inventory_balances` y que todas las Órdenes de Producción cumplen la ecuación de conservación de unidades.
2. **Suite de Casos de Prueba Automatizados en Entorno Aislado (Casos A–H)**: Módulo ejecutable de validación transaccional que verifica los 8 escenarios críticos del documento (MicroSD con adaptador universal, Orden de 4.000 UDP en múltiples marcas con recogida parcial en 2 tandas, concurrencia e idempotencia ante doble clic, rollback por falta de 1 insumo en receta, bloqueo IDOR entre almacenes, discrepancia de 1.980 vs 2.000 unidades y retorno de 500 UDP sobrantes).
