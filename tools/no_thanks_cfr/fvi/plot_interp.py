# Standard interp for the anet (FVI "Nash") bot: first-card take heatmap vs the live bot, and conv weights.
#   python3 plot_interp.py <heat.csv from `fvi aheat`> <a.json> <out dir> [label]
import csv, json, sys, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap, TwoSlopeNorm

heat, net, out = sys.argv[1], sys.argv[2], sys.argv[3]; label = sys.argv[4] if len(sys.argv) > 4 else 'stage 23'
OR, BL = '#d95f1e', '#2166ac'
cmap = LinearSegmentedColormap.from_list('ob', [OR, '#f7f7f7', BL])
plt.rcParams.update({'font.family': 'DejaVu Sans', 'axes.spines.top': False, 'axes.spines.right': False})

rows = list(csv.DictReader(open(heat)))
P = 22
nash = np.full((P, 33), np.nan); margin = np.full((P, 33), np.nan); live = np.full((P, 33), np.nan)
for r in rows:
    v, pot = int(r['card']) - 3, int(r['pot'])
    if pot >= P: continue
    nash[pot, v] = int(r['nash_take']); margin[pot, v] = 100 * (float(r['take_value']) - float(r['pass_value']))
    live[pot, v] = float(r['live_ptake'])

def boundary(ax, M):
    # black line where the take decision flips, between rows
    for v in range(33):
        for p in range(P - 1):
            a, b = M[p, v], M[p + 1, v]
            if np.isnan(a) or np.isnan(b): continue
            if (a >= 0.5) != (b >= 0.5): ax.plot([v + 3 - 0.5, v + 3 + 0.5], [p + 0.5, p + 0.5], color='k', lw=1.4)

fig, axs = plt.subplots(1, 3, figsize=(17, 5.2))
ext = [2.5, 35.5, -0.5, P - 0.5]
panels = [
    (axs[0], nash, 'Nash (FVI) bot: take or pass', dict(cmap=cmap, vmin=0, vmax=1)),
    (axs[1], margin, 'Nash bot: how much taking beats passing', dict(cmap=cmap, norm=TwoSlopeNorm(0, -30, 30))),
    (axs[2], live, 'Live PPO bot: P(take)', dict(cmap=cmap, vmin=0, vmax=1)),
]
for ax, M, title, kw in panels:
    ax.set_facecolor('#cfcfcf')
    im = ax.imshow(M, origin='lower', aspect='auto', extent=ext, interpolation='nearest', **kw)
    boundary(ax, nash if M is margin else M)
    ax.set_title(title, fontsize=12, fontweight='bold'); ax.set_xlabel('card'); ax.set_ylabel('chips on the card')
    ax.set_xticks([3, 10, 15, 20, 25, 30, 35]); ax.set_yticks([0, 5, 10, 15, 20])
    if M is margin:
        cb = fig.colorbar(im, ax=ax, fraction=0.04, pad=0.02); cb.set_label('win-share points (take − pass)')
fig.suptitle('The first card of a 2-player game: Nash bot vs live bot', fontsize=15, fontweight='bold', y=0.99)
fig.text(0.5, 0.905, 'Chips come from passing (both players start with 11, nobody holds a card yet). Blue: takes, orange: passes. '
         f'Black line: where the decision flips. Grey: the player to move would be out of chips. Nash bot = anet {label} + exact pass chain.',
         ha='center', fontsize=9.5, color='#555')
fig.tight_layout(rect=[0, 0, 1, 0.9]); fig.savefig(f'{out}/take-heatmap-nash.png', dpi=150); plt.close(fig)

# conv weights: conv1 = 12 filters x 3 inputs (holds, seen, value) x 5 taps; conv2 = 12 x 12 x 3
p = np.array(json.load(open(net))['p']); C0, K1, C1, K2, C2 = 3, 5, 12, 3, 12
o = 0; W1 = p[o:o + C1 * C0 * K1].reshape(C1, C0, K1); o += C1 * C0 * K1; b1 = p[o:o + C1]; o += C1
W2 = p[o:o + C2 * C1 * K2].reshape(C2, C1, K2); o += C2 * C1 * K2; b2 = p[o:o + C2]
fig = plt.figure(figsize=(20, 7))
gs = fig.add_gridspec(1, 2, width_ratios=[1, 1.9], wspace=0.08)
m1 = np.abs(np.concatenate([W1.ravel(), b1])).max(); m2 = np.abs(np.concatenate([W2.ravel(), b2])).max()
g1 = gs[0].subgridspec(1, 4, width_ratios=[5, 5, 5, 1.2], wspace=0.15)
for ci, name in enumerate(['holds', 'seen', 'value']):
    ax = fig.add_subplot(g1[ci]); ax.imshow(W1[:, ci, :], cmap=cmap, vmin=-m1, vmax=m1, aspect='auto')
    ax.set_title(name, fontweight='bold'); ax.set_xticks([0, 2, 4]); ax.set_xticklabels(['−2', '0', '+2'])
    ax.set_yticks(range(C1)); ax.set_yticklabels([f'filter {i + 1}' for i in range(C1)] if ci == 0 else [])
    for s in ax.spines.values(): s.set_visible(False)
ax = fig.add_subplot(g1[3]); ax.imshow(b1[:, None], cmap=cmap, vmin=-m1, vmax=m1, aspect='auto'); ax.set_title('bias', fontweight='bold')
ax.set_xticks([]); ax.set_yticks([]); [s.set_visible(False) for s in ax.spines.values()]
g2 = gs[1].subgridspec(1, C1 + 1, wspace=0.12)
for ci in range(C1):
    ax = fig.add_subplot(g2[ci]); ax.imshow(W2[:, ci, :], cmap=cmap, vmin=-m2, vmax=m2, aspect='auto')
    ax.set_title(f'in {ci + 1}', fontsize=9); ax.set_xticks([])
    ax.set_yticks(range(C2) if ci == 0 else []); ax.set_yticklabels([str(i + 1) for i in range(C2)] if ci == 0 else [])
    for s in ax.spines.values(): s.set_visible(False)
ax = fig.add_subplot(g2[C1]); ax.imshow(b2[:, None], cmap=cmap, vmin=-m2, vmax=m2, aspect='auto'); ax.set_title('bias', fontsize=9)
ax.set_xticks([]); ax.set_yticks([]); [s.set_visible(False) for s in ax.spines.values()]
fig.text(0.125, 1.04, f'Nash (FVI) bot conv weights (anet, {label})', fontsize=17, fontweight='bold')
fig.text(0.125, 0.995, 'Blue: positive weight, orange: negative. Conv 1 (left): 12 filters × 3 inputs × 5 taps (card v−2 … v+2); '
         'conv 2 (right): 12 filters × 12 conv-1 channels × 3 taps. Colour scales are per layer. '
         'Unlike the live bot there is no "in play" channel: the anet scores the position after a take.', fontsize=10, color='#555')
fig.savefig(f'{out}/nash-conv-weights.png', dpi=150, bbox_inches='tight'); plt.close(fig)
print('wrote', f'{out}/take-heatmap-nash.png', f'{out}/nash-conv-weights.png')
