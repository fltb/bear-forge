import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import cytoscape from 'cytoscape';
import './style.css';
async function read(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw Error('读取失败 ' + r.status);
  return r.json();
}
const display = (value: string) => ({
  discovery:'发现',confirmation:'独立确认',complete:'已完成',positive:'改善',negative:'恶化',equivalent:'实际等效',unknown:'未决',
  'candidates-frozen':'候选和确认预算已冻结','additional-discovery':'追加发现样本','incomplete-blocks':'存在不完整配对块',
  'insufficient-confirmation-budget':'剩余预算不足以确认','discovery-budget-exhausted':'发现预算已用尽',
  'independent-confirmation-complete':'独立确认已完成','confirmation-budget-exhausted':'确认预算已用尽，关系仍未决'
} as Record<string,string>)[value] ?? value;
function App() {
  const [experiment, setExperiment] = useState<any>(null),
    [analysis, setAnalysis] = useState<any>(null),
    [tasks, setTasks] = useState<any[]>([]),
    [taskOffset, setTaskOffset] = useState(0),
    [taskNext, setTaskNext] = useState<number | null>(null),
    [evidenceOffset, setEvidenceOffset] = useState(0),
    [policy, setPolicy] = useState('全部'),
    [opponent, setOpponent] = useState('全部'),
    [task, setTask] = useState(''),
    [player, setPlayer] = useState('0'),
    [evidence, setEvidence] = useState<any>(null),
    [error, setError] = useState('');
  const graph = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active=true;
    const refresh=()=>Promise.all([read('/api/experiment'),read('/api/relations')]).then(([e,a])=>{
      if(active){setExperiment(e);setAnalysis(a);}
    }).catch(e=>{if(active)setError(String(e));});
    void refresh();
    const timer=setInterval(()=>void refresh(),5000);
    return ()=>{active=false;clearInterval(timer);};
  }, []);
  useEffect(() => {
    let active = true;
    read('/api/tasks?after=' + taskOffset).then(page => {
      if (active) { setTasks(page.values); setTaskNext(page.next); }
    }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [taskOffset, experiment?.completed]);
  const selectTask = (id: string) => { setTask(id); setEvidenceOffset(0); };
  const relations = (analysis?.relations ?? []).filter((r: any) => (policy === '全部' || r.policy === policy) && (opponent === '全部' || r.opponent === opponent));
  useEffect(() => {
    if (!graph.current) return;
    const nodes = new Set<string>();
    const elements: any[] = [];
    for (const r of relations) {
      const source = r.source ? '卡组:' + r.source : r.kind === 'matchup' ? '策略:' + r.policy : r.kind === 'replacement' ? '卡牌:spark' : '组合:spark+guard';
      const target = r.target ? '卡组:' + r.target : r.kind === 'matchup' ? '策略:' + r.opponent : r.kind === 'replacement' ? '卡牌:blast' : '组合:blast+repair';
      nodes.add(source);
      nodes.add(target);
      if (source !== target) elements.push({
        data: {
          id: r.id + '-' + r.phase,
          source,
          target,
          label: r.kind + ' ' + r.status + ' ' + (r.effect ?? '缺失'),
          status: r.status,
          evidence: r.evidence,
          phase: r.phase
        }
      });
    }
    for (const id of nodes) elements.push({
      data: {
        id,
        label: id
      }
    });
    const cy = cytoscape({
      container: graph.current,
      elements,
      layout: {
        name: 'circle'
      },
      style: [{
        selector: 'node',
        style: {
          label: 'data(label)',
          'background-color': '#596ec5'
        }
      }, {
        selector: 'edge',
        style: {
          label: 'data(label)',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          width: 2,
          'line-color': '#aaa',
          'target-arrow-color': '#aaa'
        }
      }, {
        selector: 'edge[status="positive"]',
        style: {
          'line-color': '#25805d',
          'target-arrow-color': '#25805d'
        }
      }]
    });
    cy.on('tap', 'edge', (event: any) => {
      const ids = event.target.data('evidence');
      if (ids?.length) selectTask(ids[0]);
    });
    return () => cy.destroy();
  }, [analysis, policy, opponent]);
  useEffect(() => {
    let active = true;
    setEvidence(null);
    if (task) read('/api/evidence?task=' + encodeURIComponent(task) + '&player=' + player + '&after=' + evidenceOffset)
      .then(value => { if (active) setEvidence(value); }).catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [task, player, evidenceOffset]);
  return <main><h1>Bear Forge</h1><p>固定策略下的条件关系与对局证据。探索结果和独立确认结果分别显示。</p>{error && <p role="alert">{error}</p>}<section><h2>实验进度</h2>{experiment?.config ? <><strong>{experiment.config.id}</strong><p>{experiment.completed} / {experiment.total} 个任务 · 正常结束 {experiment.counts.ended} · 故障 {experiment.counts.fault} · 截断 {experiment.counts.truncated}</p></> : <p>尚未登记实验</p>}</section>{analysis?.trainingSamples === 0 && <section><h2>卡组评估</h2><p>阶段：{display(analysis.stage)} · 停止/推进原因：{display(analysis.reason) || '首批执行中'}</p><p>已用 {experiment?.completed ?? 0} / 总预算 {analysis.maxGames} 局 · 已计划 {analysis.plannedGames} 局 · 新增训练 {analysis.trainingSamples} 样本</p><p>实际差异阈值 {((analysis.configSummary?.margin ?? 0)*100).toFixed(1)} 个百分点 · 确认错误率上限 {analysis.configSummary?.alpha} · 发现结果用于筛选，最终结论以独立确认为准。</p><p>冻结候选：{analysis.candidates?.join('，') || '无'} · 已完成批次任务耗时 {((analysis.cost?.milliseconds ?? 0)/1000).toFixed(1)} 秒（并发任务之和）</p><details><summary>批次与预算</summary><pre>{JSON.stringify(analysis.batches,null,2)}</pre></details><p>矩阵与效应在每批完成后更新；对局进度和证据实时可查。</p><h3>对战矩阵</h3><table><thead><tr><th>卡组</th><th>操作策略 / 对手环境</th><th>阶段</th><th>胜平得分均值</th><th>有效局 / 缺失</th></tr></thead><tbody>{(analysis.matrix ?? []).filter((r:any)=>(policy==='全部'||r.policy===policy)&&(opponent==='全部'||r.opponent===opponent)).map((r:any)=><tr key={[r.variant,r.policy,r.opponent,r.phase].join('/')}><td>{r.variant}</td><td>{r.policy} / {r.opponent}</td><td>{display(r.phase)}</td><td>{r.score===null?'缺失':(100*r.score).toFixed(1)+'%'}</td><td>{r.games} / {r.missing}</td></tr>)}</tbody></table><details><summary>指定环境权重下的综合效应</summary><pre>{JSON.stringify(analysis.weighted,null,2)}</pre></details><p>策略依赖：{analysis.dependencies?.length ? JSON.stringify(analysis.dependencies) : '尚未确认'}</p><p>策略适应疑点：{(analysis.relations ?? []).filter((r:any)=>r.adaptationFlag).map((r:any)=>r.id).join('，') || '无'}（有机会但未使用仅提示复核）</p></section>}<section><h2>条件筛选</h2><label>策略 <select value={policy} onChange={e => setPolicy(e.target.value)}>{['全部', ...(experiment?.config?.policies ?? [])].map(x => <option key={x}>{x}</option>)}</select></label><label>对手 <select value={opponent} onChange={e => setOpponent(e.target.value)}>{['全部', ...(experiment?.config?.opponents ?? []).map((x:any)=>typeof x==='string'?x:x.id)].map(x => <option key={x}>{x}</option>)}</select></label><p>规则 forge-duel-v1 · 固定构筑/策略 · 不代表最优玩法或生态适应</p></section><section><h2>关系图</h2><div ref={graph} className="graph" />{!relations.length && <p>尚无关系数据</p>}</section><section><h2>指标与覆盖</h2><table><thead><tr><th>关系</th><th>条件</th><th>阶段</th><th>效应 / 区间</th><th>完整块 / 缺失</th><th>判断</th><th>证据</th></tr></thead><tbody>{relations.map((r: any) => <tr key={r.id + r.phase}><td>{r.label ?? r.kind}</td><td>{r.policy} / {r.opponent}</td><td>{display(r.phase)}</td><td>{r.effect === null ? '缺失' : r.effect.toFixed(3)} / {r.interval?.map((n: number) => n.toFixed(3)).join(' ~ ') ?? '未知'}</td><td>{r.blocks} / {r.missing}</td><td>{display(r.status)}</td><td><button disabled={!r.evidence.length} onClick={() => selectTask(r.evidence[0])}>查看</button><details><summary>机会分母</summary><pre>{JSON.stringify(r.opportunitiesByVariant ?? r.opportunities, null, 2)}</pre></details></td></tr>)}</tbody></table></section><section><h2>证据对局</h2><select value={task} onChange={e => selectTask(e.target.value)}><option value="">选择对局</option>{task && !tasks.some(t => t.id === task) && <option value={task}>{task} · 当前证据</option>}{tasks.map(t => <option key={t.id} value={t.id}>{t.id} · {t.status}</option>)}</select><button disabled={taskOffset === 0} onClick={() => setTaskOffset(Math.max(0, taskOffset - 200))}>上一页对局</button><button disabled={taskNext === null} onClick={() => setTaskOffset(taskNext!)}>下一页对局</button><select value={player} onChange={e => { setPlayer(e.target.value); setEvidenceOffset(0); }}><option value="0">玩家 0 可见</option><option value="1">玩家 1 可见</option><option value="audit">分析审计（策略当时未知）</option></select>{evidence && <><p>{evidence.scope} · {evidence.status}</p><pre>{JSON.stringify(evidence.values, null, 2)}</pre><button disabled={evidenceOffset === 0} onClick={() => setEvidenceOffset(Math.max(0, evidenceOffset - 100))}>上一页证据</button><button disabled={evidence.next === null} onClick={() => setEvidenceOffset(evidence.next)}>下一页证据</button></>}</section></main>;
}
createRoot(document.getElementById('root')!).render(<App />);
