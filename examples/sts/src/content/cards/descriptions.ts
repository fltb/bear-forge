import type {CardConfig} from '../../rules/card-instances.types.ts';

/** Project only the actual assembled card program. Missing text stays explicit;
 * no independent card-id rules table can conceal an undescribed callback. */
export function cardDescription(configuration:Pick<CardConfig,'text'>|undefined):string|undefined {
  return configuration?.text;
}
