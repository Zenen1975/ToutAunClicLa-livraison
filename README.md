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

