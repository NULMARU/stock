# Upstream source

- Repository: https://github.com/JihoonJeong/infrawheel-model.git
- Commit: `e252eb9a24fcda7ea709b07968c0fe849066c802`
- Imported: 2026-08-23
- Method: clean working-tree snapshot without upstream Git history

The upstream history was intentionally not imported because it contains files under
`.claude/projects/.../memory/`. The `.git/` directory, the complete `.claude/`
directory, and `.github/workflows/deploy.yml` were excluded from this snapshot.

The upstream package declares the ISC license in `package.json`, but the snapshot did
not include a standalone `LICENSE` or an author value. No license text has been
inferred or added. Rights to the original work and book-related narrative content
must be confirmed before public or commercial distribution.
