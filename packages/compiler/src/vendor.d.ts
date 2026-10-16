declare module '@babel/core' {
  export function parseSync(source: string, options: any): any;
  export function transformFromAstSync(ast: any, source: string, options: any): any;
  export function transformSync(source: string, options: any): any;
}
