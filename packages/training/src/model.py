"""Bear Forge's candidate actor/critic. No game rules or third-party learner."""
import math
import torch
from torch import nn

WIDTH = 64
MAX_TOKENS = 128


class CardTransformer(nn.Module):
    def __init__(self, dimension=48, layers=2):
        super().__init__()
        self.input = nn.Linear(WIDTH, dimension)
        self.position = nn.Parameter(torch.randn(1, MAX_TOKENS, dimension) * .02)
        block = nn.TransformerEncoderLayer(dimension, 4, dimension * 2,
                    dropout=0, activation="gelu", batch_first=True, norm_first=True)
        self.encoder = nn.TransformerEncoder(block, layers, enable_nested_tensor=False)
        self.norm = nn.LayerNorm(dimension)
        self.query = nn.Linear(dimension, dimension)
        self.action = nn.Sequential(nn.Linear(WIDTH, dimension), nn.GELU(), nn.Linear(dimension, dimension))
        self.action_bias = nn.Linear(dimension, 1)
        self.value = nn.Sequential(nn.Linear(dimension, dimension), nn.Tanh(), nn.Linear(dimension, 1))
        self.scale = math.sqrt(dimension)

    def forward(self, tokens, token_mask, actions, action_mask):
        hidden = self.input(tokens) + self.position[:, :tokens.shape[1]]
        hidden = self.encoder(hidden, src_key_padding_mask=~token_mask)
        context = self.norm((hidden * token_mask[:, :, None]).sum(1) / token_mask.sum(1, keepdim=True))
        candidates = self.action(actions)
        logits = torch.einsum('bd,bnd->bn', self.query(context), candidates) / self.scale
        logits = logits + self.action_bias(candidates).squeeze(-1)
        # The host uses these same bounded, double-precision categorical weights.
        logits = logits.double()
        logits = (logits - logits.masked_fill(~action_mask, -torch.inf).max(1, keepdim=True).values).clamp(min=-30)
        logits = logits.masked_fill(~action_mask, -torch.inf)
        return logits, self.value(context).squeeze(-1)


def pack(rows):
    batch, tokens, actions = len(rows), max(len(r['tokens']) for r in rows), max(len(r['actions']) for r in rows)
    x = torch.zeros(batch, tokens, WIDTH)
    a = torch.zeros(batch, actions, WIDTH)
    xm = torch.zeros(batch, tokens, dtype=torch.bool)
    am = torch.zeros(batch, actions, dtype=torch.bool)
    for i, row in enumerate(rows):
        n, m = len(row['tokens']), len(row['actions'])
        x[i, :n], a[i, :m] = row['tokens'], row['actions']
        xm[i, :n], am[i, :m] = True, True
    return x, xm, a, am
