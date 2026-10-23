// ./small n K D C [lo]: solve a reduced game exactly; prints the value for each seat and the first-card prices
#include "solve.h"
#include <chrono>
int main(int argc, char** argv){
  Cfg c; c.n = atoi(argv[1]); c.K = atoi(argv[2]); c.D = atoi(argv[3]); c.C = atoi(argv[4]); if (argc > 5) c.lo = atoi(argv[5]);
  auto t0 = std::chrono::steady_clock::now();
  Solver s(c, 22); Val v = s.root();
  double secs = std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
  printf("n=%d cards %d..%d dealt %d chips %d: states %ld, %.1fs\n  seat values:", c.n, c.lo, c.lo + c.K - 1, c.D, c.C, s.nodes, secs);
  for (int q = 0; q < c.n; q++) printf(" %.4f", v[q]); printf("\n");
  // first card of the game: at which pot does someone take it (equilibrium play from the start), and who
  printf("  first card: pot when taken (seat)\n  ");
  for (int i = 0; i < c.K; i++){
    Pos p = s.start(); p.cur = i;
    for (;;){
      if (p.chips[p.turn] == 0) break;
      Val a = s.takeVal(p), b = s.passVal(p);
      if (a[p.turn] > b[p.turn] + 1e-6f) break;
      p.chips[p.turn]--; p.pot++; p.turn = (p.turn + 1) % c.n;
    }
    printf("%d:%d(%d) ", c.lo + i, p.pot, p.turn);
  }
  printf("\n");
}
