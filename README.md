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
