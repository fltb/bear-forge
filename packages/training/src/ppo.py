"""Own clipped PPO, Monte Carlo critic and optional teacher cross-entropy."""
import math
import numpy as np
import torch
from model import WIDTH, MAX_TOKENS, pack


def prepared(row):
    result = dict(row)
    for key in ('tokens', 'actions'):
        value = np.asarray(row[key], dtype=np.float32)
        limit = MAX_TOKENS if key == 'tokens' else 100000
        if value.ndim != 2 or value.shape[1] != WIDTH or not 1 <= len(value) <= limit or not np.isfinite(value).all():
            raise ValueError('Invalid encoded ' + key)
        result[key] = torch.from_numpy(value.copy())
    if 'index' in row:
        if not isinstance(row['index'], int) or not 0 <= row['index'] < len(result['actions']):
            raise ValueError('Invalid selected candidate')
        if not math.isfinite(row['logProbability']) or row['logProbability'] > 0 or not -1 <= row['return'] <= 1:
            raise ValueError('Invalid probability or terminal utility')
        teacher = row.get('teacherIndex')
        if teacher is not None and (not isinstance(teacher, int) or not 0 <= teacher < len(result['actions'])):
            raise ValueError('Invalid teacher label')
    return result


def clipped_loss(log_probability, old_log_probability, advantages, clip):
    ratio = (log_probability - old_log_probability).exp()
    objective = torch.minimum(ratio * advantages, ratio.clamp(1-clip, 1+clip) * advantages)
    return -objective.mean(), ratio


def update(model, optimizer, rows, settings):
    model.eval()  # dropout is zero; collection and recomputation must be identical.
    old_values = []
    with torch.no_grad():
        for start in range(0, len(rows), settings['minibatch']):
            part = rows[start:start+settings['minibatch']]
            logits, values = model(*pack(part))
            selected = torch.tensor([r['index'] for r in part])
            logs = logits.log_softmax(1).gather(1, selected[:, None]).squeeze(1)
            recorded = torch.tensor([r['logProbability'] for r in part], dtype=torch.float64)
            if (logs-recorded).abs().max().item() > 2e-5:
                raise ValueError('Rollout probabilities do not match its frozen policy')
            old_values.extend(values.tolist())
    targets = torch.tensor([r['return'] for r in rows], dtype=torch.float32)
    advantages = targets - torch.tensor(old_values)
    if len(rows) > 1:
        advantages = (advantages-advantages.mean()) / advantages.std(unbiased=False).clamp(min=1e-8)
    totals = {}; steps = 0
    for _ in range(settings['epochs']):
        for indices in torch.randperm(len(rows)).split(settings['minibatch']):
            part = [rows[i] for i in indices.tolist()]
            logits, values = model(*pack(part))
            logs = logits.log_softmax(1)
            chosen = torch.tensor([r['index'] for r in part])
            new_log = logs.gather(1, chosen[:, None]).squeeze(1)
            old_log = torch.tensor([r['logProbability'] for r in part], dtype=torch.float64)
            policy_loss, ratios = clipped_loss(new_log, old_log, advantages[indices], settings['clip'])
            value_loss = ((values-targets[indices])**2).mean()
            probabilities = logs.exp()
            entropy = -(probabilities * logs.masked_fill(~torch.isfinite(logs), 0)).sum(1).mean()
            teacher_rows = [i for i, r in enumerate(part) if r.get('teacherIndex') is not None]
            teacher_loss = torch.zeros((), dtype=logits.dtype)
            if teacher_rows:
                teacher_loss = -logs[teacher_rows, [part[i]['teacherIndex'] for i in teacher_rows]].mean()
            loss = policy_loss + settings['valueCoefficient'] * value_loss - settings['entropy'] * entropy + settings['teacherCoefficient'] * teacher_loss
            if not torch.isfinite(loss):
                raise ValueError('Non-finite training loss')
            optimizer.zero_grad()
            loss.backward()
            norm = torch.nn.utils.clip_grad_norm_(model.parameters(), settings['gradientClip'], error_if_nonfinite=True)
            optimizer.step()
            stats = {'loss': loss.item(), 'policyLoss': policy_loss.item(), 'valueLoss': value_loss.item(),
                'entropy': entropy.item(), 'teacherLoss': teacher_loss.item(), 'gradientNorm': norm.item(),
                'approximateKl': ((ratios-1)-(new_log-old_log)).mean().item(),
                'clipFraction': ((ratios-1).abs() > settings['clip']).double().mean().item()}
            for key, value in stats.items():
                if not math.isfinite(value): raise ValueError('Non-finite training metric')
                totals[key] = totals.get(key, 0) + value
            steps += 1
    return {key: value/steps for key, value in totals.items()}, steps
