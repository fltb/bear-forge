export type Relation = {
  id: string;
  kind: 'matchup' | 'replacement' | 'interaction';
  policy: string;
  opponent: string;
  phase: 'discovery' | 'confirmation';
  status: 'positive' | 'negative' | 'equivalent' | 'unknown' | 'missing' | 'not-applicable';
  effect: number | null;
  interval: [number, number] | null;
  blocks: number;
  missing: number;
  confirmed: boolean;
  candidateCount: number;
  opportunities: Record<string, {
    carry: number;
    draw: number;
    available: number;
    play: number;
  }>;
  evidence: string[];
};
