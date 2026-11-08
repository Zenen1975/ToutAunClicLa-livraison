# Sugerencias de direcciones

En Render, servicio `ToutAunClicLa-livraison-1`, añadir `GOOGLE_PLACES_API_KEY` y guardar/reiniciar el despliegue. Se necesita Places API (New) habilitada y facturación activa en el proyecto de Google. Usar una clave de servidor restringida a Places API (New); las restricciones de sitios web del mapa del administrador no sirven para estas solicitudes del servidor. La clave nunca se envía al navegador.

Campos conectados: recogida/destino del formulario público `/demander` (incluido el acceso de restaurante), recogida habitual `/restaurant`, recogida/destino en la asignación del administrador y recogida al crear una cuenta de restaurante. El repartidor web y Android reciben las direcciones completas de las entregas asignadas y mantienen su botón de mapa; actualmente no tienen formulario para editar direcciones. No hace falta una APK nueva para este cambio web/servidor.

La selección es explícita: escribir tres caracteres muestra hasta cinco sugerencias; clic o flechas y Enter resuelven la dirección y el código postal. Dirección y postal siguen editables. Si falta postal, se deja vacío con aviso. Seleccionar dispara los eventos de cambio existentes para invalidar una cotización anterior. Sin Google se permite entrada manual. No se guardan búsquedas ni claves en el cliente. API pública para soportar solicitudes sin cuenta, límite 90 consultas/minuto por conexión y 300/minuto global, tiempos máximos de seis segundos; las cotizaciones siguen siendo autoritativas en servidor.

Pruebas: `npm test` en server. Prueba DOM opcional (requiere jsdom como dependencia de desarrollo externa): `JSDOM_MODULE=/ruta/jsdom node server/test/places-dom-check.cjs`. Prueba de navegador opcional: `PLAYWRIGHT_MODULE=/ruta/playwright/index.mjs CHROMIUM_PATH=/ruta/chromium node server/test/places-browser-check.mjs`. No se ha probado con una clave real ni en Render desde este entorno. La corrección GPS Android PR #6 permanece independiente.

Fuentes: https://developers.google.com/maps/documentation/places/web-service/place-autocomplete y https://developers.google.com/maps/documentation/places/web-service/place-details
