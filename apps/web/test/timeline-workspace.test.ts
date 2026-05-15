import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRenderableChangesFromSource } from '../src/features/timeline/TimelineWorkspace.js';

test('file change preview data dedupes identical path entries from changes and patch parsing', () => {
  const changes = buildRenderableChangesFromSource({
    patch: '*** Begin Patch\n*** Update File: src/dup.ts\n+line\n*** End Patch',
    changes: [
      { path: 'src/dup.ts', kind: 'update', addedLines: 3, deletedLines: 1 },
    ],
  });

  assert.equal(changes.length, 1);
  assert.equal(changes[0]?.path, 'src/dup.ts');
  assert.equal(changes[0]?.kind, 'update');
  assert.equal(changes[0]?.addedLines, 3);
  assert.equal(changes[0]?.deletedLines, 1);
});
