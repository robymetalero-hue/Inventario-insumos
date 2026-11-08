# Acceso en Celular / PC (PWA Instalable) y Despliegue sin Error 404 — ControlStock Pro

Este plan soluciona el error 404 al abrir el enlace en dispositivos móviles o externos, blinda el servidor para entornos de producción en Cloud Run y convierte **ControlStock Pro** en una **Aplicación Web Instalable (PWA)** en celulares Android, iOS y computadoras, conservando la pantalla de acceso con usuario y contraseña (`admin` / `1234`).

## User Review & Critical Decisions

> [!IMPORTANT]
> Decisiones confirmadas para el acceso web y móvil:

- **Aplicación Instalable en Celular y PC (Confirmado)**: Se integrará soporte completo de **PWA (Progressive Web App)** con manifiesto web, iconos de alta resolución (192x192, 512x512 y maskable) y un botón directo **"Instalar App en Celular / PC"** tanto en la pantalla de login como en la barra lateral.
- **Pantalla de Login Estándar (Confirmado)**: Se mantiene la pantalla normal de usuario y contraseña (donde el administrador ingresa con `admin` y `1234`).
- **Solución Definitiva al Error 404 en Enlaces Externos**:
  1. **En el servidor**: Se ajustará el arranque de producción para compilar y servir siempre los activos estáticos (`dist/`) cuando exista el build o hacer fallback automático sin caer en rutas 404, usando `"start": "node server.ts"` conforme al estándar de Cloud Run.
  2. **Guía de enlace activo y código QR dentro de la app**: Se añadirá un modal de **"Compartir / Abrir en Celular"** dentro del panel para que puedas escanear o copiar el enlace público activo tras pulsar **Share / Deploy** en la barra superior de AI Studio.

---

## 1. Overview & Core Concept

- **What It Does**: Permite que cualquier encargado o administrador abra **ControlStock Pro** desde el navegador o la instale como aplicación nativa en su teléfono Android, iPhone o PC, conectándose en tiempo real a la base de datos PostgreSQL de producción.
- **Target Audience / Persona**: Propietario (`admin` / `1234`) y encargados de almacén/producción que operan desde celulares en Sencata, Villa Dolores y Puente Bolivia.
- **Key Value**: Acceso rápido desde un ícono en la pantalla de inicio del teléfono sin barras del navegador (`display: standalone`), con verificación estricta de conexión en línea para proteger el inventario.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Pantalla de Inicio de Sesión + Botón de Instalación**: Al abrir la aplicación, el usuario ingresa con su usuario (`admin`) y contraseña (`1234`), y cuenta con un botón visible **"Instalar Aplicación en este Dispositivo"** si aún no la tiene instalada.
  2. **Instalación Guiada en Android, iOS y PC**:
     - En Android / Chrome / Edge: Dispara el instalador nativo del sistema con un solo toque.
     - En iPhone / Safari: Muestra instrucciones paso a paso (*Compartir → Agregar a pantalla de inicio*).
  3. **Acceso Móvil Optimizado**: Barra superior compacta en móviles y menú lateral deslizable con tarjetas de productos grandes y botones táctiles cómodos.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Industrial Clean SaaS (`#0F172A` Slate-900 para cabecera y barra de estado móvil, `#2563EB` Blue-600 para acciones primarias, fondo `#F1F5F9`).
  - *Typography & Hierarchy*: `Inter` para interfaz general y `JetBrains Mono` para SKUs y cantidades.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: PWA con Validación Estricta Online para Operaciones**
  - *Chosen Approach*: El Service Worker almacena únicamente la cáscara visual (iconos, estilos y tipografías) para que la app abra al instante desde el ícono del celular, pero todas las rutas `/api/*` van directo al servidor (`NetworkOnly`) manteniendo la regla de bloqueo si no hay internet.
  - *Why*: Garantiza que la app se instale como aplicación nativa en Android/PC sin violar la regla de cero operaciones offline en inventario.
- **Decision 2: Servidor Resiliente para Cloud Run y Vista Previa**
  - *Chosen Approach*: Configurar `server.ts` y `package.json` para que sirvan tanto en desarrollo como en el contenedor publicado de Cloud Run sin producir errores 404 en rutas SPA.
  - *Why*: Asegura que al publicar/compartir el enlace desde AI Studio, cualquier dispositivo externo cargue la aplicación de inmediato.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:
```
┌──────────────────────────────────────────────────────────────────────────┐
│                 CLIENTE MÓVIL / PC (PWA INSTALABLE)                      │
│  ┌──────────────────────────┐  ┌──────────────────────────────────────┐  │
│  │  Web App Manifest + SW   │  │  Botón "Instalar App" (usePWAInstall)│  │
│  │  Iconos 192/512/Maskable │  │  Soporte Android Chrome / iOS / PC   │  │
│  └────────────┬─────────────┘  └──────────────────┬───────────────────┘  │
│               └─────────────────┬─────────────────┘                      │
│                                 ▼                                        │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  ControlStock Pro SPA (Login admin/1234 + Sidebar + CRUD Completo) │  │
│  └──────────────────────────────┬─────────────────────────────────────┘  │
└─────────────────────────────────┼────────────────────────────────────────┘
                                  │ HTTPS (/api/* nunca cacheado)
                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│           SERVIDOR EXPRESS + VITE / STATIC FALLBACK (PORT 3000)          │
│  • Sirve /api/* conectado a Cloud SQL PostgreSQL                         │
│  • Sirve manifest, iconos PNG/SVG y SPA fallback sin error 404           │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - Se mantiene intacta la base de datos PostgreSQL en Cloud SQL con el inventario limpio en cero, el usuario `admin` (`1234`) y las clasificaciones personalizables.
- **Interactive Component & State Mapping**:
  - `PWAInstallButton`: Detecta `beforeinstallprompt` en Android/PC, detecta Safari en iOS y se oculta automáticamente cuando ya corre instalada (`standalone`).
  - Modal **"Enlace para Celular"**: Muestra dentro de la barra lateral el enlace directo y cómo activarlo con el botón **Share / Deploy** de AI Studio.
