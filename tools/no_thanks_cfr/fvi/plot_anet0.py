# Stage 0 (last card): held-out decision RMSE vs exact, three approaches on the same 1.8M-example budget, 40 epochs
import csv, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
fig, ax = plt.subplots(figsize=(6.4, 3.6))
for f, col, lab in (('long-cnet3/loss0.csv', '#eb6834', 'cnet3, value of the decision'),
                    ('hard-cnet3/loss0.csv', '#eda100', 'cnet3, hard examples oversampled'),
                    ('anet0/aloss0.csv', '#2a78d6', 'anet + pass-chain layer')):
    rows = list(csv.DictReader(open(f)))
    key = 'heldout_decision_rmse' if 'heldout_decision_rmse' in rows[0] else 'heldout_rmse'
    ax.plot([int(r['examples_seen']) / 1e6 for r in rows], [float(r[key]) for r in rows], color=col, lw=2, label=lab)
ax.set_ylim(0, 0.12); ax.set_xlabel('examples seen (millions)'); ax.set_ylabel('held-out RMSE of win share')
ax.set_title('Last card (stage 0), 2 players', fontsize=11)
ax.grid(alpha=0.25); ax.spines[['top', 'right']].set_visible(False); ax.legend(frameon=False, fontsize=8)
fig.tight_layout(); fig.savefig('/mnt/project-files/no-thanks-plots/fvi-stage0-anet-chain.png', dpi=150)
