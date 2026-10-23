# ToutAunClicLa · Livraison

Base para una app de repartidores en iPhone y Android, con panel de administración y GPS durante el turno. Interfaz en francés y español.

**Estado:** código fuente inicial. Pruebas del servidor y generación de paquetes JavaScript móviles verificadas. Servidor desplegado en Render. Todavía no hay APK/IPA compilado ni seguimiento probado en dispositivos reales.

- `mobile/`: app React Native con Expo.
- `server/`: API Node.js 24, SQLite y panel web.
- `LEEME.md`: instalación, límites y comprobaciones.
- `render.yaml`: configuración propuesta para Render con almacenamiento persistente. **Activarla en Render supone un servicio de pago.** Guardar el código en GitHub no contrata ese servicio.

## Probar el servidor en una computadora

```bash
cd server
npm ci
npm test
npm start
```

El primer administrador se puede crear con `node create-user.mjs`, según `LEEME.md`. En Render, introducir `ADMIN_EMAIL` y `ADMIN_PASSWORD` como variables privadas del servicio antes de iniciarlo. El arranque inicial crea esa cuenta si la base de datos está vacía; reiniciar el servicio no cambia la contraseña. Después del primer inicio correcto, retirar esas dos variables del panel de Render.

Las contraseñas, claves privadas, archivos `.env` y la base de datos no deben subirse al repositorio. La clave de navegador de Google Maps se configura en `GOOGLE_MAPS_BROWSER_KEY`, restringida al dominio real del panel.

## Acceso web de repartidores

El panel del administrador está en `/` y el acceso de repartidores en `/livreur` (también `/repartidor`). El administrador crea cada cuenta desde « Crear cuenta de repartidor » y entrega al repartidor su correo, contraseña y el enlace `/livreur`.

El repartidor puede iniciar sesión, autorizar la ubicación durante su turno, consultar sus entregas, abrir las rutas en Google Maps y confirmar recogidas y entregas. El seguimiento web requiere HTTPS, permiso de ubicación y mantener la página abierta con la pantalla encendida; no garantiza ubicación en segundo plano ni con la pantalla bloqueada. La opción de mantener la pantalla encendida solicita Screen Wake Lock durante el turno, vuelve a solicitarlo al regresar a la página y lo libera al terminar. Si el navegador o el ahorro de batería lo impiden, muestra un aviso; el usuario puede desactivar esta opción. Los GPS antiguos aparecen como desactualizados en el panel. El botón de terminar turno detiene la captura en el teléfono y elimina la posición activa del servidor. Sin Internet, la confirmación del cierre debe reintentarse; mientras tanto se muestra el aviso correspondiente.

La sesión web se guarda solamente en memoria: al recargar, hay que volver a iniciar sesión y autorizar el turno. No se almacenan contraseñas en el navegador. El seguimiento en segundo plano corresponde a la app móvil y debe probarse en dispositivos reales.

La integración con los pedidos de la tienda ToutAunClicLa y las solicitudes públicas de recogida se implementarán en fases posteriores. El sistema inicial permite asignar entregas manualmente.


## Alarmas de asignación

En el acceso web, « Activar y probar sonido » habilita un aviso de seis tonos que se repite cada ocho segundos mientras haya nuevas asignaciones sin reconocer. « Entendido » silencia el aviso sin modificar la entrega. Las asignaciones pendientes al iniciar sesión también se anuncian; las ya reconocidas no vuelven a sonar durante esa sesión. El botón de desactivar sonido y el fin del turno liberan el audio. La detección utiliza la actualización existente de entregas cada doce segundos con la página activa. El volumen, el modo silencio y las restricciones de audio del navegador se deben comprobar en cada dispositivo; no son notificaciones push y no se garantiza sonido con la pantalla bloqueada ni en segundo plano.


## Correos de asignación

Cada nueva entrega guarda un aviso pendiente en SQLite, en la misma transacción que la asignación. Un proceso del servidor lo envía al correo de la cuenta del repartidor. El mensaje contiene recogida, destino y un enlace HTTPS al panel `/livreur`, en francés y español; no contiene contraseña ni permite aceptar la entrega sin iniciar sesión.

**Desactivado hasta configurar la cuenta de envío.** En el servicio existente de Render, cambiar **Build Command** a `npm ci && npm test` (Root Directory: `server`). El archivo `render.yaml` propone lo mismo, pero no modifica por sí solo un servicio creado manualmente.

Agregar estas variables privadas en **Environment**:

| Variable | Valor |
| --- | --- |
| `ASSIGNMENT_EMAIL_ENABLED` | `true`, solo cuando los demás valores estén listos |
| `SMTP_HOST` | Servidor SMTP del proveedor |
| `SMTP_PORT` | `465` (TLS directo) o `587` (STARTTLS obligatorio) |
| `SMTP_USER` | Correo de la cuenta remitente |
| `SMTP_PASSWORD` | Contraseña SMTP o contraseña de aplicación, solo en Render |
| `SMTP_FROM` | Correo remitente autorizado; por defecto `SMTP_USER` |
| `PUBLIC_APP_URL` | Origen HTTPS real, por ejemplo `https://toutaunclicla-livraison-1.onrender.com` |

El proveedor debe autorizar el remitente y tener los registros de correo del dominio configurados. No subir contraseñas al repositorio ni enviarlas por chat. Reiniciar/desplegar tras guardar las variables. Confirmar el primer envío real asignando una entrega de prueba a un repartidor conectado, con correo propio controlado, y comprobar su bandeja de entrada y spam.

Los avisos fallidos se reintentan hasta cinco veces con esperas crecientes; la cola se conserva con el disco persistente. Los avisos de más de 24 horas o de entregas ya recogidas se omiten. Se mantiene un identificador estable de mensaje para los reintentos, aunque una interrupción justo después de que SMTP acepte el correo puede producir un duplicado. La aceptación SMTP no garantiza llegada a la bandeja de entrada. El correo no impide crear la entrega ni sustituye la alarma en el panel. Para desactivarlo, establecer `ASSIGNMENT_EMAIL_ENABLED=false`. Las pruebas automáticas usan un emisor simulado y no envían correos reales.

## Solicitudes con precio fijo (octubre de 2026)

- Formulario público: `/demander` (también `/solicitar`). Francés y español.
- Recogida y destino tienen casillas independientes de código postal canadiense.
- Google Routes calcula distancia vial, duración con tráfico y duración de referencia histórica. Se requiere `GOOGLE_ROUTES_API_KEY` **en el servidor**; habilitar Routes API en el proyecto de Google Cloud y configurar la clave en las variables del servicio de Render. La clave del mapa del navegador no sustituye esta configuración. No se expone la clave del servidor al navegador.
- El administrador ve si falta esta variable en la sección Solicitudes. Sin ruta válida/configuración no se presenta un precio inventado ni se acepta un pedido sin precio.
- Precio en CAD: 6,00 hasta 3.000 m; después 0,59 por cada tramo de 500 m iniciado. Recargo de 1,40 por cada bloque **completo** de 300 segundos de demora prevista respecto a la referencia histórica. Una cotización dura 10 minutos; su precio aceptado queda guardado y no cambia por tráfico posterior ni por espera de asignación.
- Propinas opcionales: exactamente cuatro botones, 5/8/12/17 CAD. Ninguno está seleccionado inicialmente; tocar el seleccionado lo desactiva. El total aceptado incluye la propina.
- Comisión: 10 % de la tarifa de livraison (redondeada al centavo); el repartidor recibe el resto **más el 100 % de la propina**. Son importes calculados y guardados; esta función no realiza cobros ni transferencias bancarias. Las entregas manuales antiguas sin precio se muestran como importe sin indicar.
- Tras aceptar el precio, la solicitud entra en el panel del administrador. La asignación en esta versión es **manual**: un repartidor con GPS reciente y disponible, o uno con 1–2 pedidos pendientes de recogida del mismo restaurante y la misma dirección. Seleccionar una opción «Agrupar» añade el pedido a esa tournée. Máximo 3; no se añaden paquetes cuando ya empezó la recogida. Cada pedido conserva tarifa, propina, destinatario y confirmación propios.
- El livreur ve los importes individuales, el total por recibir del grupo y un enlace Google Maps con recogida y destinos. Los destinos siguen el orden de las solicitudes; no se promete optimización automática. Puede confirmar la recogida de todos los paquetes y después cada entrega por separado.
- El restaurante ve «Buscando repartidor», «Un repartidor va en camino», «En entrega» y «Entrega completada» en su página de seguimiento. Se actualiza cada 12 s con la página abierta; **no se envían SMS ni correos al restaurante** en esta versión. Los avisos existentes al repartidor siguen funcionando.
- El enlace de seguimiento usa un token privado en el fragmento de la URL; guardar el enlace para volver a abrirlo. La referencia corta sola no permite consultar una solicitud ni datos personales. Conservar cada enlace al crear varios pedidos.
- SQLite añade tablas/columnas sin eliminar usuarios ni entregas. Mantener `DATABASE_PATH=/var/data/livraison.sqlite` con el disco persistente ya configurado.

Validación: `cd server && npm test`. Las pruebas de rutas usan respuestas simuladas y nunca envían solicitudes reales de pago a Google ni mensajes SMTP. Después de configurar la clave, probar una cotización con direcciones reales y una solicitud de prueba antes del uso operativo.

### Ajuste del formulario y tasas

El bloque inicial de contacto se retiró: el nombre del restaurante está dentro de recogida. No se solicita correo ni teléfono/persona del restaurante; el teléfono y nombre del destinatario siguen siendo obligatorios. Los campos antiguos de contacto permanecen compatibles en la API para clientes anteriores. Las tarifas públicas se sustituyeron por un enlace `mailto:serviceclient@toutaunclicla.com` («Conoce nuestras tarifas» / «Découvrez nos tarifs»).

La cotización muestra el subtotal de livraison y congestión, TPS 5 %, TVQ 9,975 %, propina voluntaria y total final. TPS y TVQ se calculan por separado sobre el subtotal antes de impuestos, redondeadas al centavo; la propina voluntaria se mantiene fuera de la base. Se guardan las tasas de cada cotización y entrega. La comisión del 10 % se calcula sobre la tarifa antes de impuestos; el repartidor conserva el 90 % de esa tarifa y toda la propina. El total del cliente incluye las tasas. Las cotizaciones no aceptadas de la versión anterior deben recalcularse; los pedidos ya aceptados conservan sus importes originales.

### Asignación directa con precio desde administración

El formulario del administrador solicita direcciones y códigos postales, calcula el precio con Routes API y muestra TPS/TVQ, propina, total y reparto interno. Se confirma el precio antes de asignar. `POST /admin/quotes` requiere administrador; `POST /deliveries` sin solicitud exige `quoteId`, direcciones coincidentes y `acceptPrice: true`. La cotización vence a los 10 minutos. Los reintentos con la misma cotización, repartidor y propina recuperan la entrega existente sin duplicar la notificación. Las entregas antiguas sin precio conservan sus datos.

### Avisos de nuevas solicitudes

Cada solicitud pública confirmada guarda un aviso en `request_emails` dentro de la misma transacción. El servidor intenta enviarlo inmediatamente y revisa la cola cada 30 segundos, aunque ningún navegador esté conectado. Usa las variables SMTP existentes y `PUBLIC_APP_URL`. El destinatario aprobado por defecto es `serviceclient@toutaunclicla.com`; se puede sustituir con `REQUEST_NOTIFICATION_EMAIL`. `REQUEST_EMAIL_ENABLED=false` desactiva estos avisos, independientemente de `ASSIGNMENT_EMAIL_ENABLED`. No se envían correos al calcular solamente una cotización ni se crean avisos para las solicitudes anteriores a esta actualización.

El correo FR/ES incluye referencia, restaurante o cliente, recogida, destino, contenido, horario, precio confirmado con impuestos y propina, y enlace al panel que exige acceso administrador. No incluye contraseñas ni tokens de seguimiento. El correo de asignación al livreur incluye sus direcciones, importe y propina.

Los avisos de solicitudes pendientes se reintentan hasta cinco veces con espera creciente y un identificador de mensaje estable. Las solicitudes procesadas o de más de 24 horas se omiten. Una interrupción después de la aceptación SMTP puede causar un duplicado; la aceptación SMTP tampoco garantiza recepción en la bandeja de entrada. «Comprobar correo» muestra por separado los contadores de avisos de solicitudes y asignaciones. La configuración se indica en el panel; comprobar la primera recepción real antes de depender de los avisos. Las pruebas utilizan emisores simulados y desactivan expresamente ambos envíos en los tests HTTP, incluso durante el build de Render.

### Cuentas de restaurante, recuperación y conservación del historial

- Desde Administración → Crear una cuenta se selecciona «Livreur» o «Restaurant». Las cuentas de restaurante incluyen correo, contraseña inicial, dirección habitual y código postal; acceden por `/restaurant`. Solo ven sus solicitudes autenticadas y su perfil. El formulario público sigue disponible; no se atribuyen solicitudes anteriores a un restaurante por coincidencia de nombre.
- `/demander` utiliza la sesión de restaurante para recuperar su recogida y vincular nuevas solicitudes a su cuenta. Los restaurantes quedan excluidos del listado de repartidores, del GPS y de las operaciones de administrador. Para mantener la compatibilidad de la tabla de usuarios, `account_type=restaurant` determina su rol efectivo sin reconstruir las cuentas existentes.
- `/forgot-password` envía un enlace al correo registrado. `/reset-password` permite elegir y confirmar una contraseña de 12–200 caracteres. El token aleatorio solo se guarda como hash, vence en 30 minutos y se invalida al usarlo; se revocan todas las sesiones y el GPS anterior. La respuesta de solicitud no revela si existe una cuenta. Hay un minuto de espera entre enlaces, máximo tres por correo en la ventana de uso, y un límite de solicitudes de recuperación por conexión. No se modifica ninguna contraseña hasta que el titular complete el formulario. Usa SMTP y `PUBLIC_APP_URL`; `PASSWORD_RESET_EMAIL_ENABLED=false` lo desactiva para pruebas. Los enlaces usan fragmentos, se retiran de la barra al cargar y las páginas no envían Referer. No se guardan tokens de recuperación en texto claro ni se envían contraseñas por correo. Un envío SMTP fallido requiere solicitar un nuevo enlace.
- Una entrega terminada conserva su fecha `completed_at`. Administrador y livreur ven los últimos 5 días; una cuenta de restaurante conserva sus entregas 10 días. La limpieza se ejecuta al arrancar, cada minuto y al consultar el historial. Se eliminan también las solicitudes y avisos vinculados cuando vence el plazo del registro. Las entregas compartidas con un restaurante se guardan hasta el día 10 aunque ya no aparezcan en administrador/livreur desde el día 5. Las entregas activas no se borran por antigüedad. Las entregas antiguas que no tenían fecha de finalización usan su fecha de creación como referencia de migración. Las cuentas, perfiles y credenciales no se borran con el historial.
- Las pruebas verifican aislamiento entre roles, conservación de datos activos, límites de 5/10 días, integridad de referencias, contraseña nueva, rechazo de la antigua, caducidad y uso único del enlace y cierre de sesiones. Los tests HTTP desactivan los envíos SMTP reales.

## Stripe y avisos de cotización y pago

El cliente calcula el precio, acepta el total CAD (TPS, TVQ y propina seleccionada) y continúa a Stripe Checkout. El servidor calcula el importe; no utiliza un importe enviado por el navegador. La nueva solicitud solo aparece para asignación después de un evento Stripe firmado con estado `paid`, moneda e importe correctos. Volver a la página de éxito o cancelar Checkout no confirma un pago. Los pagos y eventos repetidos reutilizan la solicitud y la notificación existentes.

Configurar como variables privadas en Render, sin incorporarlas al repositorio:

- `STRIPE_SECRET_KEY`: clave secreta del mismo entorno Stripe que se usará para cobrar.
- `STRIPE_WEBHOOK_SECRET`: secreto de firma del destino de eventos de esta aplicación.
- `PUBLIC_APP_URL`: `https://livraison.toutaunclicla.com`.

En Stripe crear un destino de eventos para `https://livraison.toutaunclicla.com/stripe/webhook`, con los eventos `checkout.session.completed` y `checkout.session.async_payment_succeeded`. Usar primero claves y eventos de prueba; para producción sustituir ambos secretos por los del entorno real. Nunca introducir claves en el HTML ni enviarlas por correo o chat. Sin configuración de pagos, las nuevas confirmaciones públicas devuelven 503 y no crean solicitudes sin cobrar. Las asignaciones manuales del administrador conservan su flujo propio; las solicitudes anteriores se identifican como anteriores al pago en línea.

La sesión Checkout mantiene el total aceptado durante aproximadamente 31 minutos y se reutiliza en los reintentos. Una vez vencida, debe iniciarse otra solicitud. El seguimiento protegido permite retomar un enlace de pago abierto; no habilita asignación hasta confirmar el pago.

El administrador dispone de dos secciones: últimas 50 cotizaciones públicas de las últimas 24 horas y solicitudes pagadas. Las alarmas tienen tonos distintos y requieren activar el sonido con un botón. El panel consulta cada 12 segundos; pestañas suspendidas, cerradas o sin Internet no garantizan reproducción ni aviso inmediato.

Los correos se procesan en el servidor, con colas SQLite separadas y hasta cinco intentos, aunque el administrador esté desconectado:

- Cotización calculada: indica expresamente que el aviso no confirma pago; muestra precio con impuestos y sin propina. No crea una entrega asignable.
- Pago Stripe confirmado: indica que la entrega está lista para asignar; incluye el total realmente cobrado y la propina.

Ambos utilizan SMTP existente y `REQUEST_NOTIFICATION_EMAIL` (por defecto `serviceclient@toutaunclicla.com`). `QUOTE_EMAIL_ENABLED=false` desactiva solo los avisos de cotización; `REQUEST_EMAIL_ENABLED=false` desactiva los avisos de solicitudes y cotizaciones. Las colas se procesan al generarse el evento y cada 30 segundos. Un reinicio no vuelve a enviar los mensajes ya marcados como enviados. La aceptación SMTP no garantiza recepción en bandeja de entrada.

Rechazar una solicitud pagada no reembolsa automáticamente: el administrador debe tramitar el reembolso desde Stripe y comprobarlo. No se ha agregado Stripe Connect ni pago automático a repartidores. Probar Checkout y verificar una entrega real de ambos correos antes de activar cobros de producción.
