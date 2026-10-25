# Stage 0 (last card) value-net loss: cnet3 vs cnet4 on the same 1.8M examples, 40 epochs
import csv, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(6.4, 3.6))
for arch, col in (('cnet3', '#eb6834'), ('cnet4', '#2a78d6')):
    rows = list(csv.DictReader(open(f'long-{arch}/loss0.csv')))
    x = [int(r['examples_seen']) / 1e6 for r in rows]
    ax.plot(x, [float(r['heldout_rmse']) for r in rows], color=col, lw=2, label=f'{arch} held-out')
    ax.plot(x, [float(r['train_rmse']) for r in rows], color=col, lw=1, ls=':', label=f'{arch} train')
ax.set_ylim(0, 0.12); ax.set_xlabel('examples seen (millions)'); ax.set_ylabel('RMSE of predicted win share')
ax.set_title('Last card (stage 0): value net loss, 2 players', fontsize=11)
ax.grid(alpha=0.25); ax.spines[['top', 'right']].set_visible(False); ax.legend(frameon=False, fontsize=8)
fig.tight_layout(); fig.savefig('/mnt/project-files/no-thanks-plots/fvi-stage0-cnet3-vs-cnet4.png', dpi=150)
