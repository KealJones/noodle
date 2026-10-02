# Seed changes

Every change to the seed after its first review, with its reason, during week 1 and stage 0
(built-ins.md section 3). Nothing is added by hand once the seed is frozen.

| Date | Part | Change | Reason | Count change |
|---|---|---|---|---|
| 2026-10-01 | 2, 3, 8 | Arithmetic: operator words and marks (plus, minus, times, multiplied, divided, over, `+ - * x / ÷ ^ %`, percent, squared, cubed, mod, root, square, cube, remainder) with readings that build `Arithmetic(op, a, b)`; number words three to thousand and zero are `IsA(Number())`; "how much is X"; the bridge's question of a computation; realizations of computations and their answers. "plus" and "+" leave `And` for a `Plus` that is "and" of things that are not numbers; the `Percent` shape ("15%" as one string) is dropped for the `%` mark. | The Arithmetic primitive (built-ins.md section 2) had no words reaching it. | function words +37, bridge +3, realizations +15 |
