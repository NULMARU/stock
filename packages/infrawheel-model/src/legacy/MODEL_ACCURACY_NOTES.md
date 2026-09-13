# Model accuracy notes

InfraWheel Lite initially preserves upstream engine behavior for compatibility. The
following known model-accuracy concerns are explicitly out of scope for the Lite
adapter and should be addressed as a separate model revision:

1. `K units × $K/unit` produces `$M`, but physical revenue is combined directly with digital revenue expressed in `$B`.
2. Bottleneck calculations compare unlike units such as GB, TB, wafers, and PFLOPS through `min()`.
3. `spatialEffective` is not directly constrained by silicon and power.
4. `edgeCapability` does not directly consume `spatialEffective`.
5. Physical-AI revenue becomes detached from edge processing capacity after activation.
6. `cycleUnit: month` can be declared, but calculations always advance by quarter.
