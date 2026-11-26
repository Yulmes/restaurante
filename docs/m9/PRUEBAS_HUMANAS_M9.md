# Pruebas que requieren al propietario · M9

> **Estado (26/11/2026, al cerrar M9):** **pendientes de validación humana.** El propietario aceptó cerrar M9 (PR #13, merge `adb772f`) con estas pruebas pendientes; no se dan por hechas. Ninguna de estas pruebas se marca como hecha hasta que el propietario la ejecute, o pida expresamente que Claude la ejecute, como en M1 con NVDA portátil. Lo que sí se verificó de forma automática está en `AUDITORIA_M9.md`.

## 1 · Recorrido con NVDA sobre las pantallas reales (D1, R-A11Y-01)

**Entorno sugerido:** NVDA 2026.x en Windows, en español; Microsoft Edge o Firefox. Servidor de desarrollo (`npm run dev`) con la API y la semilla (`npm run db:setup`). Una cuenta de cliente verificada y una de admin (`npm run users:set-role -w @marea-baja/api`).

**Teclas:** Tab y Mayús+Tab (foco), H (encabezados), D (regiones), F (campos), B (botones), Insert+F7 (lista de elementos), Insert+Espacio (modo foco o navegación).

| # | Pantalla y paso | Criterio de aceptación |
|---|---|---|
| 1 | Portada (`/`): H recorre los encabezados | Un solo nivel 1 ("Lo que trajo el mar hoy"); niveles sin saltos; la pizarra de pesca se lee como tabla con encabezados |
| 2 | Portada: Tab desde el inicio | Lo primero es "Saltar al contenido"; Enter lleva al contenido principal |
| 3 | Selector de idioma | Se anuncia "EN · English" y NVDA cambia a la voz en inglés (`lang`) |
| 4 | Carta (`/carta`): "Agregar" en un plato | Se abre la hoja de producto como diálogo con su título; el foco queda dentro; Escape la cierra y el foco vuelve a "Agregar" |
| 5 | Hoja de producto: opciones | Grupos anunciados con su nombre y su regla ("Elegí una (obligatorio)"); recargos leídos; el total del botón cambia y se anuncia |
| 6 | Hoja de producto: plato agotado | Se anuncia "Agotado hoy", separado del precio |
| 7 | Ingreso (`/cuenta/ingresar`): enviar vacío | Se anuncia el resumen de errores; cada campo dice "inválido" y su mensaje |
| 8 | Checkout (`/pedido/finalizar`): los 3 pasos | Cada paso se anuncia con "Paso N de 3"; los radios de entrega y de pago se leen con su descripción |
| 9 | Seguimiento (`/cuenta/pedidos/:id`) mientras el admin avanza el pedido en el Pase | El estado nuevo se anuncia solo (`aria-live`), sin mover el foco |
| 10 | Pase (`/admin/pase`): J y K | Se anuncia cada pedido con su código, antigüedad y acciones; A y C solo actúan con un pedido enfocado |
| 11 | Pase: cancelar con motivo | El campo del motivo recibe el foco y su error se anuncia |
| 12 | Admin · Carta: "Marcar agotado hoy · <plato>" | El botón se anuncia con el plato; el aviso de resultado se lee solo |
| 13 | Admin · Editor de plato | Campos en es-CR y en con su etiqueta y su idioma; la vista previa no roba el foco |
| 14 | Admin · Configuración: horario | Cada campo de hora dice su día ("Apertura · Martes") |
| 15 | Admin · Configuración: asistente de moneda | La confirmación se anuncia como grupo con el texto del cambio antes de "Sí, cambiar" |
| 16 | Admin · Clientes: bloquear sin motivo | Se anuncia el error del motivo; con motivo, el aviso de resultado |
| 17 | Admin · Auditoría: abrir "Ver los N campos" | El detalle se expande y se lee cada cambio "antes → después" |
| 18 | Repetir 1, 4, 7, 10 y 12 en inglés (`/en/...`) | Mismos criterios, con la voz en inglés |

**Registro:** para cada paso, lo que dijo NVDA (el visor de voz de NVDA lo muestra) y si cumple. Un paso que no cumple es un defecto de accesibilidad.

## 2 · Safari de iOS en un dispositivo real

El motor WebKit de Playwright con perfil de iPhone 13 **no es** Safari de iOS: no reproduce el teclado virtual, la barra de direcciones que se esconde, el zoom al enfocar campos ni VoiceOver.

**Entorno:** un iPhone con iOS al día y Safari. Para alcanzar el servidor local, la computadora y el iPhone en la misma red, con la web en `npm run dev -- --host` y `PUBLIC_WEB_URL` apuntando a la IP de la computadora (el CSRF exige ese origen); o, después de M10, la URL pública.

| # | Escenario | Criterio de aceptación |
|---|---|---|
| 1 | Portada y carta en vertical y en horizontal | Sin desbordamiento horizontal ni texto cortado; el banner de demo y la cabecera no tapan contenido |
| 2 | Hoja de producto: abrir, elegir opciones, desplazar y cerrar | El panel sube desde abajo, se desplaza sin arrastrar la página de fondo y se cierra con "Cerrar" |
| 3 | Agregar al pedido como invitado e iniciar sesión | El carrito se conserva y se fusiona sin duplicar cantidades |
| 4 | Checkout con teclado virtual | Enfocar un campo **no** hace zoom (fuente ≥ 16 px); el botón "Continuar" sigue alcanzable con el teclado abierto |
| 5 | Pago con la tarjeta demo (aprobado) y con "pendiente" | Pantalla de confirmación correcta; el pendiente se resuelve solo |
| 6 | Seguimiento con la pantalla bloqueada y desbloqueada | Al volver, el estado se actualiza (consulta cada 15 s) |
| 7 | Cambio de idioma en el pedido y en la cuenta | Se conserva la página y el carrito |
| 8 | Admin desde el celular: Pase, Carta y Configuración | Navegación de secciones desplazable; campos de hora con el selector nativo de iOS; sin controles por debajo de 44 px |
| 9 | VoiceOver: pasos 1, 4, 7 y 10 de la tabla de NVDA | Mismos criterios con los gestos de VoiceOver |

**Registro:** modelo y versión de iOS, captura de cada escenario y si cumple.
