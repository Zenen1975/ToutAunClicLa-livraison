import {bootstrapAdmin} from './bootstrap-admin.mjs';
bootstrapAdmin(process.env.DATABASE_PATH || 'livraison.sqlite');
const {server}=await import('./server.mjs');
server.listen(Number(process.env.PORT || 8787),process.env.HOST || '127.0.0.1',()=>console.log('Servicio de livraison iniciado.'));
