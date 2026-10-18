import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';
const server = await createServer({server:{host:'localhost',port:5173,strictPort:true}});
await server.listen();
const child=spawn(electron,['.'],{env:{...process.env,JSCRIPT_DEV:'1'},stdio:'inherit',windowsHide:false});
child.on('exit',async code=>{await server.close();process.exit(code??0)});
process.on('SIGINT',()=>child.kill());
