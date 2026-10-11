import {build} from 'esbuild';
await build({entryPoints:['src/effects.cjs'],bundle:true,outfile:'dist/effects.cjs',platform:'node',format:'cjs',logLevel:'silent'});
