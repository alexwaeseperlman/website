# First-card take heatmaps of an anet chain policy vs the live bot at several table sizes.
#   python3 plot_interp_n.py <out.png> <beta> <title> <heat_n2.csv> [heat_n3.csv ...]   (csvs from `fvi aheat <net> <n>`)
import csv, sys, re, numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap

out, beta, title, files = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4:]
cmap = LinearSegmentedColormap.from_list('ob', ['#d95f1e', '#f7f7f7', '#2166ac'])
plt.rcParams.update({'font.family': 'DejaVu Sans', 'axes.spines.top': False, 'axes.spines.right': False})
P = 22
fig, axs = plt.subplots(2, len(files), figsize=(5.6 * len(files), 8.6), squeeze=False)
for c, f in enumerate(files):
    n = int(re.search(r'n(\d)', f).group(1))
    A = np.full((P, 33), np.nan); L = np.full((P, 33), np.nan)
    for r in csv.DictReader(open(f)):
        v, pot = int(r['card']) - 3, int(r['pot'])
        if pot >= P: continue
        A[pot, v] = 1 / (1 + np.exp(-beta * (float(r['take_value']) - float(r['pass_value']))))
        L[pot, v] = float(r['live_ptake'])
    for row, (M, who) in enumerate(((A, 'anet PPO'), (L, 'live bot'))):
        ax = axs[row][c]; ax.set_facecolor('#cfcfcf')
        ax.imshow(M, origin='lower', aspect='auto', extent=[2.5, 35.5, -0.5, P - 0.5], cmap=cmap, vmin=0, vmax=1, interpolation='nearest')
        for v in range(33):
            for p in range(P - 1):
                a, b = M[p, v], M[p + 1, v]
                if not (np.isnan(a) or np.isnan(b)) and (a >= 0.5) != (b >= 0.5):
                    ax.plot([v + 2.5, v + 3.5], [p + 0.5, p + 0.5], color='k', lw=1.3)
        ax.set_title(f'{who}, {n} players', fontsize=12, fontweight='bold')
        ax.set_xticks([3, 10, 15, 20, 25, 30, 35]); ax.set_yticks([0, 5, 10, 15, 20])
        ax.set_xlabel('card'); ax.set_ylabel('chips on the card')
fig.suptitle(title, fontsize=15, fontweight='bold', y=0.995)
fig.text(0.5, 0.945, 'P(take) for the first card of the game; chips come from the other players passing, nobody holds a card yet. '
         'Blue: takes, orange: passes. Black line: P(take) crosses 50%. Grey: the player to move would be out of chips.',
         ha='center', fontsize=9.5, color='#555')
fig.tight_layout(rect=[0, 0, 1, 0.94]); fig.savefig(out, dpi=150)
print('wrote', out)
