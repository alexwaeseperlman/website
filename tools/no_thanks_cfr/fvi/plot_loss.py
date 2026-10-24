# Loss curves of the value nets, one panel per stage: held-out RMSE (solid) and train RMSE (thin) vs examples seen.
#   python3 plot_loss.py out.png stages...   (reads pnet/loss<k>.csv and cnet3/loss<k>.csv)
import csv, sys, os
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
out, stages = sys.argv[1], [int(s) for s in sys.argv[2:]]
COL = {'pnet': '#2a78d6', 'cnet3': '#eb6834'}
fig, axs = plt.subplots(1, len(stages), figsize=(3.2 * len(stages), 3.2), sharey=True)
for ax, k in zip(axs, stages):
    for arch in ('pnet', 'cnet3'):
        f = f'{arch}/loss{k}.csv'
        if not os.path.exists(f): continue
        rows = list(csv.DictReader(open(f)))
        x = [int(r['examples_seen']) / 1e6 for r in rows]
        ax.plot(x, [float(r['heldout_rmse']) for r in rows], color=COL[arch], lw=2, label=f'{arch} held-out')
        ax.plot(x, [float(r['train_rmse']) for r in rows], color=COL[arch], lw=1, ls=':', label=f'{arch} train')
    ax.set_title(f'{k} cards left after this one' if k != 1 else '1 card left after this one', fontsize=10)
    ax.set_xlabel('examples seen (millions)')
    ax.grid(alpha=0.25); ax.spines[['top', 'right']].set_visible(False)
    ax.set_ylim(0, 0.2)
axs[0].set_ylabel('RMSE of predicted win share')
axs[-1].legend(fontsize=8, frameon=False)
fig.suptitle('Value net loss per stage (backward induction, 2 players)', fontsize=11)
fig.tight_layout(); fig.savefig(out, dpi=150)
