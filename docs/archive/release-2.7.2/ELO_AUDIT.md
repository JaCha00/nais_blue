# StyleLab Elo Audit

## Scope

This audit covers the StyleLab Elo arena code in:

- `src/lib/style-lab/elo.ts`
- `src/lib/style-lab/tournament.ts`
- `src/stores/style-lab-store.ts`

The feature is an Elo arena: users compare two prompt genomes, the winner gains rating, and the loser loses rating.

## Validation

- Expected score formula: valid. `calculateElo` uses the standard Elo logistic curve with a 400-point scale.
- Winner/loser update: valid for decisive pairwise choices. The implementation now calculates one integer delta and mirrors it, so every battle is zero-sum after rounding.
- K factor: `32` is acceptable for a subjective UX arena where quick movement matters more than slow long-term federation ranking.
- Pairing policy: random pair extraction is consistent with exploration. It is not a bracket tournament and should keep the UX name "Elo Arena".

## Comparison To Common Practice

FIDE-style and game-ladder Elo systems use the same expected-score curve, but production rating systems often vary K factor by player maturity or add uncertainty handling. Glicko-style systems add rating deviation to express confidence, which this app intentionally does not need for a lightweight local preference arena.

StyleLab's current behavior is therefore suitable for local preference sorting, but not for cross-user competitive rankings without more controls.

## Recommended Future Enhancements

- Add a settings-level K factor if users want slower or faster convergence.
- Prefer under-sampled combinations when choosing battle pairs so new genomes get enough comparisons.
- Optionally bias pair selection toward similar Elo ratings after each genome has a minimum number of battles.
- Add draw/skip semantics only if the UI needs "too close to call"; current decisive comparisons are simpler and valid.

## References

- FIDE Rating Regulations describe the same expected score and K-factor structure used by Elo-style rating systems: https://handbook.fide.com/
- Mark Glickman's Glicko work explains why rating deviation/confidence can matter when moving beyond simple Elo: http://www.glicko.net/glicko.html
