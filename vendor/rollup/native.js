import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
const require=createRequire(import.meta.url);
const manifest=require.resolve('rollup/package.json');
if(require(manifest).version!=='4.64.5')throw Error('Vendored Rollup requires its matching 4.64.5 parser');
export const {parse,parseAsync,xxhashBase16,xxhashBase64Url,xxhashBase36}=require(join(dirname(manifest),'dist/native.js'));
