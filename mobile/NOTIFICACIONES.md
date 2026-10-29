# Alertas de entregas Android

Esta versión solicita permiso de notificación al iniciar sesión, registra el teléfono en el servidor y usa el jingle de ToutAunClicLa durante cinco segundos. El botón de prueba programa una notificación local cinco segundos después: permite bloquear la pantalla antes de escucharla.

## Actualizar

1. Guarda una copia de tu archivo `mobile/google-services.json`.
2. Descarga y extrae esta versión. Copia ese archivo a su carpeta `mobile`. La clave privada Firebase Admin SDK permanece fuera del proyecto; ya está cargada en EAS.
3. En `mobile`, ejecuta `npm ci`, luego `npx expo config`.
4. El servidor debe incluir `server/native-push.mjs` y los cambios de esta versión antes de probar asignaciones. No cambia la base de datos existente: añade tablas.
5. Genera una APK: en CMD ejecuta `set EAS_NO_VCS=1` y después `npx eas-cli build --platform android --profile preview`.
6. Instala como actualización, inicia sesión y autoriza las notificaciones. La tarjeta «Alertas de entregas» muestra si el registro al servidor funcionó.

## Verificación en Samsung

- Pulsa «Probar sonido»: el jingle debe durar cinco segundos, con la app visible y con la pantalla bloqueada.
- Asigna una entrega nueva desde el administrador: debe aparecer una notificación y sonar sin abrir el correo. Tócala para volver a la app y actualizar la lista.
- Comprueba volumen de notificaciones, modo No molestar y canal «Livraisons / Entregas» si llega la notificación sin sonido.
- Android puede impedir alertas tras «Forzar detención» hasta abrir de nuevo la app. Las restricciones de batería, la falta de conexión y los ajustes de sonido también influyen.

El botón prueba el sonido local; la asignación real prueba además Firebase, Expo y el servidor. Una credencial cargada o una prueba local correcta no demuestran por sí solas que el envío remoto funciona. Las entregas pendientes de envío se reintentan hasta una hora y se comprueban recibos de Expo. No se garantiza entrega exactamente una vez si la conexión falla después de que Expo acepte el envío.

La sesión dura siete días. Cerrar sesión revoca las alertas de esa sesión. Al cambiar de cuenta en el mismo teléfono se retira el registro anterior. No se muestran direcciones en el texto de la alerta.

El icono con el logo sigue pendiente del archivo gráfico.
