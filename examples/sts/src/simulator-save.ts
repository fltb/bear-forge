import type {SimulatorSave,StoredSimulatorSave} from './simulator.types.ts';

/** Persistent Context ABI, independent of source hashes, UI and Node versions.
 * Bump for component/entity/block/local layout or meaning changes. Add an explicit
 * Context migration here before accepting an older ABI; never replay commands.
 * Numeric balance changes that preserve that layout use the current rules.
 */
export const simulatorContextVersion=1;

export function migrateSimulatorSave(save:StoredSimulatorSave,program:string):SimulatorSave{
  if(save.format===1){
    // The only provable legacy conversion: exact original code identity. Existing
    // pre-baseline games have been retired; an unrelated old Context is never guessed.
    if(save.program!==program)throw Error('此存档属于旧版规则，已作废；请从最新版开新局。原文件保留。');
    const now=new Date().toISOString();
    return {...save,format:2,contextVersion:simulatorContextVersion,createdAt:now,savedAt:now};
  }
  if(save.format!==2)throw Error('无法读取此存档格式；请使用支持它的新版程序，原文件保留。');
  if(save.contextVersion!==simulatorContextVersion)throw Error(`存档现场版本 ${save.contextVersion} 无法迁移到 ${simulatorContextVersion}；原文件保留，不会自动开新局。`);
  return save;
}
