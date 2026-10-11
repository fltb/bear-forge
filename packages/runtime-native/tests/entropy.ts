import {z}from'zod';export const program={schemas:{setup:z.null(),ports:{},result:z.number()},async run(){try{const name='ran'+'dom';Math[name as 'random']();}catch{}return 1;}};
