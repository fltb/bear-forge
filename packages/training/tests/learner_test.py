from pathlib import Path
import sys,tempfile,unittest,copy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src'))
# The independent learner must not need any DouZero implementation.
sys.modules['douzero']=None
import torch
from learner import Learner
from ppo import clipped_loss,prepared
from model import pack


def features(actions=3,tokens=2):
    x=torch.zeros(tokens,64);x[:,0]=1;x[:,8]=torch.arange(tokens)
    a=torch.zeros(actions,64);a[:,1]=1;a[:,12]=torch.arange(actions)/10
    return dict(tokens=x.tolist(),actions=a.tolist())


def row(learner,identity):
    f=features();response=learner.dispatch(dict(command='score',features=f))
    index=1
    lp=torch.tensor(response['logits'],dtype=torch.float64).log_softmax(0)[index].item()
    return {**f,'index':index,'logProbability':lp,'return':1,'player':'0','phase':'bidding',
            'requestId':identity,'version':learner.version,'teacherIndex':2}


class LearnerTests(unittest.TestCase):
    def test_clipping_has_expected_value_and_gradient(self):
        logs=torch.tensor([1.5,.5]).log().requires_grad_()
        loss,_=clipped_loss(logs,torch.zeros(2),torch.tensor([1.,-1.]),.2)
        self.assertAlmostEqual(loss.item(),-.2,places=6)
        loss.backward();self.assertTrue(torch.equal(logs.grad,torch.zeros(2)))

    def test_padding_never_enters_distribution_and_tokens_are_masked(self):
        learner=Learner()
        f=features(3,2);alone=learner.dispatch(dict(command='score',features=f))
        learner.model.eval()
        with torch.no_grad(): logits,values=learner.model(*pack([prepared(f),prepared(features(7,8))]))
        torch.testing.assert_close(logits[0,:3],torch.tensor(alone['logits'],dtype=torch.float64),atol=1e-6,rtol=1e-5)
        self.assertTrue(torch.isneginf(logits[0,3:]).all())
        self.assertEqual(logits[0].softmax(0)[3:].sum().item(),0)
        self.assertTrue(torch.isfinite(values).all())

    def test_pending_restore_real_update_and_stale_probability_rejection(self):
        settings=dict(rolloutSamples=3,minibatch=2,epochs=2)
        learner=Learner(7,settings)
        original=copy.deepcopy(learner.model.state_dict())
        learner.dispatch(dict(command='learn',version=learner.version,rows=[row(learner,'one'),row(learner,'two')]))
        self.assertEqual(learner.updates,0);self.assertEqual(len(learner.pending),2)
        with tempfile.TemporaryDirectory() as directory:
            path=str(Path(directory)/'model.pt')
            learner.dispatch(dict(command='save',path=path,metadata={'nextSeed':9}))
            restored=Learner(90)
            loaded=restored.dispatch(dict(command='load',path=path))
            self.assertEqual(loaded['metadata'],{'nextSeed':9})
            self.assertEqual(loaded['pendingSamples'],2)
            last=row(learner,'three')
            rng=torch.get_rng_state()
            learner.dispatch(dict(command='learn',version=learner.version,rows=[last]))
            torch.set_rng_state(rng)
            restored.dispatch(dict(command='learn',version=restored.version,rows=[last]))
            self.assertEqual(learner.consumed,3);self.assertEqual(learner.optimizer_steps,4)
            self.assertTrue(any(not torch.equal(v,learner.model.state_dict()[k]) for k,v in original.items()))
            for key,value in learner.model.state_dict().items():
                self.assertTrue(torch.equal(value,restored.model.state_dict()[key]),key)
            with self.assertRaisesRegex(ValueError,'Stale'):
                learner.dispatch(dict(command='learn',version='old',rows=[last]))
        corrupt=Learner(7,dict(rolloutSamples=1,minibatch=1,epochs=1))
        bad=row(corrupt,'corrupt');bad['logProbability']=-100
        with self.assertRaisesRegex(ValueError,'probabilities'):
            corrupt.dispatch(dict(command='learn',version=corrupt.version,rows=[bad]))

if __name__=='__main__':unittest.main()
