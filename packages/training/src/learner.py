"""Persistent own learner: immutable collection versions and recoverable rollouts."""
import json
import hashlib
import os
from pathlib import Path
import resource
import signal
import sys
import tempfile
from time import perf_counter
import uuid
from collections import Counter
import torch
from model import CardTransformer, pack
from ppo import prepared, update

IMPLEMENTATION = hashlib.sha256(b''.join((Path(__file__).parent/name).read_bytes() for name in ('model.py','ppo.py','learner.py'))).hexdigest()

DEFAULTS = dict(rolloutSamples=1024, minibatch=32, epochs=4, learningRate=3e-4,
                clip=.2, entropy=.01, valueCoefficient=.5, teacherCoefficient=.2,
                gradientClip=.5, dimension=48, layers=2)


class Learner:
    def __init__(self, seed=7, settings=None):
        torch.set_num_threads(2)
        torch.manual_seed(seed)
        self.settings = {**DEFAULTS, **(settings or {})}
        self.model = CardTransformer(self.settings['dimension'], self.settings['layers'])
        self.optimizer = torch.optim.Adam(self.model.parameters(), lr=self.settings['learningRate'])
        self.version = str(uuid.uuid4())
        self.samples = self.consumed = self.updates = self.optimizer_steps = 0
        self.pending = []
        self.last_stats = None
        self.phases = Counter()
        self.metrics = dict(inferenceMilliseconds=0, updateMilliseconds=0, inferenceRequests=0, candidateMax=0)

    def status(self):
        return dict(version=self.version, samples=self.samples, consumed=self.consumed, updates=self.updates,
            optimizerSteps=self.optimizer_steps, pendingSamples=len(self.pending), phases=dict(self.phases),
            implementationDigest=IMPLEMENTATION, settings=self.settings, lastStats=self.last_stats, architecture='card-transformer-ppo-v1', parameters=sum(p.numel() for p in self.model.parameters()),
            metrics={**self.metrics, 'peakRssBytes':resource.getrusage(resource.RUSAGE_SELF).ru_maxrss*(1 if sys.platform=='darwin' else 1024)})

    def dispatch(self, message):
        command = message['command']
        if command == 'status': return self.status()
        if command == 'configure':
            settings = {**DEFAULTS, **message['settings']}
            if set(settings) != set(DEFAULTS): raise ValueError('Unknown learner setting')
            if self.samples or self.updates: raise ValueError('Configure only a new learner')
            self.__init__(message.get('seed',7), settings)
            return self.status()
        if command == 'score':
            started = perf_counter()
            self.model.eval()
            with torch.inference_mode():
                logits, value = self.model(*pack([prepared(message['features'])]))
            values = logits[0].tolist()
            if not all(torch.isfinite(logits[0])): raise ValueError('Non-finite logits')
            self.metrics['inferenceMilliseconds'] += (perf_counter()-started)*1000
            self.metrics['inferenceRequests'] += 1
            self.metrics['candidateMax'] = max(self.metrics['candidateMax'],len(values))
            return dict(version=self.version, logits=values, value=value.item())
        if command == 'learn':
            if message['version'] != self.version: raise ValueError('Stale rollout version')
            if not message['rows'] or len(message['rows']) > 20000: raise ValueError('Expected a bounded completed episode')
            rows = [prepared(row) for row in message['rows']]
            # Every stored transition retains the actual request, player and behavior version.
            for row in rows:
                if row['version'] != self.version: raise ValueError('Mixed policy versions')
                if not row.get('requestId') or not row.get('player') or not row.get('phase'): raise ValueError('Missing accepted decision identity')
            identities=[row['requestId'] for row in rows]
            if len(set(identities))!=len(identities) or set(identities)&{row['requestId'] for row in self.pending}:
                raise ValueError('Duplicate accepted transition')
            self.pending.extend(rows)
            self.samples += len(rows)
            self.phases.update(row['phase'] for row in rows)
            stats = None
            if len(self.pending) >= self.settings['rolloutSamples']:
                started = perf_counter()
                stats, steps = update(self.model,self.optimizer,self.pending,self.settings)
                self.last_stats = stats
                self.optimizer_steps += steps
                self.consumed += len(self.pending)
                self.pending = []
                self.updates += 1
                self.version = str(uuid.uuid4())
                self.metrics['updateMilliseconds'] += (perf_counter()-started)*1000
            return {**self.status(),'stats':stats}
        if command == 'save':
            path = Path(message['path']); path.parent.mkdir(parents=True,exist_ok=True)
            state = dict(format='bear-forge-ppo-v1', torch=str(torch.__version__), **self.status(),
                model=self.model.state_dict(),optimizer=self.optimizer.state_dict(),rng=torch.get_rng_state(),
                pending=self.pending,metadata=message['metadata'])
            fd, temporary = tempfile.mkstemp(dir=path.parent,prefix=path.name+'.',suffix='.tmp')
            try:
                with os.fdopen(fd,'wb') as stream:
                    torch.save(state,stream);stream.flush();os.fsync(stream.fileno())
                os.replace(temporary,path)
            finally:
                if os.path.exists(temporary):os.unlink(temporary)
            return self.status()
        if command == 'load':
            state = torch.load(message['path'],map_location='cpu',weights_only=True)
            if state['format'] != 'bear-forge-ppo-v1' or state['torch'] != str(torch.__version__): raise ValueError('Incompatible own checkpoint')
            if state.get('implementationDigest')!=IMPLEMENTATION: raise ValueError('Learner implementation changed')
            self.__init__(settings=state['settings'])
            self.model.load_state_dict(state['model'],strict=True)
            self.optimizer.load_state_dict(state['optimizer'])
            torch.set_rng_state(state['rng'])
            self.version,self.samples,self.consumed,self.updates = state['version'],state['samples'],state['consumed'],state['updates']
            self.optimizer_steps,self.pending = state['optimizerSteps'],state['pending']
            self.phases = Counter(state['phases'])
            self.last_stats = state.get('lastStats')
            if self.samples != self.consumed+len(self.pending): raise ValueError('Corrupt rollout counts')
            if any(row['version']!=self.version for row in self.pending): raise ValueError('Checkpoint mixed rollout versions')
            return {**self.status(),'metadata':state['metadata']}
        raise ValueError('Unknown own learner command')


def main():
    signal.signal(signal.SIGINT,signal.SIG_IGN)
    learner = Learner(int(sys.argv[1]) if len(sys.argv)>1 else 7)
    for line in sys.stdin:
        message=None
        try:
            message=json.loads(line)
            if message['command']=='close':
                print(json.dumps(dict(id=message['id'],ok=True,value=None)),flush=True);return
            value=learner.dispatch(message)
            print(json.dumps(dict(id=message['id'],ok=True,value=value),allow_nan=False),flush=True)
        except Exception as error:
            print(json.dumps(dict(id=message.get('id') if isinstance(message,dict) else None,ok=False,error=str(error))),flush=True)

if __name__=='__main__': main()
