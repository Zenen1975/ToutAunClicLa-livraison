import {createStore} from './core.mjs';
// Read password from stdin so it is not placed in shell history or process arguments.
let raw='';for await(const chunk of process.stdin)raw+=chunk;
try { const u=createStore(process.env.DATABASE_PATH || 'livraison.sqlite').createUser(JSON.parse(raw)); console.log(JSON.stringify(u)); }
catch(e){console.error(e.message);process.exitCode=1;}
