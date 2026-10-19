# ToutAunClicLa · Livraison móvil — primera base técnica

Fecha: 19 de octubre de 2026. Versión 0.1.0.

Este proyecto contiene código fuente de una primera base para iPhone y Android y un panel web de administración. **No es todavía un APK ni una app instalada o publicada.** No se ha conectado al sitio existente ni se ha desplegado un servidor. No usa usuarios, pedidos ni ubicaciones reales.

## Lo que incluye

- App de repartidor en francés y español con inicio de sesión.
- Explicación y autorización del GPS antes de comenzar un turno.
- Código para compartir posición en segundo plano, indicador de iOS y servicio visible en Android.
- Fin del turno: se elimina la autorización local y se invalida el turno en el servidor. Los envíos tardíos del turno anterior se rechazan.
- Panel web con cuentas de repartidor, mapa Google Maps, estado de conexión y fecha y precisión del último GPS.
- Asignación manual a un repartidor disponible con GPS reciente. Recogida y entrega se confirman en la app.
- Botón para abrir la navegación de Google Maps hacia la recogida o el destino.
- Contadores globales de entregas en curso y completadas; lista de entregas con repartidor.
- Base SQLite local al servidor, contraseñas con scrypt y sesiones revocables de siete días.

El panel distingue disponible, hacia recogida, en entrega, desconectado y GPS desactualizado. Un GPS con más de 90 segundos no se considera reciente. La intención es pedir actualizaciones aproximadamente cada 12 segundos o por desplazamiento; el sistema operativo, la batería y la red determinan la frecuencia real. La app solicita permisos solamente al activar el servicio. No activa automáticamente el GPS al iniciar sesión.

## Lo que falta para ponerla en uso

1. Elegir y desplegar un servidor con HTTPS y almacenamiento persistente y configurar el dominio de la API.
2. Configurar Google Maps JavaScript API para el panel. Restringir la clave de navegador al dominio del panel y a esa API; las claves de navegador son públicas por diseño.
3. Instalar las dependencias móviles, revisar su compatibilidad con Expo y compilar para dispositivos reales.
4. Probar permisos, pantalla bloqueada, pérdida de señal, reconexión, cierre forzado y consumo de batería en iPhone y Android.
5. Configurar las cuentas y certificados de distribución de Apple, Google y Expo según el método de instalación elegido.
6. Integrar la recepción de pedidos desde ToutAunClicLa con su API autenticada y verificaciones de origen e idempotencia. Este proyecto no asume conocer esa API.

Quedan para próximas fases: solicitudes de clientes y restaurantes no afiliados, registro público, notificaciones push, aceptación o rechazo del pedido, tarifas por distancia, cálculo de ruta y ETA dentro del mapa, reasignaciones y cancelaciones, estadísticas detalladas por periodo y usuario, recuperación de contraseña, desactivación de cuentas y gestión de dispositivos. El código actual permite un pedido activo por repartidor y asignación manual.

## Estructura

```
mobile/              App React Native con Expo
  App.js             Interfaz del repartidor FR/ES
  src/tracking.js    Permisos y tarea de ubicación en segundo plano
  src/api.js         Comunicación HTTPS y sesión
server/
  core.mjs           Reglas, usuarios, GPS y pedidos
  server.mjs         API y panel web
  create-user.mjs    Alta del primer administrador
  public/index.html  Panel de administración FR/ES
  test/              Pruebas de autorización y operación
```

## Arrancar el servidor de desarrollo

Requiere Node.js 24 o posterior. No requiere paquetes externos para el servidor.

En una terminal:

```bash
cd server
npm test
node create-user.mjs
```

El comando de alta lee un objeto JSON desde la entrada estándar. Enviar `email`, `name`, `password` (mínimo 12 caracteres) y `role: "admin"`; cerrar la entrada con Ctrl+D en macOS/Linux. Usar datos y contraseña propios, sin guardarlos en el repositorio ni en el historial de comandos. Después:

```bash
npm start
```

Abrir `http://127.0.0.1:8787` para el panel. Crear repartidores desde el panel después de iniciar sesión. Sin clave de Google, se puede probar la lista y las operaciones; el mapa muestra que falta configuración.

Variables del servidor:

| Variable | Uso |
| --- | --- |
| `PORT` | Puerto; por defecto 8787 |
| `HOST` | Dirección de escucha; por defecto 127.0.0.1 |
| `DATABASE_PATH` | Archivo SQLite; por defecto livraison.sqlite |
| `GOOGLE_MAPS_BROWSER_KEY` | Clave de navegador para el mapa del panel |

Publicar detrás de un proxy HTTPS. El enlace del servidor debe llegar desde el teléfono; `localhost` en el teléfono apunta al propio teléfono. No publicar directamente el puerto HTTP. El servidor no acepta CORS de otros orígenes: el panel se sirve desde la misma API. Los clientes móviles nativos no requieren CORS.

Antes de producción: backups, política de retención y acceso, revisión de seguridad, limitación de peticiones en el proxy y configuración de supervisión. La limitación básica de login por IP está en memoria; configurar límites por cuenta y cliente en el despliegue. No activar captura de cuerpos de peticiones de login o GPS en los registros del proxy. La ubicación se guarda como último punto, sin historial de trayectos; se borra al finalizar el turno en el servidor. Conserva fecha de consentimiento del último turno.

## Preparar la app móvil

Base seleccionada: Expo SDK 55, React 19.2 y React Native 0.83. No se afirma que esta sea la última versión disponible; las dependencias se deben revisar antes de la primera compilación.

```bash
cd mobile
cp .env.example .env
```

Editar `.env` con `EXPO_PUBLIC_API_URL=https://DOMINIO-REAL-DEL-SERVIDOR`. Es una URL pública, nunca una contraseña o clave administrativa. Luego:

```bash
npm install
npx expo install --fix
npx expo-doctor
```

Revisar los cambios generados por `expo install --fix` y conservar el lockfile de la instalación definitiva. Se incluye el lockfile de la instalación verificada. Las dependencias descargadas no se incluyen en el ZIP; ejecutar npm ci para reproducir la instalación.

Para un Android con entorno de desarrollo nativo preparado:

```bash
npm run android
```

Para iPhone, se necesita macOS con Xcode y firma o un servicio de compilación. Con ese entorno:

```bash
npm run ios
```

También se incluye `eas.json` con perfiles de desarrollo, prueba y producción. Antes de usar compilación en la nube, configurar la cuenta, el identificador del proyecto y la firma; no hay cuentas vinculadas ni compilaciones iniciadas en esta entrega. Los identificadores `com.toutaunclicla.livraison` son propuestos y deben confirmarse en las cuentas de publicación.

**Expo Go no sirve para validar el seguimiento en segundo plano.** Usar una compilación instalada. El seguimiento puede detenerse cuando el usuario fuerza el cierre de la app o el sistema la termina; no se promete funcionamiento ilimitado con la app cerrada. Si el teléfono se queda sin conexión, no se guardan rutas para reenvío: se intenta enviar la siguiente posición nueva cuando el sistema entregue una actualización. El panel muestra el GPS anterior como desactualizado. Si falla la confirmación remota del fin del turno, se detiene el envío local y el panel puede conservar el último punto hasta marcarlo desactualizado.

## Validación realizada

- Cuatro pruebas de integración de reglas del servidor: credenciales y revocación, consentimiento y rotación de turno, rechazo de GPS incorrecto o antiguo, aislamiento de pedidos y orden de recogida/entrega.
- Revisión sintáctica del servidor y prueba HTTP del flujo completo con datos ficticios.
- Dependencias móviles instaladas y comprobadas con `expo install --check`. Exportación de los paquetes JavaScript/Hermes para Android y iOS completada sin errores; esto no equivale a compilar un APK o IPA ni a probar APIs nativas en un teléfono.
- Revisión sintáctica de las pantallas móviles y del JavaScript del panel. No se realizó inspección visual del panel: el navegador de pruebas no estaba instalado en el entorno.
- No se ha compilado un binario ni probado la app en dispositivos, ni validado un mapa de Google con credenciales reales. No se ha modificado la página de livraison ya existente.

## Referencias técnicas

- https://docs.expo.dev/versions/v55.0.0/sdk/location/
- https://docs.expo.dev/versions/v55.0.0/sdk/task-manager/
- https://docs.expo.dev/versions/v55.0.0/sdk/securestore/
- https://expo.dev/blog/upgrading-to-sdk-55

Las referencias describen la configuración y las limitaciones de la plataforma; no sustituyen las pruebas reales del proyecto.
