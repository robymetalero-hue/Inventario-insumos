# Flujo Unificado de Descuento de Insumos en Producción, Registro de Productos Terminados y Teclado Numérico Global

Este plan simplifica el control de producción e inventario para que, al entregar chips (ej. 5.000 UDP 8 GB) al personal y luego reportar o recoger los productos terminados, se descuenten **en un solo paso** todos los insumos utilizados (chips + empaque/blíster + case/carcasa + adaptador), se sumen los productos terminados al stock disponible y quede un **Registro de Productos Terminados** claro con fecha, cantidad, marca, modelo, color, capacidad, insumos descontados y operario responsable.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> Estas decisiones recogen exactamente tus respuestas de confirmación y las reglas de simplicidad solicitadas:

- **Decisión Confirmada 1 — Descuento Unificado al Reportar / Recoger Productos Terminados**: Los chips se entregan en la orden de producción (ej. 5.000 chips UDP 8 GB) con su nota/justificación de entrada a producción. Al momento de reportar o recoger los productos terminados de la orden, el usuario marca en una sola ventana qué insumos acompañaron a los chips (**Empaque/Blíster**, **Case/Carcasa** y/o **Adaptador**) y el sistema descuenta todos esos insumos junto con los chips en una sola operación.
- **Decisión Confirmada 2 — Destino al Recoger Productos Terminados**: Los productos terminados recogidos **se suman automáticamente al stock disponible** del almacén destino y, al mismo tiempo, quedan guardados en la vista de **Registro de Productos Terminados**.
- **Decisión Confirmada 3 — Datos en la Tabla de Registro de Productos Terminados**: Cada registro mostrará de forma directa y sin redundancia: **Fecha y Hora**, **Cantidad producida/recogida**, **Producto Terminado (Marca, Modelo, Capacidad y Color)**, **Resumen de insumos descontados (chips + empaque + case/adaptador)** y **Nombre del operario que entregó los terminados**.
- **Decisión Confirmada 4 — Teclado Numérico Limpio en el 100 % de la App**: Todos los campos de cantidad de la aplicación (incluyendo Transferencias entre Almacenes y Conteo Físico, además de Ingresar, Retirar y Producción) usarán `inputMode="numeric"` y `pattern="[0-9]*"`, iniciando limpios (sin `0` ni bloqueo en `1` al borrar) y obligando a escribir una cantidad entera válida mayor a cero.

---

### 1. Overview & Core Concept

- **Qué Hace**:
  1. **Entrega de Chips a Producción con Justificación Simple**: El administrador o encargado entrega un lote de chips (ej. `5.000 Chips UDP 8 GB`) al personal asignado indicando brevemente para qué entra a producción.
  2. **Liquidación y Recogida en 1 Solo Paso (Chips + Empaque + Case/Adaptador)**: Cuando el personal entrega los productos terminados, en una sola ventana indicas la cantidad terminada (ej. `5.000`), qué se fabricó (**Marca, Modelo, Color, Capacidad**) y marcas con casillas qué insumos del inventario se usaron (**Empaque/Blíster**, **Case/Carcasa**, **Adaptador**). Al confirmar:
     - Se descuentan en un solo movimiento los `5.000` chips en custodia + `5.000` empaques + `5.000` cases de sus almacenes predeterminados.
     - Se ingresan `+5.000` unidades del producto terminado directamente al stock disponible.
  3. **Registro Histórico de Productos Terminados**: Una pestaña y tabla dedicada donde puedes consultar y filtrar por fecha, marca, modelo o color todo lo que se produjo, viendo de un vistazo los insumos descontados y el operario responsable.
- **Valor Principal**: Elimina pasos repetitivos y pantallas recargadas. No tienes que retirar empaque por empaque ni llenar formularios redundantes: todo el descuento de materiales y el ingreso del producto terminado ocurren en una sola confirmación matemática exacta.

---

### 2. User Experience & Visual Design

- **Flujos de Usuario Clave**:
  1. **Paso 1 — Entregar Chips a Producción (`+ Nueva Orden / Entrega de Chips`)**:
     - Seleccionas el chip en stock (ej. `UDP 8 GB — Disp: 29.000 u. en Senkata`), escribes la cantidad con teclado numérico (`5000`), eliges el operario responsable y escribes una justificación breve (ej. *"Armado de USB Samsung y HP 8 GB"*).
  2. **Paso 2 — Reportar y Recoger Productos Terminados (Todo en Uno)**:
     - Dentro de la orden activa, haces clic en **"Reportar / Recoger Terminados"**.
     - Se abre una ventana compacta dividida en tres bloques claros:
       - **A. Qué Producto Terminado se Recoge**: Cantidad (`inputMode="numeric"`, ej. `5000` o parcial `2000`), Nombre/Descripción, **Marca** (ej. `Samsung`), **Modelo** (ej. `Metálico`), **Color** (ej. `Plata`) y **Capacidad** (ej. `8 GB`), más el almacén donde quedará disponible.
       - **B. Insumos Utilizados (Descuento Automático en 1 Solo Paso)**:
         - **Chip en custodia**: `5.000 u. de UDP 8 GB` (automático de la orden).
         - Casilla `[x] Empaque / Blíster`: Selector de empaques con stock (ej. `Blíster Samsung 8GB — Disp: 12.000 u. en Senkata`). Descuenta `5.000 u.`
         - Casilla `[x] Case / Carcasa`: Selector de cases con stock (ej. `Case Samsung 8GB — Disp: 9.000 u. en Senkata`). Descuenta `5.000 u.`
         - Casilla `[ ] Adaptador / Accesorio`: Selector opcional si el armado lleva adaptador.
       - **C. Resumen Matemático antes de Confirmar**: Muestra en una sola barra los descuentos simultáneos (`-5.000 Chips`, `-5.000 Empaques`, `-5.000 Cases`) y el ingreso (`+5.000 Terminados disponibles`).
  3. **Paso 3 — Consulta del Registro de Productos Terminados**:
     - En la sección **Productos Terminados / Registro**, ves la tabla limpia con buscador rápido por marca/modelo/color y columnas exactas:
       - **Fecha y Hora**
       - **Producto Terminado** (Nombre, Marca, Modelo, Capacidad, Color)
       - **Cantidad Recogida** (`+5.000 u.`)
       - **Insumos Descontados** (ej. `5.000 UDP 8GB + 5.000 Empaque Samsung + 5.000 Case Samsung`)
       - **Operario Responsable** y **Almacén Destino**.

- **Identidad Visual y Tema**:
  - *Dirección Estética*: Panel operativo industrial limpio y utilitario de alta legibilidad, siguiendo un esquema de una sola elevación (`border border-slate-200 bg-white`), sin etiquetas decorativas redundantes.
  - *Paleta de Color (60-30-10)*:
    - `60%` Lienzo neutro (`#F8FAFC` / `#FFFFFF`) para máxima claridad en móvil y escritorio.
    - `30%` Superficies estructurales (`#F1F5F9`, bordes `#E2E8F0`, texto `#0F172A` y `#475569`).
    - `10%` Acentos semánticos funcionales: Esmeralda (`#059669`) para ingresos y productos terminados disponibles, Ámbar (`#D97706`) para descuento de insumos, Azul (`#0284C7`) para órdenes activas.
  - *Tipografía y Disciplina Tabular*: Tipografía sans geométrica limpia para encabezados y etiquetas, combinada estrictamente con números tabulares monoespaciados (`font-mono tabular-nums`) en todas las cantidades, saldos y fechas. Metadata en texto limpio separado por `·` sin cápsulas decorativas innecesarias.

---

### 3. Key Product Decisions & Trade-Offs

- **Decisión 1: Descuento Multi-Insumo en Una Sola Transacción Atómica**
  - *Enfoque Elegido*: Permitir seleccionar hasta 3 insumos complementarios (Empaque/Blíster, Case/Carcasa y Adaptador) en el mismo formulario de reporte/recogida de la orden y procesarlos dentro de la misma transacción del servidor junto con los chips y el ingreso del producto terminado.
  - *Por Qué*: Refleja exactamente tu operación real ("recoger los 5.000 chips, los 5.000 empaques y los 5.000 cases en uno solo"), evita errores humanos de olvidarse de descontar el blíster o el case, y mantiene el Kardex perfectamente cuadrado.
- **Decisión 2: Ficha Ligera de Marca, Modelo, Color y Capacidad al Registrar el Terminado**
  - *Enfoque Elegido*: Al reportar el producto terminado, si ese modelo/color aún no existe en el catálogo, el sistema lo crea o actualiza automáticamente con su **Marca, Modelo, Color y Capacidad** y lo suma de inmediato al stock disponible si la opción de recogida inmediata está activa.
  - *Por Qué*: Evita que tengas que ir primero al catálogo a crear cada combinación de marca/modelo/color antes de producir.
- **Decisión 3: Estandarización Global de Inputs Numéricos (`inputMode="numeric"`)**
  - *Enfoque Elegido*: Reemplazar todos los `<input type="number">` restantes (incluyendo Transferencias y Conteo Físico) por inputs controlados con `type="text" inputMode="numeric" pattern="[0-9]*"`, limpieza de ceros a la izquierda (`replace(/^0+/, '')`) y estado vacío (`''`) cuando aún no se ha escrito un valor.
  - *Por Qué*: Garantiza que en cualquier celular o tablet siempre se abra el teclado numérico puro, nunca aparezca un `0` estorbando ni se quede bloqueado el primer dígito al borrar.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

#### Diagrama de Arquitectura y Flujo de Datos

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   INTERFAZ WEB (MÓVIL / TABLET / DESKTOP)                  │
│  ┌──────────────────────┐  ┌──────────────────────────┐  ┌──────────────┐  │
│  │  Inventario y Stock  │  │  Órdenes de Producción   │  │ Registro de  │  │
│  │  • Ingresar (1 paso) │  │  • Entregar Chips + Nota │  │  Terminados  │  │
│  │  • Retirar (1 paso)  │  │  • Recoger en 1 Paso:    │  │ • Fecha/Hora │  │
│  │  • Teclado numérico  │  │    Chips + Empaque +     │  │ • Marca/Mod/ │  │
│  │    limpio sin ceros  │  │    Case + Adaptador      │  │   Color/Cap  │  │
│  └──────────┬───────────┘  └────────────┬─────────────┘  │ • Insumos y  │  │
│             │                           │                │   Operario   │  │
└─────────────┼───────────────────────────┼────────────────┴──────▲───────┘  │
              │                           │                       │
              ▼                           ▼                       │
┌─────────────────────────────────────────────────────────────────┴──────────┐
│                 SERVIDOR TRANSACCIONAL & MOTOR KARDEX                      │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Transacción Unificada de Producción y Recogida (`/api/production/*`) │  │
│  │  1. Descuenta Chips de Custodia de la Orden (-5.000 Chips UDP)       │  │
│  │  2. Descuenta de su Almacén Predeterminado:                          │  │
│  │     • Empaque / Blíster seleccionado (-5.000 u.)                     │  │
│  │     • Case / Carcasa seleccionado (-5.000 u.)                        │  │
│  │     • Adaptador seleccionado (opcional)                              │  │
│  │  3. Crea/Resuelve Producto Terminado (Marca, Modelo, Color, Cap.)    │  │
│  │  4. Suma +5.000 u. al Stock Disponible y guarda el resumen detallado │  │
│  │     de insumos + operario en el Registro de Productos Terminados.    │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

#### Modelo de Datos y Mapeo de Estado Interactivo

- **Descuento Multi-Insumo en Lotes de Producción**:
  - Cada línea enviada al endpoint de registro de producción soportará:
    - `strategicQtyConsumed`: Cantidad de chips consumidos de la orden.
    - `selectedSupplies`: Arreglo de insumos secundarios a descontar automáticamente en el mismo acto (cada uno con `productId`, `roleLabel` como `'Empaque' | 'Case' | 'Adaptador'` y `quantity`).
    - `finishedProductSpec`: `{ finishedProductId, name, brand, model, color, capacity }` para crear o actualizar los metadatos del producto terminado.
    - `autoReceiveToWarehouseId`: Almacén destino donde las unidades terminadas pasan directamente a estado `AVAILABLE` (disponible en inventario) en el mismo paso, generando su registro de entrega y guardando en `notes` / `usedWithdrawalFolios` el resumen legible de todos los insumos descontados (`"5.000 UDP 8GB + 5.000 Empaque Samsung + 5.000 Case Samsung"`).
- **Validación de Inputs Numéricos en Toda la App**:
  - En Inventario (Ingresar, Retirar, Stock Inicial), Producción (Nueva Orden, Descontar Insumo, Armar/Recoger, Devolver Sobrantes, Aceptar Entrega, Recoger Terminados) y Auditoría (Transferencias entre Almacenes y Conteo Físico), el manejador de cambio filtra `e.target.value.replace(/\D/g, '').replace(/^0+/, '')`, manteniendo `''` en pantalla cuando está vacío y deshabilitando el botón de confirmación hasta que el valor sea un entero `>= 1` y `<= stockDisponible`.
